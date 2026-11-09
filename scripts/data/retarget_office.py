"""Stage an office endpoint change, retaining an immutable, checksummed baseline.

Reuse the directed road graph and exact station-pair proofs, not destination-
dependent tails, calibration samples or residential patch proofs. Nothing in the
live dataset is changed before the staged bundle passes the isolation audit.
"""
import argparse
import copy
import hashlib
import json
import math
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from amap import ROOT, WORK, atomic_json, cached_response, request, route
from cached_rail_graph import CachedRailGraph
from correction import BicycleCorrection
from duration_policy import plan_seconds, round_seconds, sum_leg_seconds
from expand_rail_candidates import tail_leg
from generate_coverage import generate_coverage, export_index
from geo import wgs_to_gcj
from network import Network
from prepare_rail_plans import full_params, meters, station_params, surface
from prepare_station_api import VERSION, exact_station_options, stamp

SERVICE = 'v5/direction/transit/integrated'
BUNDLE_FILES = [
    'public/data/offices.json', 'public/data/metro-plans.json',
    'public/data/coverage.json', 'public/data/calibration.json',
    'public/data/validation.json', 'public/data/coverage-corrections.json',
    'data/metro-index.json', 'work/bicycle-calibration.json',
    'work/network-validation.json', 'work/station-api-progress.json',
]


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def endpoint(office):
    data = {k: office[k] for k in ['poiId', 'entrance']}
    if office.get('walkingIdentity'):
        data['walkingIdentity'] = office['walkingIdentity']
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:16]
    return {**data, 'name': office['name'], 'signature': fingerprint}


def snapshot_baseline(folder):
    manifest_path = folder / 'manifest.json'
    if not manifest_path.exists():
        folder.mkdir(parents=True, exist_ok=True)
        files = {}
        for name in BUNDLE_FILES:
            source = ROOT / name
            if not source.exists():
                continue
            destination = folder / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            files[name] = {'sha256': digest(source), 'bytes': source.stat().st_size}
        atomic_json(manifest_path, {
            'createdAt': stamp(), 'offices': read(ROOT / 'public/data/offices.json'),
            'files': files, 'roadNetworkManifestSha256': digest(ROOT / 'public/data/road-network/manifest.json'),
            'note': '通勤终点历史版本。保留路线、范围、校准、验证与生成检查点；不包含密钥。',
        })
    manifest = read(manifest_path)
    for name, info in manifest['files'].items():
        if digest(folder / name) != info['sha256']:
            raise RuntimeError('Baseline snapshot was modified: ' + name)
    return manifest


def replace_office_coverage(previous, generated, oid, identity):
    """Keep other offices' features and statistics exactly as they were."""
    result = copy.deepcopy(previous)
    fresh = {f['properties']['mode']: f for f in generated['features']}
    result['features'] = [copy.deepcopy(fresh[f['properties']['mode']])
                          if f['properties']['officeId'] == oid else f
                          for f in result['features']]
    meta = result['metadata']
    for key in ['generatedAt', 'bicycleCalibrationSamples', 'bicycleAccessTimeRatio']:
        meta[key] = generated['metadata'][key]
    for key in ['offices', 'exportedCleanup']:
        meta['smallHoleCompletion'][key][oid] = generated['metadata']['smallHoleCompletion'][key][oid]
    meta['verifiedCommunityCorrections'][oid] = generated['metadata']['verifiedCommunityCorrections'][oid]
    meta.setdefault('officeEndpoints', {})[oid] = identity
    meta.setdefault('officeGeneratedAt', {f['properties']['officeId']: previous['metadata']['generatedAt']
                                        for f in previous['features']})[oid] = meta['generatedAt']
    return result


