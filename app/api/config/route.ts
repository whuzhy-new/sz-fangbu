import { env } from "cloudflare:workers";
import offices from "@/public/data/offices.json";
import {DURATION_ROUNDING_VERSION} from "@/lib/commute";
export async function GET() {
  return Response.json({ jsKey:env.AMAP_JS_KEY ?? "", offices, clock:"amap-station-pair-v3", durationRounding:DURATION_ROUNDING_VERSION, configured:!!env.AMAP_WEB_KEY && !!env.AMAP_JS_KEY, monthlyLimit:Number(env.AMAP_APP_MONTHLY_LIMIT ?? 100000) });
}
