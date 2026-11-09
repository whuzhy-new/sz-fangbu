"""Re-evaluate cached route proofs and all office layers under the minute policy.

This command never requests AMap. Raw measurements, calibration, coordinates and
the shared road graph stay unchanged. The old bundle is archived before install.
"""
import argparse
import copy
import time
from pathlib import Path

from amap import ROOT, WORK, atomic_json, cached_response, cache_path
from correction import BicycleCorrection
from duration_policy import ROUNDING_VERSION, ROUND_UP_SECONDS, plan_seconds, sum_leg_seconds
from expand_rail_candidates import tail_leg
from generate_coverage import export_index, generate_coverage
from network import Network
from prepare_rail_plans import station_params
from prepare_station_api import VERSION, exact_station_options, stamp
from retarget_office import snapshot_baseline, read, digest, endpoint

SERVICE = 'v5/direction/transit/integrated'
OUTPUTS = ['public/data/metro-plans.json', 'data/metro-index.json',
           'public/data/coverage.json', 'public/data/coverage-corrections.json',
           'work/station-api-progress.json']


def best_option(options, tail):
    """Rank complete per-leg sums; changing the threshold can change the winner."""
    return min(options, key=lambda p: (sum_leg_seconds(p['journeyLegs'] + [tail]),
                                     sum(l.get('rawDuration', l['duration']) for l in p['journeyLegs']) + tail['duration'])) if options else None


def reselect_plans(original, offices, stations):
    result = copy.deepcopy(original)
    result['plans'] = {o['id']: {} for o in offices}
    by_id = {s['id']: s for s in stations}
    by_office = {o['id']: o for o in offices}
    tails = {}
    checks = []
    for token in original['completedPairs']:
        oid, origin, destination = token.split(':')
        office, a, b = by_office[oid], by_id[origin], by_id[destination]
        key = oid, destination
        if key not in tails:
            tail = tail_leg(office, b, original['entries'], cache_only=True)
            if tail is None:
                raise RuntimeError('Missing cached office tail: ' + oid + ':' + b['name'])
            tails[key] = tail
        tail = tails[key]
        params = station_params(a, b)
        data = cached_response(SERVICE, params)
        if data is None:
            raise RuntimeError('Missing cached station proof: ' + token)
        option = best_option(exact_station_options(data, a, b), tail)
        rounded = sum_leg_seconds(option['journeyLegs'] + [tail]) if option else None
        checks.append({'pair': token, 'roundedDurationSeconds': rounded})
        if option is None or rounded > 1200:
            continue
        old = result['plans'][oid].get(origin)
        raw = sum(l.get('rawDuration', l['duration']) for l in option['journeyLegs']) + tail['duration']
        if old is not None and (plan_seconds(old), old['duration']) <= (rounded, raw):
            continue
        previous = original['plans'][oid].get(origin, {})
        plan = {
            'id': origin + '-' + oid, 'stationId': origin, 'stationName': a['name'],
            'officeId': oid, 'duration': raw, 'legs': copy.deepcopy(option['journeyLegs'] + [tail]),
            'lines': option['lines'], 'source': 'amap', 'clock': VERSION,
            'measuredAt': previous.get('measuredAt') or stamp_from_cache(cache_path(SERVICE, params)),
            'recalculatedAt': stamp(), 'durationRounding': ROUNDING_VERSION,
            'officeEndpoint': endpoint(office), 'originalTotalDuration': option['rawDuration'],
            'originalReferenceScope': 'stations',
            'metroApi': {'originPoiId': origin, 'destinationPoiId': destination,
                         'originName': a['name'], 'destinationName': b['name'], 'strategy': 6},
            'candidateDiscovery': 'cached-pairs-policy-reselection',
        }
        assert abs(sum(l['duration'] for l in plan['legs']) - raw) < .001
        result['plans'][oid][origin] = plan
    result.update(generatedAt=stamp(), durationRounding=ROUNDING_VERSION)
    result['officeEndpoints'] = {o['id']: endpoint(o) for o in offices}
    result['officeGeneratedAt'] = {o['id']: result['generatedAt'] for o in offices}
    result['durationPolicyAudit'] = {'policy': ROUNDING_VERSION, 'roundUpSeconds': ROUND_UP_SECONDS,
                                    'cachedPairsRechecked': len(checks), 'newApiRequests': 0}
    return result, checks


def stamp_from_cache(path):
    import datetime
    return datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat()


