"""Endpoint changes must invalidate proofs without altering unrelated offices."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import retarget_office as retarget
from generate_coverage import generate_coverage
from amap import surface_params


class EndpointTests(unittest.TestCase):
    def test_matching_coordinates_do_not_make_a_coordinate_proof_poi_based(self):
        office={'id':'innovation','entrance':[113.947074,22.529024],'walkingIdentity':'poi'}
        rail={'complete':True,'methodVersion':'amap-station-pair-v3','plans':{
            'innovation':{'station':{'legs':[{'mode':'walking','destination':office['entrance']}]}}}}
        with self.assertRaisesRegex(RuntimeError,'stale office routing identity'):
            generate_coverage(rail,[office],None,None,[])

    def test_coverage_rejects_old_fixed_route_before_calculating_fields(self):
        office={'id':'innovation','entrance':[113.947837,22.528476]}
        rail={'complete':True,'methodVersion':'amap-station-pair-v3','plans':{
            'innovation':{'station':{'legs':[{'destination':[113.946916,22.529489]}]}}}}
        with self.assertRaisesRegex(RuntimeError,'Fixed route has a stale office endpoint'):
            generate_coverage(rail,[office],None,None,[])

    def test_coverage_rejects_old_community_proof_even_when_date_matches(self):
        office={'id':'innovation','entrance':[113.947837,22.528476]}
        rail={'complete':True,'methodVersion':'amap-station-pair-v3','plans':{'innovation':{}}}
        patches=[{'properties':{'officeId':'innovation','proof':{
            'legs':[{'destination':[113.946916,22.529489]}]}}}]
        with self.assertRaisesRegex(RuntimeError,'Community proof has a stale office endpoint'):
            generate_coverage(rail,[office],None,None,patches)

    def test_coordinate_or_poi_change_invalidates_destination_identity(self):
        office = {'name': '园区', 'poiId': 'B0PARK', 'entrance': [113.946916, 22.529489]}
        original = retarget.endpoint(office)['signature']
        self.assertNotEqual(original, retarget.endpoint({**office, 'poiId': 'B0T2'})['signature'])
        self.assertNotEqual(original, retarget.endpoint({**office, 'entrance': [113.947837, 22.528476]})['signature'])
        self.assertNotEqual(original, retarget.endpoint({**office, 'walkingIdentity': 'poi'})['signature'])
        self.assertEqual(original, retarget.endpoint(dict(reversed(list(office.items()))))['signature'])

    def test_walking_uses_poi_but_cycling_keeps_coordinates(self):
        origin=[113.947267,22.527251];destination=[113.947074,22.529024]
        walk=surface_params('walking',origin,destination,'BX09906574','B0H055I82U')
        self.assertEqual(walk['origin_id'],'BX09906574')
        self.assertEqual(walk['destination_id'],'B0H055I82U')
        bike=surface_params('bicycling',origin,destination,'BX09906574','B0H055I82U')
        self.assertNotIn('origin_id',bike)
        self.assertNotIn('destination_id',bike)

    def test_partial_coverage_preserves_other_offices_and_their_timestamps(self):
        def feature(oid, area):
            return {'properties': {'officeId': oid, 'mode': 'walking', 'areaKm2': area}, 'geometry': {'coordinates': [area]}}
        old = {'features': [feature('innovation', 1), feature('prince', 2)],
               'metadata': {'generatedAt': 'old', 'bicycleCalibrationSamples': 2, 'bicycleAccessTimeRatio': 1.18,
                            'smallHoleCompletion': {'offices': {'innovation': 'a', 'prince': 'b'},
                                                    'exportedCleanup': {'innovation': 'c', 'prince': 'd'}},
                            'verifiedCommunityCorrections': {'innovation': 'e', 'prince': 'f'}}}
        generated = copy.deepcopy(old)
        generated['features'] = [feature('innovation', 3)]
        generated['metadata']['generatedAt'] = 'new'
        generated['metadata']['smallHoleCompletion']['offices']['innovation'] = 'new-a'
        saved = copy.deepcopy(old)
        result = retarget.replace_office_coverage(old, generated, 'innovation', {'signature': 't2'})
        self.assertEqual(old, saved)
        self.assertEqual(result['features'][0]['properties']['areaKm2'], 3)
        self.assertEqual(result['features'][1], old['features'][1])
        self.assertEqual(result['metadata']['officeGeneratedAt'], {'innovation': 'new', 'prince': 'old'})
        self.assertEqual(result['metadata']['smallHoleCompletion']['offices']['prince'], 'b')

    def test_existing_snapshot_is_never_replaced_and_corruption_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'public/data/road-network').mkdir(parents=True)
            (root / 'public/data/road-network/manifest.json').write_text('{}')
            source = root / 'public/data/offices.json'
            source.write_text('[{"name":"old"}]')
            folder = root / 'snapshot'
            with patch.object(retarget, 'ROOT', root), patch.object(retarget, 'BUNDLE_FILES', ['public/data/offices.json']):
                manifest = retarget.snapshot_baseline(folder)
                source.write_text('[{"name":"new"}]')
                self.assertEqual(retarget.snapshot_baseline(folder), manifest)
                self.assertEqual(retarget.read(folder / 'public/data/offices.json'), [{'name': 'old'}])
                (folder / 'public/data/offices.json').write_text('[]')
                with self.assertRaisesRegex(RuntimeError, 'snapshot was modified'):
                    retarget.snapshot_baseline(folder)


if __name__ == '__main__':
    unittest.main()
