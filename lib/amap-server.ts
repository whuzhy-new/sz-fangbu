import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { polyline, surfaceDuration, type Coord, type Leg } from "./commute";
import { fullMetroLeg, type FullMetroLeg } from "./full-metro";
import {surfaceRouteParams,transitRouteParams} from "./amap-route-params";

export const METRO_DEPARTURE = {date:"2026-11-09",time:"09-00",label:"2026-11-09 09:00"};

type Json = Record<string, any>;
export class MapApiError extends Error { constructor(message: string, public code = "MAP_ERROR") { super(message); } }
type RequestOptions={signal?:AbortSignal};
type RouteRequestOptions=RequestOptions&{originPoiId?:string;destinationPoiId?:string};
export const AMAP_REQUEST_TIMEOUT_MS=8000;
const timeoutError=()=>new MapApiError("高德核验超时，已有结果已保留。", "TIME_BUDGET");
const wait = (ms:number,signal?:AbortSignal) => new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(timeoutError());return;}
  const cancel=()=>{clearTimeout(timer);reject(timeoutError());};
  const timer=setTimeout(()=>{signal?.removeEventListener("abort",cancel);resolve();},ms);
  signal?.addEventListener("abort",cancel,{once:true});
});

export async function amap(service: string, params: Record<string, string | number>, category: "routes" | "search" = "routes", options:RequestOptions={}): Promise<{data:Json; createdAt:number; cached:boolean}> {
  if(options.signal?.aborted)throw timeoutError();
  if (!env.AMAP_WEB_KEY) throw new MapApiError("地图服务尚未配置，请稍后重试。", "MISSING_KEY");
  if (!env.DB) throw new MapApiError("调用预算服务未就绪，已暂停地图请求。", "NO_BUDGET_STORE");
  const started=Date.now();
  const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(AMAP_REQUEST_TIMEOUT_MS)]);
  let phase="cache",cached=false;
  try {
    const cacheKey = createHash("sha256").update(JSON.stringify([service, Object.entries(params).sort()])).digest("hex");
    const now = Date.now();
    const hit = await env.DB.prepare("SELECT payload, created_at FROM api_cache WHERE key=? AND expires_at>?").bind(cacheKey, now).first<{payload:string; created_at:number}>();
    if(signal.aborted)throw timeoutError();
    if (hit) {cached=true;return {data:JSON.parse(hit.payload), createdAt:hit.created_at, cached:true};}
    phase="budget";
    const month = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit" }).format(now);
    const bucket = `${month}:${category}`;
    const limit = Number(category === "search" ? env.AMAP_SEARCH_MONTHLY_LIMIT ?? 3000 : env.AMAP_APP_MONTHLY_LIMIT ?? 100000);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new MapApiError("免费调用预算未设置，已暂停查询。", "BUDGET_CONFIG");
    const reserved = await env.DB.prepare("INSERT INTO api_usage(bucket,count) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count").bind(bucket, limit).first<{count:number}>();
    if (!reserved) throw new MapApiError("本月已达到应用设置的免费调用上限。已有地图仍可浏览，待额度恢复后再核验。", "BUDGET_LIMIT");
    if(signal.aborted)throw timeoutError();
    phase="queue";
    const queueNow=Date.now();
    const slot = await env.DB.prepare("INSERT INTO api_usage(bucket,count) VALUES('request-slot',?) ON CONFLICT(bucket) DO UPDATE SET count=MAX(count,?)+650 RETURNING count").bind(queueNow+650,queueNow).first<{count:number}>();
    if (slot) await wait(Math.max(0, slot.count - Date.now()),signal);
    if(signal.aborted)throw timeoutError();
    const search = new URLSearchParams(Object.entries(params).map(([k,v]) => [k,String(v)]));
    search.set("key", env.AMAP_WEB_KEY);
    let data:Json;
    phase="upstream";
    try {
      const response = await fetch(`https://restapi.amap.com/${service}?${search}`, { signal });
      if (!response.ok) throw new Error("HTTP error");
      data = await response.json() as Json;
    } catch { if(options.signal?.aborted)throw timeoutError();throw new MapApiError("暂时无法连接高德，当前地点尚未完成核验，请重试。", "NETWORK"); }
    if (String(data.status) !== "1") {
      const quota = ["10003","10004","10014","10019","10020","10021","10044","10045"].includes(String(data.infocode));
      throw new MapApiError(quota ? "高德额度或请求频率受限，请稍后再试。当前地点尚未完成核验。" : `地图暂未返回可用结果（${String(data.infocode)}）。`, String(data.infocode));
    }
    const createdAt = Date.now();
    const ttl = category === "search" ? 30 * 86400000 : 7 * 86400000;
    phase="store";
    await env.DB.prepare("INSERT INTO api_cache(key,payload,created_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at").bind(cacheKey,JSON.stringify(data),createdAt,createdAt+ttl).run();
    return {data,createdAt,cached:false};
  } catch(error) {
    const failure=signal.aborted?(options.signal?.aborted?timeoutError():new MapApiError("高德当前方案查询超时，已有结果已保留。", "REQUEST_TIMEOUT")):error;
    // Never log request URLs, credentials or users' locations.
    console.warn("amap-request-failed",{service,category,phase,elapsedMs:Date.now()-started,code:failure instanceof MapApiError?failure.code:"INTERNAL"});
    throw failure;
  } finally {
    console.info("amap-request",{service,category,cached,elapsedMs:Date.now()-started});
  }
}

export async function surfaceLeg(mode: "walking" | "bicycling", origin: Coord, destination: Coord, from:string, to:string,options:RouteRequestOptions={}): Promise<Leg | null> {
  const identity=surfaceRouteParams(mode,origin,destination,options);
  const {data,createdAt,cached} = await amap(`v5/direction/${mode}`,identity.params,"routes",options);
  const path = data.route?.paths?.[0];
  const duration = surfaceDuration(path);
  if (duration===null) return null;
  return {mode,label:mode === "walking" ? "步行" : "自行车",origin,destination,from,to,...identity.endpoints,duration,distance:Number(path.distance),paths:(path.steps ?? []).map((s:Json) => polyline(s.polyline)).filter((p:Coord[])=>p.length>1),instructions:(path.steps??[]).map((s:Json)=>String(s.instruction??"")).filter(Boolean),source:"amap",measuredAt:new Date(createdAt).toISOString(),cached};
}

export async function fullMetro(origin:Coord,destination:Coord,from:string,to:string,options:RouteRequestOptions={}):Promise<FullMetroLeg|null> {
  const identity=transitRouteParams(origin,destination,options);
  const {data,createdAt,cached}=await amap("v5/direction/transit/integrated",{
    ...identity.params,
    city1:"0755",city2:"0755",strategy:7,AlternativeRoute:10,
    date:METRO_DEPARTURE.date,time:METRO_DEPARTURE.time,show_fields:"cost,polyline,navi",
  },"routes",options);
  const leg=fullMetroLeg(data,origin,destination,from,to);
  return leg?{...leg,...identity.endpoints,measuredAt:new Date(createdAt).toISOString(),cached}:null;
}
