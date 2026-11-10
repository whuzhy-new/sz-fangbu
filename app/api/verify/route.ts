import offices from "@/public/data/offices.json";
import metro from "@/data/metro-index.json";
import stationData from "@/public/data/stations.json";
import {VERIFY_TIMEOUT_MS,rankAccessCandidates} from "@/lib/segmented-search";
import {localAccessTimes} from "@/lib/local-access-server";
import {surfaceLeg,fullMetro,stationMetro,METRO_DEPARTURE,MapApiError} from "@/lib/amap-server";
import type {RecommendedMetro} from "@/lib/full-metro";
import {hasGateNumber,recommendedStreetGates} from "@/lib/metro-gates";
import {readSharedVerification,verificationCacheKey,writeSharedVerification} from "@/lib/verification-cache";
import {DURATION_ROUNDING_VERSION,LIMITS,amapPoiId,distanceMeters,qualified,roundLeg,sumLegDurations,withinShenzhen,type Coord,type Leg,type Plan,type QueryStage,type Verification} from "@/lib/commute";

type Prepared={id:string;stationId:string;stationName:string;officeId:string;duration:number;legs:Leg[];measuredAt:string;originalTotalDuration?:number|null;metroApi?:{originName:string;destinationName:string};originalReferenceScope?:string};
type Entry={id:string;name:string;location:Coord;source:string};
type Index={methodVersion?:string;generatedAt?:string;durationRounding?:string;complete:boolean;plans:Record<string,Record<string,Prepared>>;entries:Record<string,Entry[]>};
const prepared=metro as unknown as Index;
// The original 30-second snapshots predate this metadata field.
const preparedRounding=prepared.durationRounding??"per-leg-minute-half-up-min-one-v2";
const preparedReady=prepared.complete&&prepared.methodVersion==="amap-station-pair-v3"&&preparedRounding===DURATION_ROUNDING_VERSION;
const preparedCandidates=(officeId:string,origin:Coord)=>Object.values(preparedReady?prepared.plans[officeId]??{}:{})
  .filter(plan=>{
    const office=offices.find(o=>o.id===officeId),tail=plan.legs.at(-1);
    return office&&tail&&hasGateNumber(tail.from)&&tail.destination.length===2&&tail.destination.every((value,index)=>value===office.entrance[index])
      &&(!tail.destinationPoiId||tail.destinationPoiId===office.poiId)
      &&(!("walkingIdentity" in office&&office.walkingIdentity==="poi"&&tail.mode==="walking")||tail.routingIdentity==="poi");
  })
  .filter(plan=>plan.metroApi?.originName===plan.stationName&&plan.legs.find(l=>l.mode==="metro")?.from===plan.stationName+"站"&&plan.legs.filter(l=>l.mode==="metro").at(-1)?.to===plan.metroApi.destinationName+"站")
  .map(plan=>({...plan,legs:plan.legs.map(roundLeg),duration:sumLegDurations(plan.legs)}))
  .flatMap(plan=>(prepared.entries[plan.stationId]??[]).filter(entry=>entry.source==="amap"&&hasGateNumber(entry.name)).map(entry=>({plan,entry,distance:distanceMeters(origin,entry.location)})));
const coordinateKey=(location:Coord)=>location.map(n=>n.toFixed(6)).join(",");
const entranceKey=(name:string,location:Coord)=>`${name}:${coordinateKey(location)}`;
const entrances=new Map(Object.values(prepared.entries).flat().filter(entry=>entry.source==="amap").map(entry=>[entranceKey(entry.name,entry.location),entry]));

function withinDeadline<T>(promise:Promise<T>,signal:AbortSignal):Promise<T|null> {
  return new Promise(resolve=>{
    const finish=(value:T|null)=>{signal.removeEventListener("abort",cancel);resolve(value);};
    const cancel=()=>finish(null);
    promise.then(finish,()=>finish(null));
    if(signal.aborted)cancel();else signal.addEventListener("abort",cancel,{once:true});
  });
}

