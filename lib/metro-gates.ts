import {distanceMeters,type Coord} from "./commute.ts";
import type {MetroGate} from "./full-metro.ts";

type Entry={id?:string;name:string;location:Coord;source:string};
export type StreetGate=MetroGate&{id?:string};

export const hasGateNumber=(name:string)=>/(?:[a-z]\d*|\d+|[一二三四五六七八九十]+)(?:号|通道)?(?:出入口|出入站口|出口|入口|口)$/i.test(name);

/** Keep explicit API gates; resolve generic hints to real, numbered POIs. */
export function recommendedStreetGates(hint:MetroGate,entries:readonly Entry[]):StreetGate[] {
  const named=entries.filter(entry=>entry.source==="amap"&&hasGateNumber(entry.name));
  if(hasGateNumber(hint.name)){
    const match=named.find(entry=>entry.name===hint.name&&distanceMeters(entry.location,hint.location)<=3);
    return [{...hint,id:match?.id}];
  }
  // A generic exit is only a proximity hint. Query both nearby alternatives
  // with their own names and coordinates instead of renaming that point.
  return named.map(entry=>({entry,distance:distanceMeters(entry.location,hint.location)}))
    .sort((a,b)=>a.distance-b.distance||a.entry.name.localeCompare(b.entry.name))
    .slice(0,2).map(({entry})=>({stationName:hint.stationName,name:entry.name,location:entry.location,id:entry.id}));
}
