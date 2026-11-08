import unittest,sys
from geo import wgs_to_gcj,gcj_to_wgs
from prepare_rail_plans import metro_options

class PolicyTests(unittest.TestCase):
    def test_roundtrip_coordinates(self):
        for p in [(113.94,22.52),(113.91,22.48)]:
            q=gcj_to_wgs(*wgs_to_gcj(*p))
            self.assertLess(max(abs(a-b) for a,b in zip(p,q)),1e-7)
    def test_only_rail_segments_count_in_custom_clock(self):
        line={'type':'地铁线路','cost':{'duration':'300'},'departure_stop':{'location':'113.93,22.51','name':'登良'},'arrival_stop':{'location':'113.94,22.52','name':'科苑'}}
        transit={'cost':{'duration':'900'},'segments':[{'walking':{'cost':{'duration':'600'}}},{'bus':{'buslines':[line]}}]}
        got=metro_options({'route':{'transits':[transit]}},{})
        self.assertEqual(got[0]['railDuration'],300)
        self.assertEqual(got[0]['rawDuration'],900)
        self.assertEqual(got[0]['transferDuration'],0)
        transit['segments']=[{'walking':{'cost':{'duration':'100'}},'bus':{'buslines':[line]}},{'walking':{'origin':'113.94,22.52','destination':'113.94,22.52','cost':{'duration':'90'}},'bus':{'buslines':[line]}},{'walking':{'cost':{'duration':'700'}}}]
        got=metro_options({'route':{'transits':[transit]}},{})[0]
        self.assertEqual(got['railDuration'],600)
        self.assertEqual(got['transferDuration'],90)
        self.assertEqual(got['fixedDuration'],690)
        self.assertEqual(sum(leg['duration'] for leg in got['journeyLegs']),690)
        line['type']='普通公交线路'
        self.assertEqual(metro_options({'route':{'transits':[transit]}},{}),[])

if __name__=='__main__':unittest.main()
