"""Export geographic subway paths from AMap's line lookup for the map display."""
import json

from shapely.geometry import LineString

from amap import ROOT, WORK, atomic_json, request


def main():
    metro = json.loads((WORK / "metro-source.json").read_text())
    station_data = json.loads((ROOT / "public/data/stations.json").read_text())
    expected = {line["name"] for line in station_data["lines"]}
    lines = []
    for subway in metro["l"]:
        name = subway["ln"].split("/")[0]
        if name not in expected:
            continue
        line_id = subway["ls"]
        response = request("v3/bus/lineid", {"id": line_id, "extensions": "all"}, "search")
        line = next((item for item in response.get("buslines", [])
                     if item.get("id") == line_id and item.get("type") in ("地铁", "地铁线路")), None)
        polyline = line.get("polyline") if line else None
        if not isinstance(polyline, str) or not polyline:
            raise RuntimeError(f"Missing AMap geographic path for {name}")
        points = [tuple(map(float, item.split(","))) for item in polyline.split(";") if item]
        if len(points) < 2 or not all(113.75 <= x <= 114.65 and 22.42 <= y <= 22.87 for x, y in points):
            raise RuntimeError(f"Invalid Shenzhen coordinates for {name}")
        path = [[round(value, 6) for value in point] for point in LineString(points).simplify(.00003).coords]
        display_name = "2号线／8号线" if subway["ln"] == "2号线/8号线" else name
        lines.append({"name": display_name, "amapId": line_id, "paths": [path]})
        print(f"{display_name}: {len(path)} points", flush=True)
    actual = {line["name"].split("／")[0] for line in lines}
    if actual != expected:
        raise RuntimeError(f"Missing AMap lines: {sorted(expected - actual)}")
    atomic_json(ROOT / "public/data/metro-tracks.json", {
        "source": "高德线路查询", "lines": lines,
    })


if __name__ == "__main__":
    main()
