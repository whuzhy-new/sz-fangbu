"""User-selected clock: street access + AMap metro-segment and transfer times + street egress.

Include intermediate transfer walks. Do not add initial/final station walks or separate waits. Preserve original total duration
as a separate reference; never claim provider segment fields are a train timetable.
"""
import datetime, json, math
from concurrent.futures import ThreadPoolExecutor
from amap import ROOT, atomic_json, request, route
from duration_policy import round_seconds,sum_leg_seconds,plan_seconds

VERSION='street-rail-and-transfer-v2'
def coord(value):return [float(v) for v in value.split(',')]
def coordinates(value):
    if isinstance(value,dict):value=value.get('polyline','')
    return [coord(v) for v in value.split(';') if ',' in v] if isinstance(value,str) else []
def meters(a,b):return math.hypot((a[0]-b[0])*102700,(a[1]-b[1])*111200)
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def entrance_list(station):
    r=request('v3/place/text',{'keywords':station['name']+'地铁站','types':'150501','city':'440300','citylimit':'true','offset':25,'extensions':'all'},'search')
    rows=[{'id':p['id'],'name':p['name'],'location':coord(p['location']),'source':'amap'} for p in r.get('pois',[]) if p.get('name','').startswith(station['name']+'地铁站') and p.get('typecode')=='150501']
    return rows or [{'id':station['id'],'name':station['name']+'站地图定位点','location':station['location'],'source':'station-center'}]
def surface(result,mode,origin,dest,from_name,to_name):
    return {'mode':mode,'label':'步行' if mode=='walking' else '自行车','origin':origin,'destination':dest,'from':from_name,'to':to_name,'duration':result['duration'],'distance':result['distance'],'paths':[coordinates(s.get('polyline')) for s in result['steps'] if s.get('polyline')],'instructions':[s.get('instruction','') for s in result['steps']],'source':'amap',**{k:result[k] for k in ['originPoiId','destinationPoiId','routingIdentity'] if k in result}}
def metro_options(data,station):
    result=[]
    for t in data.get('route',{}).get('transits',[]):
        segments=t.get('segments',[])
        indexed=[(i,s.get('bus',{}).get('buslines',[])) for i,s in enumerate(segments) if s.get('bus',{}).get('buslines')]
        if not indexed or any(any(l.get('type')!='地铁线路' for l in group) for _,group in indexed):continue
        lines=[group[0] for _,group in indexed]
        times=[float(l.get('cost',{}).get('duration') or l.get('duration') or 0) for l in lines]
        if any(v<=0 for v in times):continue
        first,last_index=indexed[0][0],indexed[-1][0]
        legs=[];transfers=0;valid=True;previous=None
        for i,segment in enumerate(segments):
            # A segment's walking precedes its bus/rail leg. Only walking between
            # first boarding and final alighting is a transfer; access/egress is replaced.
            if first<i<=last_index:
                w=segment.get('walking') or {}
                raw=w.get('cost',{}).get('duration',w.get('duration'))
                if raw is None:
                    if segment.get('bus',{}).get('buslines'):valid=False;break
                else:
                    duration=float(raw)
                    if duration<0:valid=False;break
                    transfers+=duration
                    if duration>0:
                        current=(segment.get('bus',{}).get('buslines') or [{}])[0]
                        before=(previous or {}).get('arrival_stop',{})
                        after=current.get('departure_stop',{})
                        origin=coord(w.get('origin') or before.get('location'))
                        destination=coord(w.get('destination') or after.get('location'))
                        legs.append({'mode':'walking','label':'站内换乘','from':before.get('name','换乘站')+' · '+(previous or {}).get('name','').split('(')[0],'to':after.get('name','换乘站')+' · '+current.get('name','').split('(')[0],'origin':origin,'destination':destination,'duration':duration,'distance':float(w.get('distance') or 0),'paths':[coordinates(step.get('polyline')) for step in w.get('steps',[])],'instructions':[step.get('instruction','') for step in w.get('steps',[])],'source':'amap','kind':'transfer'})
            group=segment.get('bus',{}).get('buslines')
            if group:
                line=group[0];departure=line['departure_stop'];arrival=line['arrival_stop']
                legs.append({'mode':'metro','label':line.get('name','地铁').split('(')[0],'from':departure.get('name','')+'站','to':arrival.get('name','')+'站','origin':coord(departure['location']),'destination':coord(arrival['location']),'duration':float(line.get('cost',{}).get('duration') or line.get('duration')),'distance':float(line.get('distance') or 0),'paths':[coordinates(line.get('polyline'))],'instructions':[line.get('name','')+'：'+departure.get('name','')+' → '+arrival.get('name','')],'source':'amap'})
                previous=line
        if not valid:continue
        last=lines[-1].get('arrival_stop',{})
        result.append({'railDuration':sum(times),'transferDuration':transfers,'fixedDuration':sum(times)+transfers,'journeyLegs':legs,'rawDuration':float(t.get('cost',{}).get('duration') or t.get('duration') or 0),'arrivalName':last.get('name',''),'exit':last.get('exit') or {},'arrivalLocation':coord(last['location']),'lines':[l.get('name','') for l in lines]})
    return result
def full_params(station,office):
    return {'origin':','.join(map(str,station['location'])),'destination':','.join(map(str,office['entrance'])),'city1':'0755','city2':'0755','strategy':8,'AlternativeRoute':10,'date':'2026-11-09','time':'09-00','show_fields':'cost,polyline,navi'}
