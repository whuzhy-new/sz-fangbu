import {roundDuration, type Coord} from "./commute.ts";
import type {AccessTime,AccessMode} from "./local-road-network.ts";

// Stream early results; allow sequential route queries to finish on hosted Workers.
export const VERIFY_TIMEOUT_MS=60000;
export type AccessCandidate={plan:{stationId:string;duration:number};entry:{id:string;location:Coord};distance:number};

/** Compare every prepared entrance/mode; model times rank API proofs only. */
export function rankAccessCandidates<T extends AccessCandidate>(candidates:T[],times:AccessTime[]) {
  const tasks=candidates.flatMap((candidate,index)=>(["bicycling","walking"] as AccessMode[]).map(mode=>{
    const access=times[index]?.[mode]??null;
    return {candidate,mode,key:`${candidate.plan.stationId}:${candidate.entry.id}:${mode}`,estimatedAccess:access,
      estimatedDuration:access===null?null:candidate.plan.duration+roundDuration(access),
      score:access===null?candidate.plan.duration+roundDuration(candidate.distance/(mode==="walking"?1.25:2.5))+1800:candidate.plan.duration+access};
  }));
  const finite=tasks.filter(task=>task.estimatedDuration!==null);
  const summary={total:tasks.length,reachable:finite.length,withinLimit:finite.filter(task=>task.estimatedDuration!<=1200).length,
    bestDuration:finite.length?Math.min(...finite.map(task=>task.estimatedDuration!)):null};
  const unique=new Map<string,typeof tasks[number]>();
  for(const task of tasks) {
    const key=`${task.candidate.entry.location.map(n=>n.toFixed(6)).join(",")}:${task.mode}`;
    const previous=unique.get(key);
    if(!previous||task.candidate.plan.duration<previous.candidate.plan.duration)unique.set(key,task);
  }
  const sorted=[...unique.values()].filter(task=>task.candidate.plan.duration+roundDuration(task.candidate.distance/(task.mode==="walking"?2.5:12))<=1200)
    .sort((a,b)=>a.score-b.score||a.key.localeCompare(b.key));
  // Nearby entrances must get a walking proof even when the local bicycle
  // estimate is faster. Real bike directions can require a long detour across
  // divided roads; cycling failure says nothing about walking to the same gate.
  const nearbyWalking=sorted.filter(task=>task.mode==="walking"&&task.candidate.distance<=500)
    .sort((a,b)=>a.candidate.distance-b.candidate.distance||a.score-b.score)[0];
  const opposite=nearbyWalking?sorted.filter(task=>task.mode==="walking"&&task.key!==nearbyWalking.key&&task.candidate.plan.stationId===nearbyWalking.candidate.plan.stationId&&task.candidate.distance<=Math.min(500,nearbyWalking.candidate.distance*2+50))
    .map(task=>{
      const a=nearbyWalking.candidate,b=task.candidate;
      // Compare bearings without needing the original point: its distance to
      // each entrance plus entrance separation gives the angle by cosine law.
      const separation=Math.hypot((a.entry.location[0]-b.entry.location[0])*Math.cos(a.entry.location[1]*Math.PI/180),(a.entry.location[1]-b.entry.location[1]))*Math.PI/180*6371008.8;
      const cosine=(a.distance*a.distance+b.distance*b.distance-separation*separation)/(2*a.distance*b.distance);
      return {task,cosine};
    }).filter(option=>Number.isFinite(option.cosine)&&option.cosine<-.7).sort((a,b)=>a.cosine-b.cosine)[0]?.task:undefined;
  const preferred=[nearbyWalking,opposite].filter((task):task is typeof tasks[number]=>!!task);
  const preferredKeys=new Set(preferred.map(task=>task.key));
  const ordered=[...preferred,...sorted.filter(task=>!preferredKeys.has(task.key))];
  const perStation=new Map<string,number>(),proofs:typeof tasks=[],deferred:typeof tasks=[];
  for(const task of ordered) {
    const station=task.candidate.plan.stationId,count=perStation.get(station)??0;
    // Give different stations a chance first, then retain the remaining gates
    // for the same shared deadline instead of cutting off after three proofs.
    if(count>=2){deferred.push(task);continue;}
    proofs.push(task);perStation.set(station,count+1);
  }
  return {tasks,proofs:[...proofs,...deferred],summary};
}
