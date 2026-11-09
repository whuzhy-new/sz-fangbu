"""Validate additional station pairs discovered by the cached metro graph.

Retains only exact station-pair API proofs. Public data is replaced atomically
after the entire run succeeds; failed calls leave the existing range intact.
"""
import argparse
import copy
import json

from amap import ROOT, WORK, atomic_json, cached_response, request
from cached_rail_graph import CachedRailGraph
from duration_policy import round_seconds,sum_leg_seconds,plan_seconds
from prepare_rail_plans import full_params, station_params, surface
from prepare_station_api import VERSION, exact_station_options, stamp

SERVICE = 'v5/direction/transit/integrated'


def tail_leg(office, station, entries, cache_only):
    best = None
    for gate in entries.get(station['id'], []):
        if gate['source'] != 'amap':
            continue
        for mode in ['walking', 'bicycling']:
            params = {'origin': ','.join(f'{x:.6f}' for x in gate['location']),
                      'destination': ','.join(f'{x:.6f}' for x in office['entrance']),
                      'show_fields': 'cost,polyline,navi'}
            data = cached_response('v5/direction/' + mode, params)
            if data is None and not cache_only:
                data = request('v5/direction/' + mode, params)
            paths = (data or {}).get('route', {}).get('paths', [])
            if not paths:
                continue
            path = paths[0]
            raw = path.get('cost', {}).get('duration', path.get('duration'))
            if raw is None:
                continue
            duration = float(raw)
            if duration <= 0 or (best and best['duration'] <= duration):
                continue
            route = {'duration': duration, 'distance': float(path['distance']), 'steps': path.get('steps', [])}
            best = surface(route, mode, gate['location'], office['entrance'], gate['name'], office['name'])
    return best


def main(cache_only=False):
    original = json.loads((ROOT / 'public/data/metro-plans.json').read_text())
    if not original['complete'] or original['methodVersion'] != VERSION:
        raise RuntimeError('Complete, compatible station-pair data is required.')
    result = copy.deepcopy(original)
    report_prefix = 'rail-graph-cache' if cache_only else 'rail-graph-expansion'
    offices = json.loads((ROOT / 'public/data/offices.json').read_text())
    stations = json.loads((ROOT / 'public/data/stations.json').read_text())['stations']
    by_id, by_name = {s['id']: s for s in stations}, {s['name']: s for s in stations}
    graph = CachedRailGraph(stations)
    target_names = {o['id']: set() for o in offices}
    for office in offices:
        for station in stations:
            options = graph.add_response(cached_response(SERVICE, full_params(station, office)))
            target_names[office['id']].update(p['arrivalName'] for p in options if p['arrivalName'] in by_name)
    for token in original['completedPairs']:
        office_id, origin, destination = token.split(':')
        graph.add_response(cached_response(SERVICE, station_params(by_id[origin], by_id[destination])))
        target_names[office_id].add(by_id[destination]['name'])
    tails = {}
    for office in offices:
        tails[office['id']] = {}
        for name in sorted(target_names[office['id']]):
            tail = tail_leg(office, by_name[name], original['entries'], cache_only)
            if tail and round_seconds(tail['duration']) <= 1200:
                tails[office['id']][name] = tail
    attempted, checks, improvements = set(), [], []
    while True:
        candidates = [c for office in offices for c in graph.candidates(office['id'], tails[office['id']], result['plans'][office['id']])]
        pending = [c for c in candidates if (c['officeId'], c['originId'], c['destinationId']) not in attempted]
        if not pending:
            break
        for candidate in pending:
            oid, origin, destination = candidate['officeId'], candidate['originId'], candidate['destinationId']
            attempted.add((oid, origin, destination))
            params = station_params(by_id[origin], by_id[destination])
            data = cached_response(SERVICE, params)
            if data is None and not cache_only:
                data = request(SERVICE, params)
            check = {**candidate, 'status': 'missing-cache'}
            if data is not None:
                graph.add_response(data)
                token = f'{oid}:{origin}:{destination}'
                if token not in result['completedPairs']:
                    result['completedPairs'].append(token)
                options = exact_station_options(data, by_id[origin], by_id[destination])
                check['status'] = 'no-matching-station-route'
                if options:
                    option = min(options, key=lambda p: sum_leg_seconds(p['journeyLegs']))
                    tail = tails[oid][candidate['destinationName']]
                    duration = option['fixedDuration'] + tail['duration']
                    check.update(status='no-improvement', apiFixedDuration=duration)
                    old = result['plans'][oid].get(origin)
                    if sum_leg_seconds(option['journeyLegs']+[tail]) <= 1200 and (old is None or sum_leg_seconds(option['journeyLegs']+[tail]) < plan_seconds(old)):
                        legs = option['journeyLegs'] + [tail]
                        assert abs(sum(l['duration'] for l in legs) - duration) < .001
                        result['plans'][oid][origin] = {
                            'id': origin + '-' + oid, 'stationId': origin, 'stationName': candidate['originName'],
                            'officeId': oid, 'duration': duration, 'legs': legs, 'lines': option['lines'],
                            'measuredAt': stamp(), 'source': 'amap', 'originalTotalDuration': option['rawDuration'],
                            'originalReferenceScope': 'stations', 'clock': VERSION,
                            'metroApi': {'originPoiId': origin, 'destinationPoiId': destination,
                                         'originName': candidate['originName'], 'destinationName': candidate['destinationName'], 'strategy': 6},
                            'candidateDiscovery': 'cached-rail-graph',
                        }
                        check['status'] = 'improved'
                        improvements.append(check)
            checks.append(check)
            atomic_json(WORK / (report_prefix + '-progress.json'), {'checks': checks, 'improvements': improvements})
            print(json.dumps({k: check[k] for k in ['officeId', 'originName', 'destinationName', 'status']} | {'apiFixedDuration': check.get('apiFixedDuration')}, ensure_ascii=False), flush=True)
    audit = {'generatedAt': stamp(), 'cacheOnly': cache_only, 'cachedResponses': len(graph.seen),
             'graphNodes': graph.graph.number_of_nodes(), 'graphEdges': graph.graph.number_of_edges(),
             'checkedCandidates': len(checks), 'checks': checks, 'improvements': improvements,
             'note': 'Only exact station-pair API responses can update the range. Graph costs are candidate estimates.'}
    atomic_json(WORK / (report_prefix + '-audit.json'), audit)
    if not cache_only:
        result['generatedAt'] = stamp()
        result['graphCandidateAudit'] = {k: audit[k] for k in ['generatedAt', 'cachedResponses', 'graphNodes', 'graphEdges', 'checkedCandidates']}
        result['graphCandidateAudit']['improvementsThisRun'] = len(improvements)
        result['graphCandidateAudit']['improvedOrigins'] = sum(p.get('candidateDiscovery') == 'cached-rail-graph' for plans in result['plans'].values() for p in plans.values())
        atomic_json(ROOT / 'public/data/metro-plans.json', result)
        atomic_json(WORK / 'station-api-progress.json', result)
    print(json.dumps({'checkedCandidates': len(checks), 'improvedOrigins': len(improvements)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-only', action='store_true', help='Audit without new API calls or publishing data.')
    main(parser.parse_args().cache_only)
