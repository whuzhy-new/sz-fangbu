export type Coord = [number, number];
export type Mode = "walking" | "bicycling" | "metro";
export type CommuteDirection = "to-office" | "to-home";
export type QueryStage = "surface" | "metro-full" | "metro-segmented";
export const QUERY_STAGE_LABEL: Record<QueryStage,string> = {surface:"步行、自行车","metro-full":"地铁不分段","metro-segmented":"地铁分段"};
export type Office = { id: string; name: string; area: string; color: string; poiId: string; location: number[]; entrance: number[]; address: string; source: string };
export type Place = { id: string; name: string; address: string; location: Coord; entrance?: Coord; kind?: string; poiId?:string };
export type Leg = { mode: Mode; label: string; from: string; to: string; origin: Coord; destination: Coord; originPoiId?:string; destinationPoiId?:string; routingIdentity?:"coordinates"|"poi"; duration: number; rawDuration?:number; distance: number; paths: Coord[][]; instructions?: string[]; source: "amap" | "model"; measuredAt?:string; cached?:boolean; kind?:"transfer" | "full-transit" };
export type Plan = { id: string; officeId: string; direction?: CommuteDirection; mode: Mode; title: string; duration: number; limit: number; qualified: boolean; legs: Leg[]; measuredAt: string; source: "amap" | "model"; note?: string; originalReferenceDuration?:number|null; originalReferenceScope?:string; metroMethod?:"full" | "segmented" };
export type LocalSearch={total:number;reachable:number;withinLimit:number;bestDuration:number|null;elapsedMs:number;source:"model"};
// `complete` means this query's selected checks finished without missing data
// or an interrupted API call. It does not assert an exhaustive policy decision.
export type Verification = { officeId: string; plans: Plan[]; complete: boolean; checked: number; errors: string[]; measuredAt: string; localSearch?:LocalSearch; reused?:true; };
export const MODE_LABEL: Record<Mode, string> = { walking: "步行直达", bicycling: "自行车直达", metro: "地铁＋接驳" };
export const MODE_COLOR: Record<Mode, string> = { walking: "#41896e", bicycling: "#5e83c2", metro: "#ca9857" };
export const LIMITS: Record<Mode, number> = { walking: 1800, bicycling: 1200, metro: 1200 };
export const METRO_DRILL_DOWN_FROM = 19*60;

// Durations remain in seconds internally; every rounded leg takes at least one minute.
export const ROUND_UP_SECONDS=30;
export const DURATION_ROUNDING_VERSION="per-leg-minute-half-up-min-one-v2";
export function roundDuration(seconds:number):number {
  return Number.isFinite(seconds)&&seconds>=0?Math.max(1,Math.floor((seconds+60-ROUND_UP_SECONDS)/60))*60:NaN;
}
export function roundLeg(leg:Leg):Leg {
  const rawDuration=leg.rawDuration??leg.duration;
  return {...leg,rawDuration,duration:roundDuration(rawDuration)};
}
export function sumLegDurations(legs:(Pick<Leg,"duration">&Partial<Pick<Leg,"rawDuration">>)[]):number {
  return legs.reduce((sum,leg)=>sum+roundDuration(leg.rawDuration??leg.duration),0);
}
export function formatDuration(seconds: number): string {
  const rounded=roundDuration(seconds);
  return Number.isFinite(rounded)?`${rounded/60}分`:"暂无路线";
}
export function distanceMeters(a: number[], b: number[]): number {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 6371008.8;
}
export function withinShenzhen(c: number[]): boolean {
  return c.length === 2 && c.every(Number.isFinite) && c[0] >= 113.75 && c[0] <= 114.65 && c[1] >= 22.42 && c[1] <= 22.87;
}
export function qualified(duration: number, mode: Mode): boolean {
  return roundDuration(duration) <= LIMITS[mode];
}
export function surfaceDuration(path: {cost?:{duration?:unknown};duration?:unknown;distance?:unknown}|undefined):number|null {
  if(!path)return null;
  const raw=path.cost?.duration??path.duration;
  if(raw==null||raw==="")return null;
  const duration=Number(raw);
  if(!Number.isFinite(duration)||duration<0||(duration===0&&Number(path.distance)>1))return null;
  return duration;
}
export function polyline(value: unknown): Coord[] {
  if (value && typeof value === "object" && "polyline" in value) return polyline((value as {polyline:unknown}).polyline);
  if (typeof value !== "string") return [];
  return value.split(";").map(s => s.split(",").map(Number) as Coord).filter(c => c.length === 2 && c.every(Number.isFinite));
}
export type AmapPlatform = "ios" | "android";
export function amapPoiId(value:unknown):string|undefined {
  return typeof value==="string"&&/^B[A-Z0-9]{5,39}$/i.test(value)?value:undefined;
}
export function placePoiId(place:Place):string|undefined {
  return amapPoiId(place.poiId)??(place.kind!=="map"?amapPoiId(place.id):undefined);
}
export function mapLink(leg: Leg,platform:AmapPlatform="ios"): string|null {
  const mode = leg.mode === "walking" ? "2" : leg.mode === "bicycling" ? "3" : "1";
  const stationName=(name:string)=>/[（(]地铁站[）)]$/.test(name)?name.replace(/（地铁站）$/,"(地铁站)"):name.replace(/站$/,"")+"(地铁站)";
  const stationPair=leg.mode==="metro"&&leg.kind!=="full-transit";
  // A station-looking coordinate label still adds access/egress walking. Every
  // QR uses the native route API; station pairs require both explicit POIs.
  if(stationPair&&(!leg.originPoiId||!leg.destinationPoiId))return null;
  const params=new URLSearchParams({sourceApplication:"nearby-commute-atlas",
    slon:String(leg.origin[0]),slat:String(leg.origin[1]),sname:stationPair?stationName(leg.from):leg.from,
    dlon:String(leg.destination[0]),dlat:String(leg.destination[1]),dname:stationPair?stationName(leg.to):leg.to,dev:"0",t:mode,m:"0"});
  // A known POI label does not mean the API used that POI to calculate the route.
  // Adding it only in a QR can move the endpoint to a different entrance.
  const usePoi=stationPair||(leg.mode!=="bicycling"&&leg.routingIdentity==="poi");
  if(usePoi&&leg.originPoiId)params.set("sid",leg.originPoiId);
  if(usePoi&&leg.destinationPoiId)params.set("did",leg.destinationPoiId);
  if(leg.mode==="bicycling"&&platform==="android")params.set("rideType","bike");
  return `${platform==="ios"?"iosamap://path":"amapuri://route/plan/"}?${params}`;
}
