import unittest,sys
from geo import wgs_to_gcj,gcj_to_wgs
from prepare_rail_plans import metro_options
from prepare_station_api import exact_station_options
from cached_rail_graph import CachedRailGraph

class PolicyTests(unittest.TestCase):
    def test_cached_graph_keeps_alternative_arrival_stations(self):
        stations=[{'id':str(i),'name':name} for i,name in enumerate(['甲','乙','丙'])]
        graph=CachedRailGraph(stations)
        graph.edge(('甲','1'),('乙','1'),300)
        graph.edge(('甲','1'),('丙','1'),400)
        got=graph.candidates('office',{'乙':{'duration':100},'丙':{'duration':50}},{})
        self.assertEqual({(c['destinationName'],c['graphFixedDuration']) for c in got if c['originName']=='甲'},{('乙',420),('丙',480)})

    def test_cached_graph_preserves_known_transfer_time(self):
        stations=[{'id':str(i),'name':name} for i,name in enumerate(['甲','换乘','乙'])]
        def line(a,b,number):
            return {'type':'地铁线路','name':f'地铁{number}号线(测试方向)','cost':{'duration':'300'},'departure_stop':{'name':a,'location':'113.93,22.51'},'arrival_stop':{'name':b,'location':'113.94,22.52'}}
        first,last=line('甲','换乘',1),line('换乘','乙',2)
        data={'route':{'transits':[{'cost':{'duration':'1500'},'segments':[
            {'walking':{'cost':{'duration':'100'}},'bus':{'buslines':[first]}},
            {'walking':{'cost':{'duration':'90'},'origin':'113.94,22.52','destination':'113.94,22.52'},'bus':{'buslines':[last]}},
            {'walking':{'cost':{'duration':'710'}}}]}]}}
        graph=CachedRailGraph(stations);graph.add_response(data)
        got=graph.candidates('office',{'乙':{'duration':80}},{});candidate=next(c for c in got if c['originName']=='甲')
        self.assertEqual(candidate['graphFixedDuration'],780) # 300 + round(90s)=120 + 300 + round(80s)=60
        self.assertEqual(candidate['destinationName'],'乙')
        self.assertFalse(any(c['originName']=='乙' for c in got)) # Ground-only access is not metro.
        self.assertEqual(graph.candidates('office',{'乙':{'duration':80}},{'0':{'duration':780,'legs':[{'duration':780}]}}),[c for c in got if c['originName']!='甲'])
        disconnected=CachedRailGraph(stations)
        for train in [first,last]:
            disconnected.add_response({'route':{'transits':[{'cost':{'duration':'300'},'segments':[{'bus':{'buslines':[train]}}]}]}})
        self.assertFalse(any(c['originName']=='甲' for c in disconnected.candidates('office',{'乙':{'duration':80}},{})))

    def test_boarding_and_arrival_must_match_requested_station_pair(self):
        line={'type':'地铁线路','cost':{'duration':'600'},'departure_stop':{'name':'南油','location':'113.92,22.51'},'arrival_stop':{'name':'粤海门','location':'113.94,22.53'}}
        data={'route':{'transits':[{'cost':{'duration':'1000'},'segments':[{'bus':{'buslines':[line]}}]}]}}
        self.assertEqual(exact_station_options(data,{'name':'四海'},{'name':'粤海门'}),[])
        self.assertEqual(len(exact_station_options(data,{'name':'南油'},{'name':'粤海门'})),1)
        self.assertEqual(exact_station_options(data,{'name':'南油'},{'name':'科苑'}),[])
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
