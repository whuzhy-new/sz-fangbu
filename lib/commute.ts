export type Coord = [number, number];
export type Mode = "walking" | "bicycling" | "metro";
export type Office = { id: string; name: string; area: string; color: string; poiId: string; location: number[]; entrance: number[]; address: string; source: string };
export type Place = { id: string; name: string; address: string; location: Coord; entrance?: Coord; kind?: string };
export type Leg = { mode: Mode; label: string; from: string; to: string; origin: Coord; destination: Coord; duration: number; distance: number; paths: Coord[][]; instructions?: string[]; source: "amap" | "model"; measuredAt?:string; cached?:boolean; kind?:"transfer" };
export type Plan = { id: string; officeId: string; mode: Mode; title: string; duration: number; limit: number; qualified: boolean; legs: Leg[]; measuredAt: string; source: "amap" | "model"; note?: string; originalReferenceDuration?:number|null };
export type Verification = { officeId: string; plans: Plan[]; complete: boolean; checked: number; errors: string[]; measuredAt: string; };
export const MODE_LABEL: Record<Mode, string> = { walking: "步行直达", bicycling: "自行车直达", metro: "地铁＋接驳" };
export const MODE_COLOR: Record<Mode, string> = { walking: "#41896e", bicycling: "#5e83c2", metro: "#ca9857" };
export const LIMITS: Record<Mode, number> = { walking: 1800, bicycling: 1200, metro: 1200 };

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "暂无路线";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}分${whole % 60 ? `${whole % 60}秒` : "钟"}`;
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
  return Number.isFinite(duration) && duration >= 0 && duration <= LIMITS[mode];
}
export function surfaceDuration(path: {cost?:{duration?:unknown};duration?:unknown;distance?:unknown}|undefined):number|null {
  if(!path)return null;
  const duration=Number(path.cost?.duration??path.duration);
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
  const params = new URLSearchParams({ from: `${leg.origin.join(",")},${leg.from}`, to: `${leg.destination.join(",")},${leg.to}`, mode, coordinate: "gaode", src: "nearby-commute-atlas", callnative: "1" });
  return `https://uri.amap.com/navigation?${params}`;
}