def assert_isolation(baseline, staged, oid):
    """Reject stale endpoint proofs and accidental changes to unrelated offices."""
    old_offices = read(baseline / 'public/data/offices.json')
    offices = read(staged / 'public/data/offices.json')
    office = next(o for o in offices if o['id'] == oid)
    for original in old_offices:
        if original['id'] != oid:
            assert original == next(o for o in offices if o['id'] == original['id'])
    original = read(baseline / 'public/data/metro-plans.json')
    rail = read(staged / 'public/data/metro-plans.json')
    assert rail['entries'] == original['entries']
    for other in original['plans']:
        if other != oid:
            assert rail['plans'][other] == original['plans'][other]
    for plan in rail['plans'][oid].values():
        assert plan['legs'][-1]['destination'] == office['entrance']
        if plan['legs'][-1].get('routingIdentity') == 'poi':
            assert plan['legs'][-1]['destinationPoiId'] == office['poiId']
        if office.get('walkingIdentity') == 'poi' and plan['legs'][-1]['mode'] == 'walking':
            assert plan['legs'][-1].get('routingIdentity') == 'poi'
        assert plan['officeEndpoint'] == endpoint(office)
        metro = [l for l in plan['legs'] if l['mode'] == 'metro']
        assert metro[0]['from'] == plan['metroApi']['originName'] + '站'
        assert metro[-1]['to'] == plan['metroApi']['destinationName'] + '站'
        assert plan_seconds(plan) <= 1200
    for name, rows_key in [('coverage.json', 'features'), ('coverage-corrections.json', 'features'),
                           ('calibration.json', 'samples'), ('validation.json', 'samples')]:
        before = read(baseline / 'public/data' / name)
        after = read(staged / 'public/data' / name)
        office_id = lambda r: r.get('properties', r)['officeId']
        assert [r for r in before[rows_key] if office_id(r) != oid] == [
            r for r in after[rows_key] if office_id(r) != oid], name
        if name == 'coverage.json':
            assert len(after['features']) == len(before['features'])
            assert after['metadata']['bicycleAccessTimeRatio'] == before['metadata']['bicycleAccessTimeRatio']
        elif name == 'coverage-corrections.json':
            for feature in after['features']:
                p = feature['properties']
                if p['officeId'] == oid:
                    assert p['proof']['legs'][-1]['destination'] == office['entrance']
        else:
            for row in after[rows_key]:
                if row['officeId'] == oid:
                    assert row['officeEndpoint'] == endpoint(office), name
    skinny = read(staged / 'data/metro-index.json')
    expected = copy.deepcopy(rail)
    for plans in expected['plans'].values():
        for plan in plans.values():
            for leg in plan['legs']:
                leg['paths'] = []
    assert skinny == expected


