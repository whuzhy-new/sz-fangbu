import type {CommuteDirection,Plan} from "./commute.ts";

/** Keep distinct direct modes; avoid a list of slower segmented detours. */
export function visiblePlans(plans:Plan[]=[]):Plan[] {
  const sorted=plans.filter(plan=>plan.mode!=="metro"||plan.metroMethod==="full"||plan.legs.find(leg=>leg.mode==="metro")?.from===plan.title.replace(/^经/,""))
    .sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.duration-b.duration);
  const seenSegments=new Set<CommuteDirection>();
  return sorted.filter(plan=>{
    if(plan.metroMethod!=="segmented")return true;
    const direction=plan.direction??"to-office";
    const first=!seenSegments.has(direction);
    seenSegments.add(direction);
    return plan.qualified||first;
  });
}
