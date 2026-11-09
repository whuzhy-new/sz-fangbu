"""Small, cached AMap client for offline preparation. Secrets stay in .dev.vars."""
from __future__ import annotations
import hashlib, json, os, pathlib, ssl, time, urllib.parse, urllib.request, fcntl

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / "work"
WORK.mkdir(exist_ok=True)

def local_config():
    result = dict(os.environ)
    path = ROOT / ".dev.vars"
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                try: result[key] = json.loads(value)
                except json.JSONDecodeError: result[key] = value.strip()
    return result

def atomic_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(path)

def public_get(url):
    context = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if pathlib.Path("/etc/ssl/cert.pem").exists() else None)
    req = urllib.request.Request(url, headers={"User-Agent": "ShenzhenCommuteAtlas/1.0"})
    with urllib.request.urlopen(req, timeout=30, context=context) as response:
        return json.load(response)

def cache_path(service, params):
    normalized = {k: str(v) for k,v in params.items()}
    digest = hashlib.sha256(json.dumps([service, normalized], sort_keys=True).encode()).hexdigest()
    return WORK / "amap-cache" / (digest + ".json")

def cached_response(service, params):
    path = cache_path(service, params)
    return json.loads(path.read_text()) if path.exists() else None

def request(service, params, category="routes"):
    config = local_config()
    normalized = {k: str(v) for k,v in params.items()}
    cached = cache_path(service, normalized)
    if cached.exists(): return json.loads(cached.read_text())
    ledger_path = WORK / "amap-usage.json"
    key = config.get("AMAP_WEB_KEY")
    if not key: raise RuntimeError("Missing AMAP_WEB_KEY")
    with (WORK/'amap-usage.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
        month = time.strftime("%Y-%m", time.gmtime())
        bucket = ledger.setdefault(month, {"routes":12, "search":0})
        limit = int(config.get("AMAP_SEARCH_MONTHLY_LIMIT" if category=="search" else "AMAP_APP_MONTHLY_LIMIT", 3000 if category=="search" else 100000))
        if bucket.get(category, 0) >= limit: raise RuntimeError("Configured free-usage budget reached")
        bucket[category] = bucket.get(category, 0) + 1
        slot_path=WORK/'amap-request-slot'
        slot=max(float(slot_path.read_text()) if slot_path.exists() else 0,time.time())+.65
        slot_path.write_text(str(slot))
        atomic_json(ledger_path, ledger)
        fcntl.flock(lock,fcntl.LOCK_UN)
    time.sleep(max(0,slot-time.time()))
    query = urllib.parse.urlencode({**normalized, "key":key})
    try: result = public_get("https://restapi.amap.com/" + service + "?" + query)
    except Exception as error: raise RuntimeError("AMap network request failed: " + type(error).__name__) from None
    if str(result.get("status")) != "1":
        raise RuntimeError("AMap " + str(result.get("infocode")) + ": " + str(result.get("info")))
    atomic_json(cached, result)
    return result

def surface_params(mode, origin, destination, origin_poi=None, destination_poi=None):
    coords = lambda p: ",".join(f"{x:.6f}" for x in p)
    params = {"origin":coords(origin), "destination":coords(destination), "show_fields":"cost,polyline,navi"}
    # These identity parameters are documented for walking, not ordinary cycling.
    if mode == 'walking':
        if origin_poi: params['origin_id'] = origin_poi
        if destination_poi: params['destination_id'] = destination_poi
    return params

def route(mode, origin, destination, origin_poi=None, destination_poi=None):
    params = surface_params(mode, origin, destination, origin_poi, destination_poi)
    data = request("v5/direction/" + mode, params)
    paths = data.get("route", {}).get("paths", [])
    if not paths: return None
    path = paths[0]
    duration=float(path.get("cost", {}).get("duration") or path.get("duration") or 0)
    if duration<=0 and float(path["distance"])>1:raise RuntimeError("AMap returned no usable surface duration")
    return {"distance":float(path["distance"]), "duration":duration, "steps":path.get("steps", []),
            'routingIdentity':'poi' if params.get('origin_id') or params.get('destination_id') else 'coordinates',
            **({'originPoiId':params['origin_id']} if 'origin_id' in params else {}),
            **({'destinationPoiId':params['destination_id']} if 'destination_id' in params else {})}
