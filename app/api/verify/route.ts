import offices from "@/public/data/offices.json";
import metro from "@/data/metro-index.json";
import stationData from "@/public/data/stations.json";
import { surfaceLeg, MapApiError } from "@/lib/amap-server";
import { distanceMeters, qualified, withinShenzhen, type Coord, type Leg, type Plan, type Verification } from "@/lib/commute";

type Prepared = { id:string; stationId:string; stationName:string; officeId:string; duration:number; legs:Leg[]; measuredAt:string; originalTotalDuration?:number|null };
type Entry = { id:string;name:string;location:Coord;source:string };
type Index = {complete:boolean;plans:Record<string,Record<string,Prepared>>;entries:Record<string,Entry[]>;generatedAt?:string};

export async function POST(request: Request) {
  let input:{location:Coord; name:string;officeIds:string[]};
  try { input = await request.json(); } catch { return Response.json({error:"地址格式有误。"},{status:400}); }
  if (!Array.isArray(input.location) || !withinShenzhen(input.location) || typeof input.name!=="string" || input.name.length>120 || !Array.isArray(input.officeIds) || input.officeIds.length>3 || !input.officeIds.length || input.officeIds.some(id=>!offices.some(o=>o.id===id))) return Response.json({error:"请选择深圳范围内的位置和有效工区。"},{status:400});
  const encoder = new TextEncoder();
  let cancelled=false;
  const stream = new ReadableStream({
    async start(controller) {
      const send=(value:unknown)=>{if(!cancelled)controller.enqueue(encoder.encode(JSON.stringify(value)+"\n"));};
      const stopped=()=>cancelled || request.signal.aborted;
      try {
        for (const office of [...new Set(input.officeIds)].map(id=>offices.find(o=>o.id===id)!)) {
          if(stopped())break;
          const result:Verification={officeId:office.id,plans:[],complete:true,checked:0,errors:[],measuredAt:new Date().toISOString()};
          send({type:"office-start",officeId:office.id});
          for(const mode of ["walking","bicycling"] as const) {
            if(stopped())break;
            try {
              const leg=await surfaceLeg(mode,input.location,office.entrance as Coord,input.name,office.name);result.checked++;
              if(leg) {
                const plan:Plan={id:`${office.id}-${mode}`,officeId:office.id,mode,title:mode==="walking"?"全程步行":"全程自行车",duration:leg.duration,limit:mode==="walking"?1800:1200,qualified:qualified(leg.duration,mode),legs:[leg],measuredAt:leg.measuredAt??new Date().toISOString(),source:"amap"};
                result.plans.push(plan);send({type:"plan",plan});
              }
            }catch(error){result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"路线暂未完成查询。");}
          }
          const prepared=metro as unknown as Index;
          if(!prepared.complete){result.complete=false;result.errors.push("地铁参考方案仍在预计算；目前的地铁候选尚未覆盖全线网。");}
          const candidates=Object.values(prepared.plans[office.id]??{}).flatMap(plan=>(prepared.entries[plan.stationId]??[]).map(entry=>({plan,entry,distance:distanceMeters(input.location,entry.location)})))
            .filter(c=>c.entry.source==="amap" && c.plan.duration+c.distance/12<=1200)
            .sort((a,b)=>(a.plan.duration+a.distance/3)-(b.plan.duration+b.distance/3));
          // Stream a useful proof first. Explicitly report that alternative routes have not been exhausted.
          let calls=0;
          for(const candidate of candidates) {
            if(stopped())break;
            if(calls>=24){result.complete=false;break;}
            for(const mode of ["bicycling","walking"] as const) {
              if(stopped()||calls>=24)break;
              const speedBound=mode==="walking"?2.5:12;
              if(candidate.plan.duration+candidate.distance/speedBound>1200)continue;
              try {
                calls++;result.checked++;
                const first=await surfaceLeg(mode,input.location,candidate.entry.location,input.name,candidate.entry.name);
                if(!first)continue;
                const duration=first.duration+candidate.plan.duration;
                if(duration>1200)continue;
                const legs=[first,...candidate.plan.legs.map(l=>{
                  if(l.mode!=="metro")return l;
                  const pair=l.instructions?.[0]?.split("：")[1]?.split(" → ");
                  const a=stationData.stations.find(s=>s.name===pair?.[0]),b=stationData.stations.find(s=>s.name===pair?.[1]);
                  return {...l,from:a?a.name+"站":l.from,to:b?b.name+"站":l.to,origin:a?a.location as Coord:l.origin,destination:b?b.location as Coord:l.destination};
                })];
                const plan:Plan={id:candidate.plan.id,officeId:office.id,mode:"metro",title:`经${candidate.plan.stationName}站`,duration,limit:1200,qualified:true,legs,measuredAt:candidate.plan.measuredAt,source:"amap",note:"按当前自定义分段口径：地面接驳＋高德地铁路段耗时＋站内换乘。首次进站和最终出站的站内步行不另加。地铁参考时刻：2026-11-09 09:00。"};
                const existing=result.plans.findIndex(p=>p.id===plan.id);
                if(existing>=0&&result.plans[existing].duration<=plan.duration)continue;
                if(existing>=0)result.plans[existing]=plan;else result.plans.push(plan);
                send({type:"plan",plan,preparedPlanId:candidate.plan.id,originalTotalDuration:candidate.plan.originalTotalDuration});
              }catch(error){result.complete=false;result.errors.push(error instanceof MapApiError?error.message:"接驳路线暂未完成查询。");break;}
            }
          }
          result.errors=[...new Set(result.errors)];
          result.plans.sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.duration-b.duration);
          send({type:"office-result",result});
        }
        send({type:"done"});
      }catch {send({type:"error",message:"查询暂时中断，已有结果已保留，其余方案尚未完成核验。"});}
      finally {if(!cancelled)controller.close();}
    },
    cancel(){cancelled=true;},
  });
  return new Response(stream,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
