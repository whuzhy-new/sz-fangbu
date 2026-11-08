import { env } from "cloudflare:workers";
import offices from "@/public/data/offices.json";
export async function GET() {
  return Response.json({ jsKey:env.AMAP_JS_KEY ?? "", offices, clock:"street-rail-and-transfer-v2", configured:!!env.AMAP_WEB_KEY && !!env.AMAP_JS_KEY, monthlyLimit:Number(env.AMAP_APP_MONTHLY_LIMIT ?? 100000) });
}