def refresh_patches(original, rail):
    result = copy.deepcopy(original)
    for feature in result['features']:
        p = feature['properties']
        proof = p['proof']
        if proof.get('method') == 'segmented':
            boarding = proof['metroApi']['originPoiId']
            fixed = rail['plans'][p['officeId']].get(boarding)
            if fixed:
                proof['legs'] = [proof['legs'][0]] + copy.deepcopy(fixed['legs'])
                proof['metroApi'] = copy.deepcopy(fixed['metroApi'])
        duration = sum(l.get('rawDuration', l['duration']) for l in proof['legs'])
        proof['duration'] = duration
        p.update(durationSeconds=duration, roundedDurationSeconds=sum_leg_seconds(proof['legs']),
                 durationRounding=ROUNDING_VERSION, recalculatedAt=stamp())
    result['metadata'].update(generatedAt=stamp(), durationRounding=ROUNDING_VERSION)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', default='minute-30s-t2-2026-11-09')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    started = time.monotonic()
    baseline = ROOT / 'data/snapshots' / args.snapshot
    manifest = snapshot_baseline(baseline)
    stage = WORK / 'duration-policy' / ROUNDING_VERSION
    stage.mkdir(parents=True, exist_ok=True)
    before_usage = read(WORK / 'amap-usage.json')
    offices = read(baseline / 'public/data/offices.json')
    original = read(baseline / 'public/data/metro-plans.json')
    assert original['complete'] and original['methodVersion'] == VERSION
    stations = read(ROOT / 'public/data/stations.json')['stations']
    rail, checks = reselect_plans(original, offices, stations)
    patches = refresh_patches(read(baseline / 'public/data/coverage-corrections.json'), rail)
    coverage = generate_coverage(rail, offices, Network(), BicycleCorrection(), copy.deepcopy(patches['features']))
    coverage['metadata']['officeEndpoints'] = rail['officeEndpoints']
    coverage['metadata']['officeGeneratedAt'] = rail['officeGeneratedAt']
    coverage['metadata']['roundUpSeconds'] = ROUND_UP_SECONDS
    coverage['metadata']['note'] = coverage['metadata']['note'].replace('时长按分钟取整', f'余秒满{ROUND_UP_SECONDS}秒进一分，不足{ROUND_UP_SECONDS}秒舍去')
    atomic_json(stage / 'public/data/coverage.json', coverage)
    atomic_json(stage / 'public/data/coverage-corrections.json', patches)
    export_index(rail, stage / 'public/data/metro-plans.json', stage / 'data/metro-index.json')
    atomic_json(stage / 'work/station-api-progress.json', rail)
    atomic_json(stage / 'pair-checks.json', checks)
    assert before_usage == read(WORK / 'amap-usage.json'), 'Unexpected AMap usage during cache-only rebuild'
    assert digest(ROOT / 'public/data/road-network/manifest.json') == manifest['roadNetworkManifestSha256']
    old_coverage = read(baseline / 'public/data/coverage.json')
    areas_before = {(f['properties']['officeId'], f['properties']['mode']): f['properties']['areaKm2'] for f in old_coverage['features']}
    report = {
        'complete': True, 'applied': args.apply, 'generatedAt': stamp(),
        'previousPolicy': old_coverage['metadata']['durationRounding'], 'policy': ROUNDING_VERSION,
        'roundUpSeconds': ROUND_UP_SECONDS, 'baseline': str(baseline.relative_to(ROOT)),
        'elapsedSeconds': round(time.monotonic()-started, 2), 'newApiRequests': 0,
        'cachedStationPairs': len(checks), 'beforeBoardingStations': {k: len(v) for k, v in original['plans'].items()},
        'afterBoardingStations': {k: len(v) for k, v in rail['plans'].items()},
        'areaChanges': [{'officeId': f['properties']['officeId'], 'mode': f['properties']['mode'],
                         'beforeKm2': areas_before[f['properties']['officeId'], f['properties']['mode']],
                         'afterKm2': f['properties']['areaKm2']} for f in coverage['features']],
        'communityCorrections': coverage['metadata']['verifiedCommunityCorrections'],
    }
    atomic_json(stage / 'report.json', report)
    if args.apply:
        for name in manifest['files']:
            if digest(ROOT / name) != manifest['files'][name]['sha256']:
                raise RuntimeError('Live data changed during preparation: ' + name)
        installed = []
        try:
            for name in OUTPUTS:
                atomic_json(ROOT / name, read(stage / name))
                installed.append(name)
        except Exception:
            import shutil
            for name in installed:
                shutil.copyfile(baseline / name, ROOT / name)
            raise
        atomic_json(ROOT / 'data/duration-policy-report.json', report)
    import json
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
