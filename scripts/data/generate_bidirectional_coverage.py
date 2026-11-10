"""Keep the inbound layer intact and publish a union for local map use."""
import json

from pyproj import Geod
from shapely.geometry import mapping, shape

from amap import ROOT, WORK, atomic_json
from correction import BicycleCorrection
from coverage_geometry import complete_small_holes, polygon_parts
from generate_coverage import generate_coverage
from network import Network
from prepare_return_plans import GATE


def read(path):
    return json.loads((ROOT / path).read_text())


def main():
    inbound = read('public/data/coverage.json')
    rail = read('public/data/metro-plans.json')
    returned = read('data/metro-return.json')
    offices = read('public/data/offices.json')
    for office in offices:
        identity = returned['officeEndpoints'][office['id']]
        if identity != {k: office[k] for k in ('poiId', 'entrance')}:
            raise RuntimeError('Stale return office endpoint: ' + office['id'])
    entries = {sid: [gate for gate in gates if GATE.search(gate['name'])] for sid, gates in rail['entries'].items()}
    returned.update(entries=entries, stationCount=rail['stationCount'], processedStations=rail['processedStations'])
    homebound = generate_coverage(returned, offices, Network(), BicycleCorrection(), [], to_home=True)
    atomic_json(WORK / 'coverage-return.json', homebound)
    key = lambda feature: (feature['properties']['officeId'], feature['properties']['mode'])
    reverse = {key(feature): shape(feature['geometry']) for feature in homebound['features']}
    geod = Geod(ellps='WGS84')
    def area_m2(geometry):
        return sum(abs(geod.geometry_area_perimeter(p)[0]) for p in polygon_parts(geometry))
    cleanup = {}
    for office in offices:
        oid = office['id']
        features = {mode: f for f in inbound['features'] for office_id, mode in [key(f)] if office_id == oid}
        forward = {mode: shape(f['geometry']) for mode, f in features.items()}
        combined = {mode: layer.union(reverse[oid, mode]) for mode, layer in forward.items()}
        completed, cleanup[oid] = complete_small_holes(combined, area_measure=area_m2, area_tolerance=.01)
        for mode, feature in features.items():
            merged = completed[mode]
            # Exact boundary predicates are sensitive to floating-point intersections.
            assert merged.is_valid and all(area_m2(layer.difference(merged)) < .01 for layer in (forward[mode], reverse[oid, mode]))
            feature['geometry'] = mapping(merged)
            feature['properties']['areaKm2'] = round(area_m2(merged) / 1e6, 3)
            print(key(feature), '并集面积 km²', feature['properties']['areaKm2'])
    inbound['metadata'].update(
        directions=['to-office', 'to-home'], returnGeneratedAt=returned['generatedAt'], bidirectionalCleanup=cleanup,
        note='去程与返程范围取并集。由高德地铁实测接驳和有方向的路网估算，实际以地点核验为准。',
    )
    atomic_json(ROOT / 'public/data/coverage-bidirectional.json', inbound)


if __name__ == '__main__':
    main()
