export type Coord = [number, number];
export type Mode = "walking" | "bicycling" | "metro";
export type QueryStage = "surface" | "metro-full" | "metro-segmented";
export const QUERY_STAGE_LABEL: Record<QueryStage,string> = {surface:"步行、自行车","metro-full":"地铁不分段","metro-segmented":"地铁分段"};
export type Office = { id: string; name: string; area: string; color: string; poiId: string; location: number[]; entrance: number[]; address: string; source: string };
export type Place = { id: string; name: string; address: string; location: Coord; entrance?: Coord; kind?: string };
export type Leg = { mode: Mode; label: string; from: string; to: string; origin: Coord; destination: Coord; duration: number; rawDuration?:number; distance: number; paths: Coord[][]; instructions?: string[]; source: "amap" | "model"; measuredAt?:string; cached?:boolean; kind?:"transfer" | "full-transit" };
export type Plan = { id: string; officeId: string; mode: Mode; title: string; duration: number; limit: number; qualified: boolean; legs: Leg[]; measuredAt: string; source: "amap" | "model"; note?: string; originalReferenceDuration?:number|null; originalReferenceScope?:string; metroMethod?:"full" | "segmented" };
export type LocalSearch={total:number;reachable:number;withinLimit:number;bestDuration:number|null;elapsedMs:number;source:"model"};
export type Verification = { officeId: string; plans: Plan[]; complete: boolean; checked: number; errors: string[]; measuredAt: string; localSearch?:LocalSearch; };
export const MODE_LABEL: Record<Mode, string> = { walking: "步行直达", bicycling: "自行车直达", metro: "地铁＋接驳" };
export const MODE_COLOR: Record<Mode, string> = { walking: "#41896e", bicycling: "#5e83c2", metro: "#ca9857" };
export const LIMITS: Record<Mode, number> = { walking: 1800, bicycling: 1200, metro: 1200 };

// Durations remain in seconds internally; every rounded leg takes at least one minute.
export function roundDuration(seconds:number):number {
  return Number.isFinite(seconds)&&seconds>=0?Math.max(1,Math.floor(seconds/60+0.5))*60:NaN;
}
export function roundLeg(leg:Leg):Leg {
  const rawDuration=leg.rawDuration??leg.duration;
  return {...leg,rawDuration,duration:roundDuration(rawDuration)};
}
export function sumLegDurations(legs:Pick<Leg,"duration">[]):number {
  return legs.reduce((sum,leg)=>sum+roundDuration(leg.duration),0);
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
export function mapLink(leg: Leg): string {
  const mode = leg.mode === "walking" ? "walk" : leg.mode === "bicycling" ? "ride" : "bus";
  const stationName=(name:string)=>/[（(]地铁站[）)]$/.test(name)?name.replace(/（地铁站）$/,"(地铁站)"):name.replace(/站$/,"")+"(地铁站)";
  const stationPair=leg.mode==="metro"&&leg.kind!=="full-transit";
  const from=stationPair?stationName(leg.from):leg.from;
  const to=stationPair?stationName(leg.to):leg.to;
  const params = new URLSearchParams({ from: `${leg.origin.join(",")},${from}`, to: `${leg.destination.join(",")},${to}`, mode, coordinate: "gaode", src: "nearby-commute-atlas", callnative: "1" });
  return `https://uri.amap.com/navigation?${params}`;
}
