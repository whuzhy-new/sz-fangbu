"""Measure office-to-residence metro access and ordered station pairs separately."""
import datetime
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from amap import ROOT, WORK, atomic_json, cache_path, cached_response, request, route, surface_params
from duration_policy import ROUNDING_VERSION, sum_leg_seconds
from prepare_rail_plans import station_params, surface
from prepare_station_api import exact_station_options

SERVICE = 'v5/direction/transit/integrated'
GATE = re.compile(r'(?:[a-z]\d*|\d+|[一二三四五六七八九十]+)(?:号|通道)?(?:出入口|出入站口|出口|入口|口)$', re.I)


def read(path):
    return json.loads((ROOT / path).read_text())


def measured_at(service, params):
    return datetime.datetime.fromtimestamp(cache_path(service, params).stat().st_mtime, datetime.timezone.utc).isoformat()


def main():
    source = read('public/data/metro-plans.json')
    offices = read('public/data/offices.json')
    stations = read('public/data/stations.json')['stations']
    by_name = {s['name']: s for s in stations}
    by_id = {s['id']: s for s in stations}
    profiles = {o['id']: read(f'data/office-profiles/{o["id"]}-fixed-egress.json') for o in offices}
    heads = {o['id']: {} for o in offices}
    pairs = {}

    def measure_access(office, station, gate, mode):
        params = surface_params(mode, office['entrance'], gate['location'], office['poiId'], gate['id'])
        data = route(mode, office['entrance'], gate['location'], office['poiId'], gate['id'])
        if not data:
            return None
        leg = surface(data, mode, office['entrance'], gate['location'], office['name'], gate['name'])
        leg['measuredAt'] = measured_at('v5/direction/' + mode, params)
        return leg

    def measure_pair(origin_id, destination_id):
        origin, destination = by_id[origin_id], by_id[destination_id]
        params = station_params(origin, destination)
        options = exact_station_options(request(SERVICE, params), origin, destination)
        if not options:
            return None
        return min(options, key=lambda p: (sum_leg_seconds(p['journeyLegs']), p['fixedDuration'])), measured_at(SERVICE, params)

    with ThreadPoolExecutor(max_workers=5) as pool:
        access = {
            pool.submit(measure_access, office, station, gate, mode): (office['id'], station['name'])
            for office in offices
            for name in profiles[office['id']]['routes']
            for station in [by_name[name]]
            for gate in source['entries'][station['id']]
            if gate['source'] == 'amap' and GATE.search(gate['name'])
            for mode in ('walking', 'bicycling')
        }
        print(f'比较 {len(access)} 组工区至进站口路线', flush=True)
        for i, job in enumerate(as_completed(access), 1):
            oid, name = access[job]
            leg = job.result()
            old = heads[oid].get(name)
            key = lambda l: (l['duration'], l['distance'], l['to'], l['mode'])
            if leg and (old is None or key(leg) < key(old)):
                heads[oid][name] = leg
            if i % 40 == 0 or i == len(access):
                print(f'进站接驳 {i}/{len(access)}', flush=True)
        assert all(set(heads[oid]) == set(profile['routes']) for oid, profile in profiles.items())
        atomic_json(WORK / 'return-office-access.json', heads)

        candidates = {o['id']: set() for o in offices}
        # Existing proof pairs seed the search. Only newly read reverse API
        # results, including any previously cached for this direction, enter the plans.
        for oid, plans in source['plans'].items():
            for plan in plans.values():
                meta = plan['metroApi']
                candidates[oid].add((meta['destinationPoiId'], meta['originPoiId']))
        for token in source['completedPairs']:
            oid, residence, boarding = token.split(':')
            if by_id[boarding]['name'] not in heads[oid]:
                continue
            # Include promising alternatives and all already measured reverse pairs.
            origin, destination = by_id[boarding], by_id[residence]
            reverse_cached = cached_response(SERVICE, station_params(origin, destination))
            known = cached_response(SERVICE, station_params(destination, origin))
            options = exact_station_options(known, destination, origin) if known else []
            if reverse_cached or any(sum_leg_seconds(p['journeyLegs']) <= 1320 for p in options):
                candidates[oid].add((boarding, residence))

        tasks = {pair for group in candidates.values() for pair in group}
        print(f'查验 {len(tasks)} 组返程站间路线', flush=True)
        pending = {pool.submit(measure_pair, *pair): pair for pair in tasks}
        for i, job in enumerate(as_completed(pending), 1):
            pairs[pending[job]] = job.result()
            if i % 40 == 0 or i == len(tasks):
                print(f'返程站间 {i}/{len(tasks)}', flush=True)

    plans = {o['id']: {} for o in offices}
    for oid, group in candidates.items():
        for a, b in sorted(group):
            proof = pairs[a, b]
            origin, destination = by_id[a], by_id[b]
            if not proof or origin['name'] not in heads[oid]:
                continue
            option, stamp = proof
            rails = option['journeyLegs']
            for leg in rails:
                if leg['mode'] == 'metro':
                    for point, label, poi in [('origin', 'from', 'originPoiId'), ('destination', 'to', 'destinationPoiId')]:
                        station = by_name.get(leg[label][:-1])
                        if station:
                            leg[point], leg[poi] = station['location'], station['id']
            legs = [heads[oid][origin['name']], *rails]
            duration = sum_leg_seconds(legs)
            if duration + 60 > 1200:
                continue
            old = plans[oid].get(b)
            if old and (old['duration'], sum(l['duration'] for l in old['legs'])) <= (duration, sum(l['duration'] for l in legs)):
                continue
            plans[oid][b] = {
                'id': f'{b}-{oid}-return', 'officeId': oid, 'stationId': b, 'stationName': destination['name'],
                'legs': legs, 'duration': duration, 'measuredAt': stamp,
                'originalTotalDuration': option['rawDuration'], 'originalReferenceScope': 'stations',
                'metroApi': {'originName': origin['name'], 'destinationName': destination['name']},
            }
    assert all(plans.values())
    result = {
        'methodVersion': 'amap-return-station-pair-v1', 'durationRounding': ROUNDING_VERSION,
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'complete': True,
        'departureDate': source['departureDate'], 'departureTime': source['departureTime'],
        'officeEndpoints': {o['id']: {'poiId': o['poiId'], 'entrance': o['entrance']} for o in offices},
        'access': heads, 'plans': plans,
    }
    atomic_json(ROOT / 'data/metro-return.json', result)
    print('返程下车站数', {oid: len(group) for oid, group in plans.items()}, flush=True)


if __name__ == '__main__':
    main()
