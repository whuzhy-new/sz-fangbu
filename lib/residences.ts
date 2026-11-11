import residenceData from "@/public/data/residences.json";
import stationData from "@/public/data/stations.json";
import {distanceMeters,type Coord,type Place} from "./commute";

export const residences=residenceData.places.filter(place=>!place.kind.split("|").includes("120303"));
const checkedResidenceIds=new Set(residenceData.checkedBatch.placeIds);
export const normalizeResidenceName=(value:string)=>value.normalize("NFKC").replace(/\s+/g,"").toLowerCase();

export function propertyTypeLabel(kind:string|undefined){
  const codes=kind?.split("|")??[];
  if(codes.some(code=>code.startsWith("1203")))return "住宅";
  if(codes.includes("120203"))return "商住楼";
  if(codes.includes("120201"))return "写字楼";
  if(codes.some(code=>code.startsWith("10")))return "住宿";
}

export function nearbyResidenceStations(location:number[]){
  return stationData.stations.flatMap(station=>{
    const distance=distanceMeters(location,station.location);
    return distance<=1000?[{id:station.id,name:station.name,distance}]:[];
  }).sort((a,b)=>a.distance-b.distance).slice(0,2);
}

export function searchResidences(query:string):Place[]{
  const keyword=normalizeResidenceName(query);
  if(!keyword)return [];
  return residences.flatMap(place=>{
    const name=normalizeResidenceName(place.name);
    const match=name.indexOf(keyword);
    return match<0?[]:[{place,rank:name===keyword?0:match===0?1:2}];
  }).sort((a,b)=>a.rank-b.rank||Number(checkedResidenceIds.has(b.place.id))-Number(checkedResidenceIds.has(a.place.id)))
    .slice(0,8)
    .map(({place})=>({
      id:place.id,name:place.name,address:"",kind:place.kind,
      location:place.location as Coord,entrance:place.entrance as Coord|undefined,
    }));
}
