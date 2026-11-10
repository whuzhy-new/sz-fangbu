import offices from "@/public/data/offices.json";
import coverageData from "@/public/data/coverage-bidirectional.json";
import metro from "@/data/metro-index.json";
import metroReturn from "@/data/metro-return.json";
import innovationEgress from "@/data/office-profiles/innovation-fixed-egress.json";
import jinghuEgress from "@/data/office-profiles/jinghu-fixed-egress.json";
import princeEgress from "@/data/office-profiles/prince-fixed-egress.json";
import stationData from "@/public/data/stations.json";
import {VERIFY_TIMEOUT_MS,rankAccessCandidates} from "@/lib/segmented-search";
import {localAccessTimes} from "@/lib/local-access-server";
import {surfaceLeg,fullMetro,stationMetro,METRO_DEPARTURE,MapApiError} from "@/lib/amap-server";
import type {RecommendedMetro} from "@/lib/full-metro";
import {hasGateNumber,recommendedStreetGates} from "@/lib/metro-gates";
import {firstQueryStage} from "@/lib/coverage";
import type {Coverage} from "@/lib/map-types";
import {readSharedVerification,verificationCacheKey,writeSharedVerification} from "@/lib/verification-cache";
import {DURATION_ROUNDING_VERSION,LIMITS,METRO_DRILL_DOWN_FROM,amapPoiId,distanceMeters,qualified,roundLeg,sumLegDurations,withinShenzhen,type Coord,type Leg,type LocalSearch,type Plan,type QueryStage,type Verification} from "@/lib/commute";

type Prepared={id:string;stationId:string;stationName:string;officeId:string;duration:number;legs:Leg[];measuredAt:string;originalTotalDuration?:number|null;metroApi?:{originName:string;destinationName:string};originalReferenceScope?:string};
type Entry={id:string;name:string;location:Coord;source:string};
type Index={methodVersion?:string;generatedAt?:string;durationRounding?:string;complete:boolean;plans:Record<string,Record<string,Prepared>>;entries:Record<string,Entry[]>};
type Office=(typeof offices)[number];
type ReturnIndex=Omit<Index,"entries">&{departureDate:string;departureTime:string;
  access:Record<string,Record<string,Leg>>;officeEndpoints:Record<string,{poiId:string;entrance:Coord}>};
const prepared=metro as unknown as Index;
const coverage=coverageData as unknown as Coverage;
const preparedReturn=metroReturn as unknown as ReturnIndex;
const returnReady=preparedReturn.complete&&preparedReturn.methodVersion==="amap-return-station-pair-v1"
  &&preparedReturn.durationRounding===DURATION_ROUNDING_VERSION&&preparedReturn.departureDate===METRO_DEPARTURE.date
  &&preparedReturn.departureTime.replace(":","-")===METRO_DEPARTURE.time;
