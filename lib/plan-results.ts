import type {Plan} from "./commute.ts";

/** Keep distinct direct modes; avoid a list of slower segmented detours. */
export function visiblePlans(plans:Plan[]=[]):Plan[] {
  const sorted=plans.filter(plan=>plan.mode!=="metro"||plan.metroMethod==="full"||plan.legs.find(leg=>leg.mode==="metro")?.from===plan.title.replace(/^经/,""))
    .sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.duration-b.duration);
  const bestSegment=sorted.find(plan=>plan.metroMethod==="segmented");
  return sorted.filter(plan=>plan.metroMethod!=="segmented"||plan.qualified||plan.id===bestSegment?.id);
}
