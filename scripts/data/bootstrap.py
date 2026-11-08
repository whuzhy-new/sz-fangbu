"""Resolve the three actual offices and obtain AMap's public Shenzhen metro map."""
import json
from amap import ROOT, WORK, atomic_json, public_get, request

specs = [
    ("innovation", "深圳湾创新科技中心", "科苑 · 科技园", "#317b68", "https://www.szbay.com/Broadband/Detail/180"),
    ("prince", "太子广场", "海上世界 · 蛇口", "#597dd1", "https://www.sz.gov.cn/attachment/1/1708/1708618/12756243.pdf"),
    ("jinghu", "深圳景湖大厦", "后海 · 创业路", "#cf9659", "https://www.amap.com/place/B0M6MUV470"),
]
offices = []
for id, name, area, color, source in specs:
    data = request("v3/place/text", {"keywords":name, "city":"440300", "citylimit":"true", "offset":10,"extensions":"all"}, "search")
    pois = data.get("pois", [])
    relevant = [p for p in pois if name in p["name"] and "南山" in p.get("adname", "")]
    poi = next((p for p in relevant if p["name"] == name), relevant[0] if relevant else pois[0])
    location = [float(v) for v in poi["location"].split(",")]
    entry = poi.get("entr_location")
    if not isinstance(entry, str) or "," not in entry: entry = poi["location"]
    office = {"id":id,"name":name.replace("深圳景湖", "景湖"),"area":area,"color":color,"poiId":poi["id"],"location":location,"entrance":[float(v) for v in entry.split(",")],"address":poi.get("address", ""),"source":source,"mapSource":"高德地点搜索","endpointNote":"以园区/大厦地图导航点测量，无需精确到楼层。"}
    offices.append(office)
    print(json.dumps(office, ensure_ascii=False), flush=True)
atomic_json(ROOT/"public/data/offices.json", offices)
metro = public_get("https://webapi.amap.com/subway/data/4403_drw_shenzhen.json")
atomic_json(WORK/"metro-source.json", metro)
stations={}
lines=[]
for line in metro.get("l", []):
    if "云巴" in line.get("ln", ""): continue
    line_name = line.get("ln", "").split("/")[0]
    ids=[]
    for station in line.get("st", []):
        if not station.get("sl") or not station.get("poiid"): continue
        sid=station["poiid"]
        ids.append(sid)
        s=stations.setdefault(sid,{"id":sid,"name":station.get("n"),"location":[float(v) for v in station["sl"].split(",")],"lines":[]})
        s["lines"].append(line_name)
    lines.append({"name":line_name,"color":"#"+line.get("cl", "778899"),"stations":ids})
atomic_json(ROOT/"public/data/stations.json", {"source":"高德地铁图公开数据","stations":list(stations.values()),"lines":lines})
print("Metro stations:",len(stations),"lines:",len(lines),"source version:",metro.get("v"),flush=True)
