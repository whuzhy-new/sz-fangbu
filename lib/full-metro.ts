import { polyline, surfaceDuration, type Coord, type Leg } from "./commute.ts";

// Keep the provider's complete journey total. It includes access, egress,
// transfers and provider waiting estimates; do not rebuild it from line times.
type Gate = {name?:string;location?:unknown};
type Stop = {name?:string;location?:unknown;entrance?:Gate;exit?:Gate};
type Walking = {origin?:unknown;destination?:unknown;cost?:{duration?:unknown};duration?:unknown;distance?:unknown;steps?:{polyline?:unknown;instruction?:string}[]};
type Line = {type?:string;name?:string;polyline?:unknown;cost?:{duration?:unknown};duration?:unknown;distance?:unknown;departure_stop?:Stop;arrival_stop?:Stop};
type Segment = {walking?:Walking;bus?:{buslines?:Line[]};railway?:unknown;taxi?:unknown;riding?:unknown};
type Transit = {cost?:{duration?:unknown};duration?:unknown;distance?:unknown;segments?:Segment[]};
type TransitResponse = {route?:{transits?:Transit[]}};
const populated=(value:unknown):boolean=>value!=null&&typeof value==="object"&&Object.keys(value).length>0;
export type MetroGate={stationName:string;name:string;location:Coord};
export type RecommendedMetro={entry:MetroGate;exit:MetroGate;legs:Leg[]};
export type FullMetroLeg=Leg&{recommendedMetro?:RecommendedMetro};
const coordinate=(value:unknown):Coord|undefined=>{
  if(typeof value!=="string")return;
  const parts=value.split(",").map(Number);
  return parts.length===2&&parts.every(Number.isFinite)&&Math.abs(parts[0])<=180&&Math.abs(parts[1])<=90?parts as Coord:undefined;
};
const gate=(stop:Stop|undefined,kind:"entrance"|"exit"):MetroGate|undefined=>{
  const location=coordinate(stop?.[kind]?.location),name=stop?.[kind]?.name;
  if(stop?.name&&name&&location)return {stationName:stop.name,name:`${stop.name}地铁站${name}`,location};
};

// Preserve the exact recommended street gates and API rail/transfer legs.
// First/last station walks are replaced by street routes, never subtracted
// from the provider's complete total or mistaken for transfer walks.
function recommendedMetro(segments:Segment[]):RecommendedMetro|undefined {
  const indices=segments.flatMap((segment,index)=>segment.bus?.buslines?.length?[index]:[]);
  const first=indices[0],last=indices.at(-1);
  if(first===undefined||last===undefined)return;
  const entry=gate(segments[first].bus!.buslines![0].departure_stop,"entrance");
  const exit=gate(segments[last].bus!.buslines![0].arrival_stop,"exit");
  if(!entry||!exit)return;
  const legs:Leg[]=[];
  let previous:Line|undefined;
  for(let index=first;index<=last;index++){
    const segment=segments[index],line=segment.bus?.buslines?.[0];
    if(index>first){
      const walking=segment.walking,duration=surfaceDuration(walking);
      if(duration===null&&(line||populated(walking)))return;
      if(duration!==null&&duration>0){
        const origin=coordinate(walking?.origin)??coordinate(previous?.arrival_stop?.location);
        const destination=coordinate(walking?.destination)??coordinate(line?.departure_stop?.location);
        if(!origin||!destination)return;
        legs.push({mode:"walking",kind:"transfer",label:"站内换乘",from:previous?.arrival_stop?.name??"换乘站",to:line?.departure_stop?.name??"换乘站",origin,destination,duration,distance:Number(walking?.distance)||0,
          paths:(walking?.steps??[]).map(step=>polyline(step.polyline)).filter(path=>path.length>1),source:"amap"});
      }
    }
    if(line){
      const duration=surfaceDuration(line),origin=coordinate(line.departure_stop?.location),destination=coordinate(line.arrival_stop?.location);
      if(duration===null||duration<=0||!origin||!destination||!line.departure_stop?.name||!line.arrival_stop?.name)return;
      legs.push({mode:"metro",label:(line.name??"地铁").split("(")[0],from:line.departure_stop.name+"站",to:line.arrival_stop.name+"站",origin,destination,duration,distance:Number(line.distance)||0,
        paths:[polyline(line.polyline)].filter(path=>path.length>1),instructions:[`${line.name??"地铁"}：${line.departure_stop.name} → ${line.arrival_stop.name}`],source:"amap"});
      previous=line;
    }
  }
  return {entry,exit,legs};
}

export function fullMetroLeg(data:TransitResponse, origin:Coord, destination:Coord, from:string, to:string):FullMetroLeg|null {
  const options:FullMetroLeg[]=[];
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
    options.push({mode:"metro",kind:"full-transit",label,origin,destination,from,to,duration,distance:Number(transit.distance)||0,paths,source:"amap",recommendedMetro:recommendedMetro(segments)});
  }
  return options.sort((a,b)=>a.duration-b.duration)[0]??null;
}