def prepare_rail(old, old_offices, office, stations, stage):
    oid = office['id']
    by_id = {s['id']: s for s in stations}
    graph = CachedRailGraph(stations)
    target_names = set()
    for previous_office in old_offices:
        for s in stations:
            options = graph.add_response(cached_response(SERVICE, full_params(s, previous_office)))
            if previous_office['id'] == oid:
                target_names.update(p['arrivalName'] for p in options)
    for token in old['completedPairs']:
        previous_oid, a, b = token.split(':')
        graph.add_response(cached_response(SERVICE, station_params(by_id[a], by_id[b])))
        if previous_oid == oid:
            target_names.add(by_id[b]['name'])
    # Re-evaluate nearby arrival stations too, rather than freezing the old
    # park entrance's handful of preferred arrival stations.
    targets = [s for s in stations if s['name'] in target_names or meters(s['location'], office['entrance']) < 3500]
    tails = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(tail_leg, office, s, old['entries'], False): s for s in targets}
        for future in as_completed(pending):
            s = pending[future]
            tail = future.result()
            if tail and round_seconds(tail['duration']) + 60 <= 1200:
                tails[s['name']] = tail
            atomic_json(stage / 'tails.json', {'officeEndpoint': endpoint(office), 'tails': tails})
            print(json.dumps({'phase': 'office-tails', 'station': s['name'], 'finished': len(tails),
                              'tailSeconds': tail['duration'] if tail else None}, ensure_ascii=False), flush=True)
    result = copy.deepcopy(old)
    # Never compare a T2 candidate against an old park-entrance plan.
    result['plans'][oid] = {}
    attempted = set()
    checks = []

    def check(a, b):
        if (a, b) in attempted or a == b or by_id[b]['name'] not in tails:
            return
        attempted.add((a, b))
        params = station_params(by_id[a], by_id[b])
        cache_hit = cached_response(SERVICE, params) is not None
        response = request(SERVICE, params)
        graph.add_response(response)
        token = f'{oid}:{a}:{b}'
        if token not in result['completedPairs']:
            result['completedPairs'].append(token)
        options = exact_station_options(response, by_id[a], by_id[b])
        tail = tails[by_id[b]['name']]
        option = min(options, key=lambda p: (sum_leg_seconds(p['journeyLegs']), p['fixedDuration'])) if options else None
        plan = None
        if option and sum_leg_seconds(option['journeyLegs'] + [tail]) <= 1200:
            legs = copy.deepcopy(option['journeyLegs'] + [tail])
            plan = {'id': a + '-' + oid, 'stationId': a, 'stationName': by_id[a]['name'],
                    'officeId': oid, 'duration': sum(l['duration'] for l in legs), 'legs': legs,
                    'lines': option['lines'], 'measuredAt': stamp(), 'source': 'amap',
                    'originalTotalDuration': option['rawDuration'], 'originalReferenceScope': 'stations',
                    'clock': VERSION, 'officeEndpoint': endpoint(office),
                    'metroApi': {'originPoiId': a, 'destinationPoiId': b,
                                 'originName': by_id[a]['name'], 'destinationName': by_id[b]['name'], 'strategy': 6},
                    'candidateDiscovery': 'endpoint-retarget-cached-rail-graph'}
            previous = result['plans'][oid].get(a)
            if previous is None or (plan_seconds(plan), plan['duration']) < (plan_seconds(previous), previous['duration']):
                result['plans'][oid][a] = plan
        checks.append({'originId': a, 'destinationId': b, 'cached': cache_hit,
                       'acceptedSeconds': plan_seconds(plan) if plan else None})
        atomic_json(stage / 'rail-checks.json', checks)

    for token in old['completedPairs']:
        previous_oid, a, b = token.split(':')
        if previous_oid == oid:
            check(a, b)
    while True:
        candidates = graph.candidates(oid, tails, result['plans'][oid])
        pending = [c for c in candidates if (c['originId'], c['destinationId']) not in attempted]
        if not pending:
            break
        for c in sorted(pending, key=lambda c: c['graphFixedDuration']):
            check(c['originId'], c['destinationId'])
            if len(checks) % 25 == 0:
                print(json.dumps({'phase': 'station-pairs', 'checks': len(checks),
                                  'boardingStations': len(result['plans'][oid])}), flush=True)
    result['generatedAt'] = stamp()
    result.setdefault('officeEndpoints', {})[oid] = endpoint(office)
    result.setdefault('officeGeneratedAt', {o['id']: old['generatedAt'] for o in old_offices})[oid] = result['generatedAt']
    result['endpointRetargetAudit'] = {'officeId': oid, 'checkedPairs': len(checks),
                                      'cachedPairs': sum(c['cached'] for c in checks),
                                      'arrivalStations': len(tails), 'at': stamp()}
    export_index(result, stage / 'public/data/metro-plans.json', stage / 'data/metro-index.json')
    return result


def calibrate(net, office, baseline, stage, access_ratio):
    path = stage / 'calibration-samples.json'
    rows = read(path) if path.exists() else [r for r in read(baseline / 'work/bicycle-calibration.json') if r['officeId'] != office['id']]
    # A checkpoint can only be resumed for exactly this destination.
    assert all(r['officeId'] != office['id'] or r.get('officeEndpoint') == endpoint(office) for r in rows)
    done = {r['id'] for r in rows}
    field = net.field([(office['entrance'], 0)], 'bicycling', limit=9000)
    center = net.point(office['entrance'])
    for radius in [350, 900, 1800, 3000]:
        for sector in range(12):
            key = f"{office['id']}-{radius}-{sector}"
            if key in done:
                continue
            angle = (sector + .37) * math.pi / 6
            point = center + radius * np.array([math.cos(angle), math.sin(angle)])
            snap, idx = net.trees['bicycling'].query(point)
            if snap > 200:
                continue
            node = net.ids['bicycling'][idx]
            location = list(wgs_to_gcj(*net.wgs[node]))
            predicted, _ = net.time_at(location, field, 'bicycling')
            if not math.isfinite(predicted) or predicted > 7200:
                continue
            actual = route('bicycling', location, office['entrance'])
            if not actual:
                raise RuntimeError('Missing calibration route: ' + key)
            rows.append({'id': key, 'officeId': office['id'], 'origin': location,
                         'projected': net.xy[node].tolist(), 'modelSeconds': predicted,
                         'amapSeconds': actual['duration'], 'amapDistanceM': actual['distance'],
                         'officeEndpoint': endpoint(office), 'measuredAt': stamp()})
            atomic_json(path, rows)
        print(json.dumps({'phase': 'calibration', 'radius': radius, 'samples': len(rows)}), flush=True)
    public = read(baseline / 'public/data/calibration.json')
    public.update(samples=rows, generatedAt=stamp(), bicycleAccessTimeRatio=access_ratio,
                  accessRatioSource='Preserved shared road-network manifest; office-specific samples recalibrated separately.')
    public.setdefault('officeEndpoints', {})[office['id']] = endpoint(office)
    atomic_json(stage / 'public/data/calibration.json', public)
    atomic_json(stage / 'work/bicycle-calibration.json', rows)
    return BicycleCorrection(rows, access_ratio)


