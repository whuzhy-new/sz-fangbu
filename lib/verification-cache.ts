import {env} from "cloudflare:workers";
import {createHash} from "node:crypto";
import type {Coord,Verification} from "./commute";

const TTL=7*86400000;
const MAX_PAYLOAD_BYTES=1_000_000;

export function verificationCacheKey(officeId:string,location:Coord,poiId:string|undefined,routeVersion:string):string {
  const endpoint=location.map(value=>value.toFixed(6));
  const hash=createHash("sha256").update(JSON.stringify([officeId,endpoint,poiId??null,routeVersion])).digest("hex");
  return `verification:v1:${hash}`;
}

function withResidenceName(result:Verification,name:string):Verification {
  return {...result,plans:result.plans.map(plan=>({...plan,legs:plan.legs.map((leg,index)=>{
    if(plan.direction==="to-home")return index===plan.legs.length-1?{...leg,to:name}:leg;
    return index===0?{...leg,from:name}:leg;
  })}))};
}

export async function readSharedVerification(key:string,name:string):Promise<Verification|null> {
  if(!env.DB)return null;
  try {
    const hit=await env.DB.prepare("SELECT payload FROM api_cache WHERE key=? AND expires_at>?").bind(key,Date.now()).first<{payload:string}>();
    if(!hit)return null;
    const saved=JSON.parse(hit.payload) as Verification;
    if(!saved.complete||!Array.isArray(saved.plans)||!saved.plans.length)return null;
    return withResidenceName({...saved,reused:true,checked:0},name);
  }catch {
    console.warn("shared-verification-read-failed");
    return null;
  }
}

export async function writeSharedVerification(key:string,result:Verification,startedAt:number):Promise<void> {
  if(!env.DB||!result.complete||!result.plans.length||result.errors.length||result.reused)return;
  // Keep the route geometry and endpoints, but never share a visitor's label.
  const payload=JSON.stringify(withResidenceName(result,"住宅"));
  if(new TextEncoder().encode(payload).byteLength>MAX_PAYLOAD_BYTES)return;
  try {
    await env.DB.prepare("INSERT INTO api_cache(key,payload,created_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, created_at=excluded.created_at, expires_at=excluded.expires_at WHERE excluded.created_at>=api_cache.created_at")
      .bind(key,payload,startedAt,startedAt+TTL).run();
  }catch {
    console.warn("shared-verification-write-failed");
  }
}
