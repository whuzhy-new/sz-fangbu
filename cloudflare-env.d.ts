declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AMAP_WEB_KEY?: string;
    AMAP_JS_KEY?: string;
    AMAP_JS_SECURITY_CODE?: string;
    AMAP_APP_MONTHLY_LIMIT?: string;
    AMAP_SEARCH_MONTHLY_LIMIT?: string;
  }
}