export async function POST(request:Request) {
  let input:{location:Coord;name:string;officeIds:string[];poiId?:string;refresh?:boolean};
  try{input=await request.json();}catch{return Response.json({error:"地址格式有误。"},{status:400});}
  if(!input||typeof input!=="object"||!Array.isArray(input.location)||!withinShenzhen(input.location)||typeof input.name!=="string"||input.name.length>120||!Array.isArray(input.officeIds)||input.officeIds.length>3||!input.officeIds.length||input.officeIds.some(id=>!offices.some(o=>o.id===id)))return Response.json({error:"请选择深圳范围内的位置和有效工区。"},{status:400});
  const originPoiId=amapPoiId(input.poiId);
  const encoder=new TextEncoder();
  const apiSignal=AbortSignal.any([request.signal,AbortSignal.timeout(VERIFY_TIMEOUT_MS)]);
  const refresh=input.refresh===true;
  const apiOptions={signal:apiSignal,refresh};
  const selectedOffices=[...new Set(input.officeIds)].map(id=>offices.find(o=>o.id===id)!);
  function prepareAccess(){
    const candidatesByOffice=new Map(selectedOffices.map(office=>[office.id,preparedCandidates(office.id,input.location)]));
    const targets=new Map<string,Coord>();
    for(const candidates of candidatesByOffice.values())for(const candidate of candidates)targets.set(coordinateKey(candidate.entry.location),candidate.entry.location);
    return {candidatesByOffice,targets:[...targets.values()],targetIndices:new Map([...targets.keys()].map((key,index)=>[key,index]))};
  }
  // Only load the road graph if both earlier stages fail. Reuse one search
  // across requested offices without delaying the direct metro API.
  let local:ReturnType<typeof localAccessTimes>|undefined;
  let access:ReturnType<typeof prepareAccess>|undefined;
  let cancelled=false;
  const stream=new ReadableStream({
    async start(controller) {
      const send=(value:unknown)=>{if(!cancelled)controller.enqueue(encoder.encode(JSON.stringify(value)+"\n"));};
      const stopped=()=>cancelled||request.signal.aborted;
      try{
        for(const office of selectedOffices) {
          if(stopped())break;
          const startedAt=Date.now();
          const key=verificationCacheKey(office.id,input.location,originPoiId,JSON.stringify([office.name,office.entrance,office.poiId,
            "walkingIdentity" in office?office.walkingIdentity:null,DURATION_ROUNDING_VERSION,LIMITS,METRO_DEPARTURE.label,prepared.methodVersion,prepared.generatedAt,preparedReady]));
          const cached=await readSharedVerification(key,input.name);
          if(stopped())break;
          if(cached&&!refresh){send({type:"office-result",result:cached});continue;}
          const result:Verification={officeId:office.id,plans:[],complete:true,checked:0,errors:[],measuredAt:new Date(startedAt).toISOString()};
          const stage=(stage:QueryStage)=>send({type:"stage",officeId:office.id,stage});
          send({type:"office-start",officeId:office.id});stage("surface");
          await Promise.all((["walking","bicycling"] as const).map(async mode=>{
            if(stopped()||apiSignal.aborted)return;
            try{
              result.checked++;
              const raw=await surfaceLeg(mode,input.location,office.entrance as Coord,input.name,office.name,{...apiOptions,originPoiId,destinationPoiId:office.poiId});
              if(raw){
                const leg=roundLeg(raw);
                const plan:Plan={id:`${office.id}-${mode}`,officeId:office.id,mode,title:mode==="walking"?"全程步行":"全程自行车",duration:leg.duration,limit:mode==="walking"?1800:1200,qualified:qualified(leg.duration,mode),legs:[leg],measuredAt:leg.measuredAt??new Date().toISOString(),source:"amap"};
                result.plans.push(plan);send({type:"plan",plan});
              }
            }catch(error){result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"路线暂未完成查询。");}
          }));
          const surfaceQualified=result.plans.some(p=>p.qualified);
          let fullMetroQualified=false;
          let recommendation:RecommendedMetro|undefined;
          if(!surfaceQualified&&!stopped()&&!apiSignal.aborted)try{
            stage("metro-full");result.checked++;
            const raw=await fullMetro(input.location,office.entrance as Coord,input.name,office.name,{...apiOptions,originPoiId,destinationPoiId:office.poiId});
            if(raw){
              const {recommendedMetro,...rawLeg}=raw;
              recommendation=recommendedMetro;
              const leg=roundLeg(rawLeg);fullMetroQualified=qualified(leg.duration,"metro");
              const plan:Plan={id:`${office.id}-metro-full`,officeId:office.id,mode:"metro",metroMethod:"full",title:"地铁完整方案",duration:leg.duration,limit:1200,qualified:fullMetroQualified,legs:[leg],measuredAt:leg.measuredAt!,source:"amap",note:`高德总时长，含步行、换乘及接口计入的候车。查询时刻：${METRO_DEPARTURE.label}。`};
              result.plans.push(plan);send({type:"plan",plan});
            }
          }catch(error){result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"完整地铁方案暂未完成查询。");}
          if(!surfaceQualified&&!fullMetroQualified&&!stopped()&&!apiSignal.aborted) {
            stage("metro-segmented");
            // Prioritize the full journey's stations and explicit street gates.
            // Generic gate hints must resolve to real, numbered exits first.
            const proofs=new Map<string,Promise<Leg|null>>();
            let continueAccess=true;
            const querySurface=(mode:"walking"|"bicycling",origin:Coord,destination:Coord,from:string,to:string,originId?:string,destinationId?:string)=>{
              const key=JSON.stringify([mode,coordinateKey(origin),coordinateKey(destination),...(mode==="walking"?[originId,destinationId]:[])]);
              if(!proofs.has(key)){
                result.checked++;
                proofs.set(key,surfaceLeg(mode,origin,destination,from,to,{...apiOptions,originPoiId:originId,destinationPoiId:destinationId}));
              }
              return proofs.get(key)!;
            };
            const accessError=(error:unknown)=>{
              result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"接驳路线暂未完成查询。");
              if(apiSignal.aborted||!(error instanceof MapApiError)||!["NETWORK","REQUEST_TIMEOUT"].includes(error.code))continueAccess=false;
            };
            if(recommendation){
              const station=(name:string)=>stationData.stations.find(s=>s.name===name);
              const boarding=station(recommendation.entry.stationName),alighting=station(recommendation.exit.stationName);
              const entryGates=recommendedStreetGates(recommendation.entry,boarding?prepared.entries[boarding.id]??[]:[]);
              const exitGates=recommendedStreetGates(recommendation.exit,alighting?prepared.entries[alighting.id]??[]:[]);
              let stationProof:Awaited<ReturnType<typeof stationMetro>>=null;
              if(entryGates.length&&exitGates.length&&boarding&&alighting&&boarding.id!==alighting.id)try{
                result.checked++;
                stationProof=await stationMetro(boarding,alighting,apiOptions);
              }catch(error){accessError(error);}
              if(stationProof){
                const rails=stationProof.legs.map(raw=>{
                  const a=station(raw.from.replace(/站$/,"")),b=station(raw.to.replace(/站$/,""));
                  return roundLeg({...raw,measuredAt:stationProof!.measuredAt,
                    ...(raw.mode==="metro"?{origin:a?a.location as Coord:raw.origin,destination:b?b.location as Coord:raw.destination,originPoiId:a?.id,destinationPoiId:b?.id}:{} )});
                });
                const first:Leg[]=[],last:Leg[]=[];
                const id=`${office.id}-metro-recommended`;
                const publish=()=>{
                  const combinations=first.flatMap(a=>last.map(b=>[a,...rails,b]));
                  const legs=combinations.sort((a,b)=>sumLegDurations(a)-sumLegDurations(b))[0];
                  if(!legs)return false;
                  const duration=sumLegDurations(legs);
                  const plan:Plan={id,officeId:office.id,mode:"metro",metroMethod:"segmented",title:`经${recommendation!.entry.stationName}站`,duration,limit:1200,qualified:qualified(duration,"metro"),legs,
                    measuredAt:stationProof!.measuredAt,source:"amap",originalReferenceDuration:stationProof!.originalTotalDuration,originalReferenceScope:"stations",note:`优先使用完整方案推荐的车站；两端接驳按具体进出站口查询，地铁按车站到车站单独查询，计入站内换乘。地铁参考时刻：${METRO_DEPARTURE.label}。`};
                  const existing=result.plans.findIndex(p=>p.id===id);
                  if(existing<0||result.plans[existing].duration>duration){
                    if(existing>=0)result.plans[existing]=plan;else result.plans.push(plan);
                    send({type:"plan",plan,originalTotalDuration:stationProof!.originalTotalDuration,originalReferenceScope:"stations"});
                  }
                  return plan.qualified;
                };
                // Check walking at both ends first. If it fails, compare cycling
                // at both ends as well, retaining every successful combination.
                for(const mode of ["walking","bicycling"] as const){
                  if(stopped()||apiSignal.aborted||!continueAccess)break;
                  const responses=await Promise.allSettled([
                    ...entryGates.map(gate=>querySurface(mode,input.location,gate.location,input.name,gate.name,originPoiId,gate.id)),
                    ...exitGates.map(gate=>querySurface(mode,gate.location,office.entrance as Coord,gate.name,office.name,gate.id,office.poiId)),
                  ]);
                  responses.forEach((response,index)=>{
                    if(response.status==="rejected")accessError(response.reason);
                    else if(response.value)(index<entryGates.length?first:last).push(roundLeg(response.value));
                  });
                  if(publish())break;
                }
              }
            }
            if(!result.plans.some(p=>p.qualified)&&continueAccess&&!stopped()&&!apiSignal.aborted){
              const {candidatesByOffice,targets,targetIndices}=access??=prepareAccess();
              const candidates=candidatesByOffice.get(office.id)!;
              local??=localAccessTimes(input.location,targets,request.url);
              const measured=await withinDeadline(local,apiSignal);
              const times=candidates.map(candidate=>measured?.times[targetIndices.get(coordinateKey(candidate.entry.location))!]??{walking:null,bicycling:null});
              const ranked=rankAccessCandidates(candidates,times);
              if(measured){
                result.localSearch={...ranked.summary,elapsedMs:measured.elapsedMs,source:"model"};
                send({type:"local-search",officeId:office.id,localSearch:result.localSearch});
              }
              if(!preparedReady){result.complete=false;result.errors.push("车站到车站的地铁方案正在重算，暂不使用旧方案判定。");}
              else if(!candidates.length){result.complete=false;result.errors.push("当前工区的地铁分段数据未就绪，已保留其他路线结果。");}
              if(!measured&&!apiSignal.aborted){result.complete=false;result.errors.push("本地路网暂不可用，已保留高德结果。");}
              for(const {candidate,mode} of ranked.proofs) {
                if(stopped()||apiSignal.aborted)break;
                try{
                  const raw=await querySurface(mode,input.location,candidate.entry.location,input.name,candidate.entry.name,originPoiId,candidate.entry.id);
                  if(!raw)continue;
                  const first=roundLeg(raw),duration=first.duration+candidate.plan.duration;
                  const legs=[first,...candidate.plan.legs.map((leg,index)=>{
                    if(leg.mode!=="metro"){
                      if(index!==candidate.plan.legs.length-1||leg.kind==="transfer")return leg;
                      const gate=entrances.get(entranceKey(leg.from,leg.origin));
                      // Only retain IDs that were actually sent to the surface API.
                      return leg.routingIdentity==="poi"?{...leg,originPoiId:gate?.id,destinationPoiId:office.poiId}:leg;
                    }
                    const pair=leg.instructions?.[0]?.split("：")[1]?.split(" → ");
                    const a=stationData.stations.find(s=>s.name===(pair?.[0]??leg.from.replace(/站$/,""))),b=stationData.stations.find(s=>s.name===(pair?.[1]??leg.to.replace(/站$/,"")));
                    return {...leg,from:a?a.name+"站":leg.from,to:b?b.name+"站":leg.to,origin:a?a.location as Coord:leg.origin,destination:b?b.location as Coord:leg.destination,
                      originPoiId:a?.id,destinationPoiId:b?.id};
                  })];
                  const plan:Plan={id:candidate.plan.id,officeId:office.id,mode:"metro",metroMethod:"segmented",title:`经${candidate.plan.stationName}站`,duration,limit:1200,qualified:qualified(duration,"metro"),legs,measuredAt:candidate.plan.measuredAt,source:"amap",originalReferenceDuration:candidate.plan.originalTotalDuration,originalReferenceScope:candidate.plan.originalReferenceScope,note:`地铁参考时刻：${METRO_DEPARTURE.label}。`};
                  const existing=result.plans.findIndex(p=>p.id===plan.id);
                  if(existing<0||result.plans[existing].duration>plan.duration){
                    if(existing>=0)result.plans[existing]=plan;else result.plans.push(plan);
                    send({type:"plan",plan,preparedPlanId:candidate.plan.id,originalTotalDuration:candidate.plan.originalTotalDuration,originalReferenceScope:candidate.plan.originalReferenceScope});
                  }
                  if(plan.qualified)break;
                }catch(error){
                  accessError(error);
                  if(!continueAccess)break;
                }
              }
            }
            // Finishing the selected candidate queries is independent of
            // finding a qualifying route. Skipped estimates are not a global
            // proof of ineligibility; the UI reports only the checked routes.
          }
          if(stopped())result.complete=false;
          if(apiSignal.aborted&&!stopped()&&!result.plans.some(p=>p.qualified)){result.complete=false;result.errors.push("高德核验超时，已有结果已保留。");}
          result.errors=[...new Set(result.errors)];
          result.plans.sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.duration-b.duration);
          if(!stopped()&&cached&&(!result.complete||!result.plans.length)&&!result.plans.some(p=>p.qualified)){
            send({type:"office-result",result:{...cached,errors:["未完成重新核验，已保留上次结果。"]}});
            continue;
          }
          if(!stopped())await writeSharedVerification(key,result,startedAt);
          send({type:"office-result",result});
        }
        send({type:"done"});
      }catch{send({type:"error",message:"查询暂时中断，已有结果已保留，其余方案尚未完成核验。"});}
      finally{if(!cancelled)controller.close();}
    },
    cancel(){cancelled=true;},
  });
  return new Response(stream,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