const returnOfficeReady=(office:Office)=>{
  const endpoint=preparedReturn.officeEndpoints[office.id];
  return returnReady&&endpoint?.poiId===office.poiId&&office.entrance.every((value,index)=>value===endpoint.entrance[index]);
};
// The original 30-second snapshots predate this metadata field.
const preparedRounding=prepared.durationRounding??"per-leg-minute-half-up-min-one-v2";
const preparedReady=prepared.complete&&prepared.methodVersion==="amap-station-pair-v3"&&preparedRounding===DURATION_ROUNDING_VERSION;
const egressByOffice=new Map<string,{routes:Record<string,Leg>;version:string}>();
for(const profile of [innovationEgress,jinghuEgress,princeEgress]){
  const office=offices.find(office=>office.id===profile.officeId&&office.poiId===profile.officePoiId
    &&office.entrance.every((value,index)=>value===profile.officeEntrance[index]));
  if(office)egressByOffice.set(office.id,{routes:profile.routes as unknown as Record<string,Leg>,version:JSON.stringify(profile)});
}
const fixedEgress=(officeId:string,station:string)=>egressByOffice.get(officeId)?.routes[station];
const preparedCandidates=(officeId:string,origin:Coord)=>Object.values(preparedReady?prepared.plans[officeId]??{}:{})
  .filter(plan=>{
    const office=offices.find(o=>o.id===officeId),tail=plan.legs.at(-1);
    return office&&tail&&hasGateNumber(tail.from)&&tail.destination.length===2&&tail.destination.every((value,index)=>value===office.entrance[index])
      &&(!tail.destinationPoiId||tail.destinationPoiId===office.poiId)
      &&(!("walkingIdentity" in office&&office.walkingIdentity==="poi"&&tail.mode==="walking")||tail.routingIdentity==="poi");
  })
  .filter(plan=>plan.metroApi?.originName===plan.stationName&&plan.legs.find(l=>l.mode==="metro")?.from===plan.stationName+"站"&&plan.legs.filter(l=>l.mode==="metro").at(-1)?.to===plan.metroApi.destinationName+"站")
  .map(plan=>{
    const tail=plan.metroApi&&fixedEgress(officeId,plan.metroApi.destinationName);
    const legs=(tail?[...plan.legs.slice(0,-1),tail]:plan.legs).map(roundLeg);
    return {...plan,legs,duration:sumLegDurations(legs)};
  })
  .flatMap(plan=>withStreetGates(plan,origin));
const withStreetGates=(plan:Prepared,home:Coord)=>(prepared.entries[plan.stationId]??[])
  .filter(entry=>entry.source==="amap"&&hasGateNumber(entry.name))
  .map(entry=>({plan,entry,distance:distanceMeters(home,entry.location)}));
const returnCandidates=(office:Office,home:Coord)=>Object.values(returnOfficeReady(office)?preparedReturn.plans[office.id]??{}:{})
  .flatMap(plan=>withStreetGates({...plan,legs:plan.legs.map(roundLeg)},home));
