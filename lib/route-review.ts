import {mapLink,sumLegDurations,type AmapPlatform,type Leg,type Plan} from "./commute.ts";

export type ReviewRoute={id:string;label:string;leg:Leg;url:string|null};

/** One link per measurement page; station transfers remain in the middle page. */
export function reviewRoutes(plan:Plan,platform:AmapPlatform="ios"):ReviewRoute[] {
  const route=(id:string,label:string,leg:Leg):ReviewRoute=>({id,label,leg,url:mapLink(leg,platform)});
  if(plan.metroMethod!=="segmented")return plan.legs.map((leg,index)=>route(`full-${index}`,"完整路线",leg));
  const first=plan.legs.findIndex(leg=>leg.mode==="metro");
  const last=plan.legs.findLastIndex(leg=>leg.mode==="metro");
  if(first<0)return plan.legs.map((leg,index)=>route(`leg-${index}`,leg.label,leg));
  const start=plan.legs[first],end=plan.legs[last];
  const rail:Leg={...start,label:"地铁",to:end.to,destination:end.destination,destinationPoiId:end.destinationPoiId,kind:undefined,rawDuration:undefined,
    duration:sumLegDurations(plan.legs.slice(first,last+1)),paths:[]};
  return [
    ...(first>0?[route("access","进站接驳",plan.legs[0])]:[]),
    route("metro","地铁",rail),
    ...(last<plan.legs.length-1?[route("egress","出站接驳",plan.legs.at(-1)!)]:[]),
  ];
}
