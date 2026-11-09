import math
import unittest
from shapely.geometry import Polygon,box
from shapely.ops import unary_union
from coverage_geometry import complete_small_holes,enclosed_holes,apply_verified_communities
from duration_policy import round_seconds,sum_leg_seconds

class CoverageGeometryTests(unittest.TestCase):
    def test_minute_clock_matches_runtime_boundaries(self):
        for value,expected in [(0,60),(1,60),(19,60),(20,60),(29,60),(30,60),(79,60),(80,60),(89,60),(90,120),(1111,1140),(1229.999,1200),(1230,1260)]:
            self.assertEqual(round_seconds(value),expected)
        self.assertEqual(sum_leg_seconds([{'duration':619},{'duration':619}]),1200)
        self.assertEqual(sum_leg_seconds([{'duration':629},{'duration':629}]),1200)
        self.assertEqual(sum_leg_seconds([{'duration':0},{'duration':29}]),120)
        for value in [-1,math.inf,math.nan]:self.assertEqual(round_seconds(value),math.inf)

    def test_small_holes_fill_but_large_holes_and_exterior_gaps_remain(self):
        shell=box(0,0,1000,1000)
        small=box(100,100,200,200);large=box(400,400,501,500)
        bay=box(800,800,1200,1200)
        original=shell.difference(unary_union([small,large,bay]))
        result,_=complete_small_holes({'walking':original})
        self.assertEqual(len(enclosed_holes(result['walking'])),1)
        self.assertAlmostEqual(result['walking'].difference(original).area,10000)
        self.assertTrue(result['walking'].intersection(bay).area==0)

    def test_small_combined_hole_is_completed_without_changing_outline(self):
        left=box(0,0,500,500).difference(box(450,200,500,300))
        right=box(500,0,1000,500).difference(box(500,200,550,300))
        result,_=complete_small_holes({'walking':left,'bicycling':right})
        combined=unary_union(list(result.values()))
        self.assertEqual(enclosed_holes(combined),[])
        self.assertTrue(combined.equals(box(0,0,1000,500)))

    def test_community_patch_uses_rounded_proof_and_only_fills_existing_holes(self):
        hole=box(100,100,300,300);base=box(0,0,500,500).difference(hole)
        props={'mode':'bicycling','name':'小区','source':'amap','measurementPoint':'community-entrance',
            'durationSeconds':1229,'proof':{'duration':1229,'legs':[{'duration':1229}]}}
        patch={'properties':props,'geometry':box(50,50,600,600)}
        result,stats=apply_verified_communities({'bicycling':base},[patch])
        self.assertTrue(result['bicycling'].equals(box(0,0,500,500)))
        self.assertEqual(stats['communities'][0]['durationSeconds'],1200)
        props['durationSeconds']=1230;props['proof']={'duration':1230,'legs':[{'duration':1230}]}
        result,stats=apply_verified_communities({'bicycling':base},[patch])
        self.assertTrue(result['bicycling'].equals(base))
        self.assertEqual(len(stats['skippedAfterRounding']),1)

if __name__=='__main__':unittest.main()