def refresh_patches(office, rail, baseline, stage):
    patches = read(baseline / 'public/data/coverage-corrections.json')
    for feature in patches['features']:
        p = feature['properties']
        if p['officeId'] != office['id']:
            continue
        proof = p['proof']
        if proof['method'] == 'segmented':
            boarding = proof['metroApi']['originPoiId']
            fixed = rail['plans'][office['id']].get(boarding)
            if not fixed:
                raise RuntimeError('No new fixed route for community: ' + p['name'])
            # Residential origin and its previously measured station access are
            # unchanged. Replace the complete fixed rail+office chain together.
            access = copy.deepcopy(proof['legs'][0])
            legs = [access] + copy.deepcopy(fixed['legs'])
            proof.update(legs=legs, metroApi=fixed['metroApi'])
        else:
            mode = proof['legs'][0]['mode']
            actual = route(mode, p['entrance'], office['entrance'],
                           destination_poi=office['poiId'] if office.get('walkingIdentity')=='poi' else None)
            if not actual:
                raise RuntimeError('No new direct route for community: ' + p['name'])
            proof['legs'] = [surface(actual, mode, p['entrance'], office['entrance'], p['entranceName'], office['name'])]
        duration = sum(l['duration'] for l in proof['legs'])
        proof['duration'] = duration
        p.update(durationSeconds=duration, measuredAt=stamp(), officeEndpoint=endpoint(office))
    patches['metadata']['generatedAt'] = stamp()
    patches['metadata'].setdefault('officeEndpoints', {})[office['id']] = endpoint(office)
    atomic_json(stage / 'public/data/coverage-corrections.json', patches)
    return patches