type Point={location:Coord;name:string;poiId?:string};
type DirectionRun={
  toHome:boolean;origin:Point;destination:Point;key:string;cached:Verification|null;
  result:Verification;finished:boolean;started:boolean;recommendation?:RecommendedMetro;
};
const isShortMetro=(plan:Plan)=>plan.mode==="metro"&&plan.qualified&&plan.duration<METRO_DRILL_DOWN_FROM;
const hasSurface=(result:Verification)=>result.plans.some(plan=>plan.mode!=="metro"&&plan.qualified);
const isDecisive=(result:Verification)=>hasSurface(result)||result.plans.some(isShortMetro);
const sortedPlans=(plans:Plan[])=>plans.sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.duration-b.duration);
function combineSearch(results:Verification[]):LocalSearch|undefined {
  const searches=results.flatMap(result=>result.localSearch?[result.localSearch]:[]);
  if(!searches.length)return undefined;
  const duration=Math.min(...searches.map(search=>search.bestDuration??Infinity));
  return {total:searches.reduce((sum,search)=>sum+search.total,0),reachable:searches.reduce((sum,search)=>sum+search.reachable,0),
    withinLimit:searches.reduce((sum,search)=>sum+search.withinLimit,0),bestDuration:Number.isFinite(duration)?duration:null,
    elapsedMs:searches.reduce((sum,search)=>sum+search.elapsedMs,0),source:"model"};
}
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
  const home:Point={location:input.location,name:input.name,poiId:amapPoiId(input.poiId)};
  const encoder=new TextEncoder();
  const apiSignal=AbortSignal.any([request.signal,AbortSignal.timeout(VERIFY_TIMEOUT_MS)]);
  const refresh=input.refresh===true;
  const apiOptions={signal:apiSignal,refresh};
  const selectedOffices=[...new Set(input.officeIds)].map(id=>offices.find(o=>o.id===id)!);
  function prepareAccess(toHome:boolean){
    const candidatesByOffice=new Map(selectedOffices.map(office=>[office.id,toHome
      ?returnCandidates(office,home.location):preparedCandidates(office.id,home.location)]));
    const targets=new Map<string,Coord>();
    for(const candidates of candidatesByOffice.values())for(const candidate of candidates)targets.set(coordinateKey(candidate.entry.location),candidate.entry.location);
    return {candidatesByOffice,targets:[...targets.values()],targetIndices:new Map([...targets.keys()].map((key,index)=>[key,index]))};
  }
  const accessByDirection=new Map<boolean,ReturnType<typeof prepareAccess>>();
  const localByDirection=new Map<boolean,ReturnType<typeof localAccessTimes>>();
  let cancelled=false;
  const stream=new ReadableStream({
    async start(controller) {
      const send=(value:unknown)=>{if(!cancelled)controller.enqueue(encoder.encode(JSON.stringify(value)+"\n"));};
      const stopped=()=>cancelled||request.signal.aborted;
      const canQuery=()=>!stopped()&&!apiSignal.aborted;
      try{
        for(const office of selectedOffices) {
          if(stopped())break;
          const startedAt=Date.now(),measuredAt=new Date(startedAt).toISOString();
          const officePoint:Point={location:office.entrance as Coord,name:office.name,poiId:office.poiId};
          const firstStage=firstQueryStage(coverage,office.id,home.location);
          const egressVersion=egressByOffice.get(office.id)?.version;
          const outboundVersion=[office.name,office.entrance,office.poiId,
            "walkingIdentity" in office?office.walkingIdentity:null,DURATION_ROUNDING_VERSION,LIMITS,METRO_DRILL_DOWN_FROM,METRO_DEPARTURE.label,prepared.methodVersion,prepared.generatedAt,preparedReady,
            ...(egressVersion?[egressVersion]:[])];
          const returnVersion=[office.name,office.entrance,office.poiId,DURATION_ROUNDING_VERSION,LIMITS,METRO_DRILL_DOWN_FROM,
            METRO_DEPARTURE.label,"to-home",preparedReturn.methodVersion,preparedReturn.generatedAt,returnOfficeReady(office)];
          const runs=await Promise.all([false,true].map(async(toHome):Promise<DirectionRun>=>{
            const version=toHome?returnVersion:outboundVersion;
            const key=verificationCacheKey(office.id,home.location,home.poiId,JSON.stringify(firstStage==="surface"?version:[...version,firstStage]));
            const cached=await readSharedVerification(key,home.name);
            const reuse=cached&&!refresh;
            return {toHome,origin:toHome?officePoint:home,destination:toHome?home:officePoint,key,cached,
              result:reuse?cached:{officeId:office.id,plans:[],complete:true,checked:0,errors:[],measuredAt},
              finished:!!reuse,started:!!reuse};
          }));
          if(stopped())break;
          const bestMetro=(run:DirectionRun)=>Math.min(...run.result.plans.filter(p=>p.mode==="metro"&&p.qualified).map(p=>p.duration));
          const stage=(stage:QueryStage)=>send({type:"stage",officeId:office.id,stage});
          const available=()=>runs.filter(run=>!run.finished);

          function publish(run:DirectionRun,plan:Plan,preparedPlanId?:string) {
            const current=run.result.plans.findIndex(candidate=>candidate.id===plan.id);
            if(current>=0&&run.result.plans[current].duration<=plan.duration)return;
            if(current>=0)run.result.plans[current]=plan;else run.result.plans.push(plan);
            send({type:"plan",plan,preparedPlanId,originalTotalDuration:plan.originalReferenceDuration,originalReferenceScope:plan.originalReferenceScope});
          }

          function createPlan(run:DirectionRun,id:string,title:string,mode:Plan["mode"],legs:Leg[],date:string,details:Partial<Plan>={}):Plan {
            const duration=sumLegDurations(legs);
            return {id,officeId:office.id,...(run.toHome?{direction:"to-home"}:{}),mode,title,duration,limit:LIMITS[mode],
              qualified:qualified(duration,mode),legs,measuredAt:date,source:"amap",...details};
          }

          async function direct(run:DirectionRun,phase:"surface"|"metro-full") {
            const {origin,destination,result,toHome}=run;
            const options={...apiOptions,originPoiId:origin.poiId,destinationPoiId:destination.poiId};
            const suffix=toHome?"-return":"";
            run.started=true;
            if(phase==="surface"){
              await Promise.all((["walking","bicycling"] as const).map(async mode=>{
                if(!canQuery())return;
                try{
                  result.checked++;
                  const raw=await surfaceLeg(mode,origin.location,destination.location,origin.name,destination.name,options);
                  if(raw)publish(run,createPlan(run,`${office.id}-${mode}${suffix}`,mode==="walking"?"全程步行":"全程自行车",mode,[roundLeg(raw)],raw.measuredAt??measuredAt));
                }catch(error){result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"路线暂未完成查询。");}
              }));
            }else try{
              result.checked++;
              const raw=await fullMetro(origin.location,destination.location,origin.name,destination.name,options);
              if(raw){
                const {recommendedMetro,...leg}=raw;
                run.recommendation=recommendedMetro;
                publish(run,createPlan(run,`${office.id}-metro-full${suffix}`,"地铁完整方案","metro",[roundLeg(leg)],leg.measuredAt??measuredAt,
                  {metroMethod:"full",note:`高德总时长，含步行、换乘及接口计入的候车。查询时刻：${METRO_DEPARTURE.label}。`}));
              }
            }catch(error){result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"完整地铁方案暂未完成查询。");}
            if(isDecisive(result))run.finished=true;
          }

          const station=(name:string)=>stationData.stations.find(s=>s.name===name);
          const railLeg=(leg:Leg)=>{
            if(leg.mode!=="metro")return leg;
            const a=station(leg.from.replace(/站$/,"")),b=station(leg.to.replace(/站$/,""));
            return {...leg,origin:a?a.location as Coord:leg.origin,destination:b?b.location as Coord:leg.destination,
              originPoiId:a?.id,destinationPoiId:b?.id};
          };

          async function* segmented(run:DirectionRun) {
            const {origin,destination,result,recommendation,toHome}=run;
            const proofs=new Map<string,Promise<Leg|null>>();
            let continueAccess=true;
            const querySurface=(mode:"walking"|"bicycling",from:Point,to:Point)=>{
              const key=JSON.stringify([mode,coordinateKey(from.location),coordinateKey(to.location),...(mode==="walking"?[from.poiId,to.poiId]:[])]);
              if(!proofs.has(key)){
                result.checked++;
                proofs.set(key,surfaceLeg(mode,from.location,to.location,from.name,to.name,{...apiOptions,originPoiId:from.poiId,destinationPoiId:to.poiId}));
              }
              return proofs.get(key)!;
            };
            const accessError=(error:unknown)=>{
              result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"接驳路线暂未完成查询。");
              if(apiSignal.aborted||!(error instanceof MapApiError)||!["NETWORK","REQUEST_TIMEOUT"].includes(error.code))continueAccess=false;
            };
            if(recommendation){
              const boarding=station(recommendation.entry.stationName),alighting=station(recommendation.exit.stationName);
              const head=toHome&&boarding&&returnOfficeReady(office)?preparedReturn.access[office.id]?.[boarding.name]:undefined;
              const tail=!toHome&&alighting?fixedEgress(office.id,alighting.name):undefined;
              const entryGates=head?[]:recommendedStreetGates(recommendation.entry,boarding?prepared.entries[boarding.id]??[]:[]);
              const exitGates=tail?[]:recommendedStreetGates(recommendation.exit,alighting?prepared.entries[alighting.id]??[]:[]);
              if((head||entryGates.length)&&(tail||exitGates.length)&&boarding&&alighting&&boarding.id!==alighting.id){
                let proof:Awaited<ReturnType<typeof stationMetro>>=null;
                try{result.checked++;proof=await stationMetro(boarding,alighting,apiOptions);}
                catch(error){accessError(error);}
                if(proof){
                  const rails=proof.legs.map(leg=>roundLeg({...railLeg(leg),measuredAt:proof.measuredAt}));
                  const first:Leg[]=head?[roundLeg(head)]:[],last:Leg[]=tail?[roundLeg(tail)]:[];
                  for(const mode of ["walking","bicycling"] as const){
                    if(!canQuery()||!continueAccess)break;
                    const responses=await Promise.allSettled([
                      ...entryGates.map(gate=>querySurface(mode,origin,{...gate,poiId:gate.id})),
                      ...exitGates.map(gate=>querySurface(mode,{...gate,poiId:gate.id},destination)),
                    ]);
                    responses.forEach((response,index)=>{
                      if(response.status==="rejected")accessError(response.reason);
                      else if(response.value)(index<entryGates.length?first:last).push(roundLeg(response.value));
                    });
                    const legs=first.flatMap(a=>last.map(b=>[a,...rails,b])).sort((a,b)=>sumLegDurations(a)-sumLegDurations(b))[0];
                    if(legs)publish(run,createPlan(run,`${office.id}-metro-recommended${toHome?"-return":""}`,`经${boarding.name}站`,"metro",legs,proof.measuredAt,
                      {metroMethod:"segmented",originalReferenceDuration:proof.originalTotalDuration,originalReferenceScope:"stations",
                        note:`地铁按车站到车站查询，计入站内换乘。地铁参考时刻：${METRO_DEPARTURE.label}。`}));
                    if(isDecisive(result)){run.finished=true;return;}
                    yield;
                  }
                }
              }
              if(!continueAccess||!canQuery())return;
            }
            if(!canQuery())return;
            if(!accessByDirection.has(toHome))accessByDirection.set(toHome,prepareAccess(toHome));
            const {candidatesByOffice,targets,targetIndices}=accessByDirection.get(toHome)!;
            const candidates=candidatesByOffice.get(office.id)!;
            if(!(toHome?returnOfficeReady(office):preparedReady)){
              result.complete=false;result.errors.push(toHome?"返程地铁分段数据暂未就绪。":"车站到车站的地铁方案正在重算，暂不使用旧方案判定。");
            }else if(!candidates.length&&!toHome){
              result.complete=false;result.errors.push("当前工区的地铁分段数据未就绪，已保留其他路线结果。");
            }
            if(!candidates.length){run.finished=true;return;}
            if(!localByDirection.has(toHome))localByDirection.set(toHome,localAccessTimes(home.location,targets,request.url,toHome));
            const measured=await withinDeadline(localByDirection.get(toHome)!,apiSignal);
            const times=candidates.map(candidate=>measured?.times[targetIndices.get(coordinateKey(candidate.entry.location))!]??{walking:null,bicycling:null});
            const ranked=rankAccessCandidates(candidates,times);
            if(measured){
              result.localSearch={...ranked.summary,elapsedMs:measured.elapsedMs,source:"model"};
              send({type:"local-search",officeId:office.id,localSearch:combineSearch(runs.map(run=>run.result))});
            }else if(!apiSignal.aborted){
              result.complete=false;result.errors.push("本地路网暂不可用，已保留高德结果。");
            }
            for(const {candidate,mode} of ranked.proofs) {
              if(!canQuery())return;
              if(candidate.plan.duration+60>=bestMetro(run))continue;
              try{
                const gate:Point={...candidate.entry,poiId:candidate.entry.id};
                const raw=await querySurface(mode,toHome?gate:home,toHome?home:gate);
                if(raw){
                  const localLeg=roundLeg(raw);
                  const fixed=candidate.plan.legs.map((leg,index)=>{
                    if(leg.mode==="metro")return railLeg(leg);
                    if(toHome||index!==candidate.plan.legs.length-1||leg.kind==="transfer"||leg.routingIdentity!=="poi")return leg;
                    const exit=entrances.get(entranceKey(leg.from,leg.origin));
                    return {...leg,originPoiId:leg.originPoiId??exit?.id,destinationPoiId:leg.destinationPoiId??office.poiId};
                  });
                  const legs=toHome?[...fixed,localLeg]:[localLeg,...fixed];
                  const boarding=legs.find(leg=>leg.mode==="metro")!.from;
                  publish(run,createPlan(run,candidate.plan.id,`经${boarding}`,"metro",legs,candidate.plan.measuredAt,
                    {metroMethod:"segmented",originalReferenceDuration:candidate.plan.originalTotalDuration,originalReferenceScope:candidate.plan.originalReferenceScope,
                      note:`地铁参考时刻：${METRO_DEPARTURE.label}。`}),toHome?undefined:candidate.plan.id);
                  if(isDecisive(result)){run.finished=true;return;}
                }
              }catch(error){
                accessError(error);
                if(!continueAccess)return;
              }
              yield;
            }
            if(canQuery())run.finished=true;
          }

          if(available().length&&canQuery()){
            send({type:"office-start",officeId:office.id,stage:firstStage});
            for(const run of runs)for(const plan of run.result.plans)send({type:"plan",plan,originalTotalDuration:plan.originalReferenceDuration,originalReferenceScope:plan.originalReferenceScope});
            const phases=firstStage==="surface"?["surface","metro-full"] as const:["metro-full"] as const;
            for(const phase of phases){
              if(!available().length||!canQuery())break;
              stage(phase);
              for(const run of available()){
                if(!canQuery())break;
                await direct(run,phase);
              }
            }
            if(canQuery()&&available().length){
              stage("metro-segmented");
              let pending=available().map(run=>segmented(run));
              while(pending.length&&canQuery()){
                const next:typeof pending=[];
                for(const iterator of pending){
                  if(!canQuery())break;
                  if(!(await iterator.next()).done)next.push(iterator);
                }
                pending=next;
              }
            }
          }

          const finished=runs.every(run=>run.finished);
          if(apiSignal.aborted&&!stopped()&&!finished){
            const pass=runs.some(run=>run.result.plans.some(plan=>plan.qualified));
            const unfinished=runs.find(run=>!run.finished)!;
            unfinished.result.errors.push(pass?"分段比较已到时限，已保留达标方案。":"高德核验超时，已有结果已保留。");
          }
          const final:Verification[]=[];
          for(const run of runs){
            const result=run.result;
            if(!result.reused){
              result.complete=result.complete&&run.finished;
              result.errors=[...new Set(result.errors)];
              sortedPlans(result.plans);
              if(run.started&&refresh&&run.cached&&(!result.complete||!result.plans.length)&&!result.plans.some(plan=>plan.qualified)){
                final.push({...run.cached,errors:["未完成重新核验，已保留上次结果。"]});
                continue;
              }
              if(run.finished&&run.started&&!stopped())await writeSharedVerification(run.key,result,startedAt);
            }
            if(run.started||result.errors.length)final.push(result);
          }
          const plans=sortedPlans(final.flatMap(result=>result.plans));
          const result:Verification={officeId:office.id,plans,complete:!stopped()&&finished&&!final.some(r=>r.errors.length),
            checked:final.reduce((sum,r)=>sum+r.checked,0),errors:[...new Set(final.flatMap(r=>r.errors))],measuredAt:final[0]?.measuredAt??measuredAt,
            localSearch:combineSearch(final),...(final.some(r=>r.reused)&&final.every(r=>r.reused||(!r.plans.length&&!r.errors.length))?{reused:true}:{})};
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
