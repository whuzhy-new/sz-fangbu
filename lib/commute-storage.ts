import {placePoiId,withinShenzhen,type Coord,type Mode,type Place} from "./commute.ts";

export const PREFERENCES_KEY="shenzhen-housing-map:preferences:v1";
export const SAVED_PLACES_KEY="shenzhen-housing-map:places:v1";
export type Preferences={officeId:string;layers:Record<Mode,boolean>};
export type SavedPlaces={recent:Place[];favorites:Place[]};
const officeIds=["innovation","jinghu","prince"];
const modes:Mode[]=["walking","bicycling","metro"];
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function parse(value:string|null):Record<string,unknown> {
  try {const data=object(JSON.parse(value??"null"));return data.version===1?data:{};}catch{return {};}
}
export function readPreferences(value:string|null):Preferences {
  const data=parse(value),layers=object(data.layers);
  return {officeId:typeof data.officeId==="string"&&officeIds.includes(data.officeId)?data.officeId:"innovation",
    layers:Object.fromEntries(modes.map(mode=>[mode,typeof layers[mode]==="boolean"?layers[mode]:true])) as Record<Mode,boolean>};
}
function coordinate(value:unknown):Coord|undefined {
  return Array.isArray(value)&&withinShenzhen(value)?[value[0],value[1]] as Coord:undefined;
}
function place(value:unknown):Place|null {
  const data=object(value),location=coordinate(data.location);
  if(!location||typeof data.name!=="string"||!data.name.trim())return null;
  const name=data.name.trim().slice(0,120),entrance=coordinate(data.entrance);
  const point:Place={id:typeof data.id==="string"?data.id.slice(0,160):location.join(","),name,location,
    address:typeof data.address==="string"?data.address.slice(0,300):"",...(entrance?{entrance}:{}),
    ...(typeof data.kind==="string"?{kind:data.kind.slice(0,80)}:{})};
  const poiId=placePoiId({...point,poiId:typeof data.poiId==="string"?data.poiId:undefined});
  return {...point,...(poiId?{poiId}:{})};
}
export const placeKey=(value:Place)=>(value.entrance??value.location).map(n=>n.toFixed(6)).join(",");
function uniquePlaces(value:unknown):Place[] {
  if(!Array.isArray(value))return [];
  const seen=new Set<string>();
  return value.flatMap(item=>{const point=place(item);if(!point)return [];const key=placeKey(point);if(seen.has(key))return [];seen.add(key);return [point];});
}
export function readSavedPlaces(value:string|null):SavedPlaces {
  const data=parse(value);
  return {recent:uniquePlaces(data.recent).slice(0,8),favorites:uniquePlaces(data.favorites)};
}
export function rememberPlace(recent:Place[],value:Place):Place[] {
  const point=place(value);
  return point?[point,...recent.filter(item=>placeKey(item)!==placeKey(point))].slice(0,8):recent;
}
export function toggleFavorite(favorites:Place[],value:Place):Place[] {
  const point=place(value);if(!point)return favorites;
  const key=placeKey(point);
  return favorites.some(item=>placeKey(item)===key)?favorites.filter(item=>placeKey(item)!==key):[point,...favorites];
}
