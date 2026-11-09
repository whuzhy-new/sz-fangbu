import { polyline, surfaceDuration, type Coord, type Leg } from "./commute.ts";

// Keep the provider's complete journey total. It includes access, egress,
// transfers and provider waiting estimates; do not rebuild it from line times.
type Walking = { steps?:{polyline?:unknown}[] };
type Line = {type?:string;name?:string;polyline?:unknown;departure_stop?:{name?:string};arrival_stop?:{name?:string}};
type Segment = {walking?:Walking;bus?:{buslines?:Line[]};railway?:unknown;taxi?:unknown;riding?:unknown};
type Transit = {cost?:{duration?:unknown};duration?:unknown;distance?:unknown;segments?:Segment[]};
type TransitResponse = {route?:{transits?:Transit[]}};
const populated=(value:unknown):boolean=>value!=null&&typeof value==="object"&&Object.keys(value).length>0;

export function fullMetroLeg(data:TransitResponse, origin:Coord, destination:Coord, from:string, to:string):Leg|null {
  const options:Leg[]=[];
  for(const transit of data.route?.transits??[]) {
    const segments=transit.segments??[];
    const lines=segments.flatMap(s=>s.bus?.buslines??[]);
    if(!lines.length||lines.some(l=>l.type!=="地铁线路"))continue;
    if(segments.some(s=>populated(s.railway)||populated(s.taxi)||populated(s.riding)))continue;
    const duration=surfaceDuration(transit);
    if(duration===null||duration<=0)continue;
    const paths=segments.flatMap(s=>[
      ...(s.walking?.steps??[]).map(step=>polyline(step.polyline)),
      ...((s.bus?.buslines??[]).slice(0,1).map(line=>polyline(line.polyline))),
    ]).filter(path=>path.length>1);
    const usedLines=segments.flatMap(s=>(s.bus?.buslines??[]).slice(0,1));
    const label=usedLines.map(l=>`${l.departure_stop?.name??"上车站"} → ${l.arrival_stop?.name??"下车站"} · ${(l.name??"地铁").split("(")[0]}`).join("；");
    options.push({mode:"metro",kind:"full-transit",label,origin,destination,from,to,duration,distance:Number(transit.distance)||0,paths,source:"amap"});
  }
  return options.sort((a,b)=>a.duration-b.duration)[0]??null;
}
