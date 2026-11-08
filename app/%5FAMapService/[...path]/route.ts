import { env } from "cloudflare:workers";
export async function GET(request: Request) {
  if (!env.AMAP_JS_SECURITY_CODE || !env.AMAP_JS_KEY) return new Response("Map not configured", {status:503});
  const incoming = new URL(request.url);
  const path = incoming.pathname.replace(/^\/_AMapService/, "");
  if (!/^\/v[345]\/[a-zA-Z0-9/_-]+$/.test(path)) return new Response("Unsupported map resource", {status:404});
  // This endpoint serves JS-map assets only. Search and route APIs use the budgeted server client.
  if (/\/(direction|place|geocode|assistant|batch|traffic|weather)\//.test(path)) return new Response("Use the application API", {status:403});
  const url = new URL(path, path.startsWith("/v4/map/styles") ? "https://webapi.amap.com" : path.startsWith("/v3/vectormap") ? "https://fmap01.amap.com" : "https://restapi.amap.com");
  url.search = incoming.search;
  url.searchParams.set("jscode",env.AMAP_JS_SECURITY_CODE);
  url.searchParams.set("key",env.AMAP_JS_KEY);
  try {
    const result = await fetch(url, {signal:AbortSignal.timeout(15000)});
    return new Response(result.body,{status:result.status,headers:{"Content-Type":result.headers.get("content-type")??"application/octet-stream","Cache-Control":"private, max-age=3600"}});
  } catch { return new Response("Map resource unavailable",{status:502}); }
}