def station_params(a,b):
    return {'origin':','.join(map(str,a['location'])),'destination':','.join(map(str,b['location'])),'originpoi':a['id'],'destinationpoi':b['id'],'city1':'0755','city2':'0755','strategy':6,'date':'2026-11-09','time':'09-00','show_fields':'cost,polyline,navi'}
def full_query(station,office):
    return request('v5/direction/transit/integrated',full_params(station,office))
def station_query(a,b):
    return request('v5/direction/transit/integrated',station_params(a,b))

if __name__=='__main__':
    offices=json.loads((ROOT/'public/data/offices.json').read_text())
    stations=json.loads((ROOT/'public/data/stations.json').read_text())['stations']
    by_name={s['name']:s for s in stations}
    output=ROOT/'public/data/metro-plans.json'
    old=json.loads(output.read_text()) if output.exists() else {}
    if old.get('methodVersion')!=VERSION:old={}
    result={'methodVersion':VERSION,'generatedAt':stamp(),'departureDate':'2026-11-09','departureTime':'09:00','source':'高德公共交通地铁路段字段＋地面步行/普通自行车路线','complete':False,'stationCount':len(stations),'processedStations':old.get('processedStations',[]),'plans':old.get('plans',{o['id']:{} for o in offices}),'entries':old.get('entries',{}),'errors':old.get('errors',[]),'clockNote':'按用户指定口径：计入地面接驳、地铁路段与站内换乘；首次进站和最终出站的站内步行不额外叠加，不另加候车。路段字段并非独立列车时刻表；高德原始总时长另列，不承诺公司审批。','coverageNote':'覆盖图结合校准OSM路网估算；地铁候选采用高德返回的最多10条方案，并补查明确公司侧候选站。未穷举所有地图平台或任意换乘组合。'}
    atomic_json(output,result)
    completed=set(result['processedStations'])
    stations.sort(key=lambda s:min(meters(s['location'],o['entrance']) for o in offices))
    extra_targets={'innovation':['粤海门','科苑','高新南','深大南'],'prince':['海上世界','水湾','花果山'],'jinghu':['人才公园','登良','后海','南油']}
    # Additional endpoints are queried for stations on the endpoint's lines. This
    # preserves direct routes which full-journey ranking can suppress due to station walking.
    for index,s in enumerate(stations):
        if s['id'] in completed:continue
        try:
            es=result['entries'].get(s['id']) or entrance_list(s)
            result['entries'][s['id']]=es
            with ThreadPoolExecutor(max_workers=3) as pool:
                references=list(pool.map(lambda office:full_query(s,office),offices))
            for office,reference in zip(offices,references):
                options=metro_options(reference,s)
                names={p['arrivalName'] for p in options}
                for target_name in extra_targets[office['id']]:
                    t=by_name.get(target_name)
                    if not t or t['id']==s['id'] or target_name in names:continue
                    if not set(s['lines']).intersection(t['lines']):continue
                    added=metro_options(station_query(s,t),s)
                    for p in added:p['rawDuration']=None
                    options+=added
                best=None
                for option in options:
                    if sum_leg_seconds(option['journeyLegs'])>1200:continue
                    arrival=by_name.get(option['arrivalName'])
                    gates=[]
                    if option['exit'].get('location'):
                        gates=[{'name':option['arrivalName']+option['exit'].get('name',''),'location':coord(option['exit']['location'])}]
                    elif arrival:
                        end_gates=result['entries'].get(arrival['id'])
                        if not end_gates:
                            end_gates=entrance_list(arrival);result['entries'][arrival['id']]=end_gates
                        gates=end_gates
                    if not gates:continue
                    for gate in gates:
                        for mode in ['walking','bicycling']:
                            # A generously fast surface bound only skips geometrically impossible chains.
                            if sum_leg_seconds(option['journeyLegs'])+round_seconds(meters(gate['location'],office['entrance'])/12)>1200:continue
                            tail=route(mode,gate['location'],office['entrance'])
                            if not tail:continue
                            duration=option['fixedDuration']+tail['duration']
                            if best is not None and sum_leg_seconds(option['journeyLegs'])+round_seconds(tail['duration'])>=plan_seconds(best):continue
                            journey=[{**leg} for leg in option['journeyLegs']]
                            tail_leg=surface(tail,mode,gate['location'],office['entrance'],gate['name'],office['name'])
                            best={'id':s['id']+'-'+office['id'],'stationId':s['id'],'stationName':s['name'],'officeId':office['id'],'duration':duration,'legs':journey+[tail_leg],'lines':option['lines'],'measuredAt':stamp(),'source':'amap','originalTotalDuration':option['rawDuration'],'clock':VERSION}
                if best:result['plans'][office['id']][s['id']]=best
            result['processedStations'].append(s['id']);result['generatedAt']=stamp();atomic_json(output,result)
            if index%5==0 or s['name']=='粤海门':
                print(json.dumps({'station':s['name'],'processed':len(result['processedStations']),'total':len(stations),'positiveBudgetStations':{o['id']:sum(plan_seconds(p)<=1200 for p in result['plans'][o['id']].values()) for o in offices}},ensure_ascii=False),flush=True)
        except RuntimeError as error:
            result['errors'].append({'station':s['name'],'error':str(error),'at':stamp()});atomic_json(output,result);print(str(error),flush=True);raise
    result['complete']=True;result['generatedAt']=stamp();atomic_json(output,result)
    print('All station reference plans prepared.',flush=True)