def validate(net, office, correction, baseline, stage):
    validation = read(baseline / 'public/data/validation.json')
    fields = {m: net.field([(office['entrance'], 0)], m, limit=18000) for m in ['walking', 'bicycling']}
    for row in validation['samples']:
        if row['officeId'] != office['id']:
            continue
        mode = row['mode']
        actual = route(mode, row['origin'], office['entrance'],
                       destination_poi=office['poiId'] if office.get('walkingIdentity')=='poi' else None)
        if not actual:
            raise RuntimeError('No validation route: ' + row['name'])
        predicted, snap = net.time_at(row['origin'], fields[mode], mode)
        if mode == 'bicycling':
            predicted = float(correction.direct(office['id'], np.array([net.point(row['origin'])]), np.array([predicted]))[0])
        row.update(amapDistanceM=actual['distance'], amapDurationSeconds=actual['duration'],
                   modelDurationSeconds=round(predicted, 1) if math.isfinite(predicted) else None,
                   errorSeconds=round(predicted-actual['duration'], 1) if math.isfinite(predicted) else None,
                   snapDistanceM=round(snap, 1), officeEndpoint=endpoint(office), measuredAt=stamp())
    for mode in fields:
        rows = [r for r in validation['samples'] if r['mode'] == mode]
        errors = [abs(r['errorSeconds']) for r in rows if r['errorSeconds'] is not None]
        validation['summary'][mode] = {
            'sampleCount': len(errors), 'meanAbsoluteErrorSeconds': round(float(np.mean(errors)), 1),
            'maxAbsoluteErrorSeconds': max(errors), 'p90AbsoluteErrorSeconds': round(float(np.percentile(errors, 90)), 1),
            'unreachableSamples': sum(r['modelDurationSeconds'] is None for r in rows)}
    validation['measuredAt'] = stamp()
    validation['speedCalibration']['spatialCalibrationPairs'] = len(correction.rows)
    validation.setdefault('officeEndpoints', {})[office['id']] = endpoint(office)
    atomic_json(stage / 'public/data/validation.json', validation)
    atomic_json(stage / 'work/network-validation.json', validation['samples'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--office-config', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    started = time.monotonic()
    office = read(ROOT / args.office_config)
    oid = office['id']
    baseline = ROOT / 'data/snapshots' / args.snapshot
    manifest = snapshot_baseline(baseline)
    stage = WORK / 'office-retarget' / (oid + '-' + endpoint(office)['signature'])
    stage.mkdir(parents=True, exist_ok=True)
    report_path = stage / 'report.json'
    if args.apply and report_path.exists():
        report = read(report_path)
        if (report.get('complete') and report.get('applied')
                and report.get('after') == endpoint(office)
                and report.get('baseline') == str(baseline.relative_to(ROOT))
                and all((stage / name).exists() and (ROOT / name).exists()
                        and digest(stage / name) == digest(ROOT / name)
                        for name in BUNDLE_FILES)):
            assert_isolation(baseline, ROOT, oid)
            print(json.dumps({'alreadyApplied': True, 'officeEndpoint': endpoint(office),
                              'baseline': report['baseline']}, ensure_ascii=False), flush=True)
            return
    old_offices = read(baseline / 'public/data/offices.json')
    assert any(o['id'] == oid for o in old_offices)
    offices = [office if o['id'] == oid else o for o in old_offices]
    atomic_json(stage / 'public/data/offices.json', offices)
    old_rail = read(baseline / 'public/data/metro-plans.json')
    assert old_rail['complete'] and old_rail['methodVersion'] == VERSION
    stations = read(ROOT / 'public/data/stations.json')['stations']
    before_usage = read(WORK / 'amap-usage.json')
    print(json.dumps({'phase': 'start', 'baseline': str(baseline.relative_to(ROOT)),
                      'officeEndpoint': endpoint(office)}, ensure_ascii=False), flush=True)
    rail = prepare_rail(old_rail, old_offices, office, stations, stage)
    net = Network()
    access_ratio = read(ROOT / 'public/data/road-network/manifest.json')['bicycleAccessRatio']
    correction = calibrate(net, office, baseline, stage, access_ratio)
    patches = refresh_patches(office, rail, baseline, stage)
    validate(net, office, correction, baseline, stage)
    generated = generate_coverage(rail, [office], net, correction, [
        copy.deepcopy(f) for f in patches['features'] if f['properties']['officeId'] == oid])
    coverage = replace_office_coverage(read(baseline / 'public/data/coverage.json'), generated, oid, endpoint(office))
    atomic_json(stage / 'public/data/coverage.json', coverage)
    atomic_json(stage / 'work/station-api-progress.json', rail)
    assert_isolation(baseline, stage, oid)
    assert digest(ROOT / 'public/data/road-network/manifest.json') == manifest['roadNetworkManifestSha256']
    report = {'complete': True, 'generatedAt': stamp(), 'elapsedSeconds': round(time.monotonic()-started, 1),
              'officeId': oid, 'before': endpoint(next(o for o in old_offices if o['id'] == oid)),
              'after': endpoint(office), 'baseline': str(baseline.relative_to(ROOT)),
              'roadGraphReused': True, 'unrelatedOfficesUnchanged': True,
              'railAudit': rail['endpointRetargetAudit'], 'usageBefore': before_usage,
              'usageAfter': read(WORK / 'amap-usage.json'), 'applied': args.apply}
    atomic_json(stage / 'report.json', report)
    if args.apply:
        # Refuse to overwrite intervening edits. A failed install can always be
        # restored from the complete baseline; staged files remain inspectable.
        for name in BUNDLE_FILES:
            if name in manifest['files'] and digest(ROOT / name) != manifest['files'][name]['sha256']:
                if (stage / name).exists() and digest(ROOT / name) == digest(stage / name):
                    continue
                raise RuntimeError('Live data changed during preparation: ' + name)
        installed = []
        try:
            for name in BUNDLE_FILES:
                source = stage / name
                if source.exists():
                    atomic_json(ROOT / name, read(source))
                    installed.append(name)
        except Exception:
            for name in installed:
                shutil.copyfile(baseline / name, ROOT / name)
            raise
        atomic_json(ROOT / 'data/office-profiles' / (oid + '-retarget-report.json'), report)
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
