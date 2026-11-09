"""Build fixed rail legs exclusively from explicit AMap station-to-station requests.

Full-journey responses only discover candidates. Their rail legs never become proofs.
Every retained station-pair response must start and finish at the requested stations.
"""
import json,datetime,sys
from concurrent.futures import ThreadPoolExecutor,as_completed
from amap import ROOT,WORK,atomic_json,route
from prepare_rail_plans import full_query,station_query,metro_options,surface,meters
from duration_policy import round_seconds,sum_leg_seconds,plan_seconds

VERSION='amap-station-pair-v3'
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def exact_station_options(data,origin,destination):
    return [p for p in metro_options(data,origin) if p['journeyLegs'][0]['from']==origin['name']+'站' and p['journeyLegs'][-1]['to']==destination['name']+'站']

if __name__=='__main__':
    offices=json.loads((ROOT/'public/data/offices.json').read_text())
    stations=json.loads((ROOT/'public/data/stations.json').read_text())['stations'];by_id={s['id']:s for s in stations};by_name={s['name']:s for s in stations}
    previous=json.loads((ROOT/'public/data/metro-plans.json').read_text())
    entries=previous['entries'];candidate_file=WORK/'metro-api-candidates.json'
    if not candidate_file.exists():
        candidates={}
        for office in offices:
            candidates[office['id']]=[s['id'] for s in stations if meters(s['location'],office['entrance'])<3500 or any(sum_leg_seconds(p['journeyLegs'])<=1200 for p in metro_options(full_query(s,office),s))]
        atomic_json(candidate_file,candidates)
    candidates=json.loads(candidate_file.read_text())
    recheck='--recheck-cached' in sys.argv
    targets={'innovation':['粤海门','科苑','高新南','深大南'],'prince':['海上世界','水湾','花果山'],'jinghu':['人才公园','登良','后海','南油']}
    checkpoint=WORK/'station-api-progress.json'
    result=json.loads(checkpoint.read_text()) if checkpoint.exists() else {'methodVersion':VERSION,'generatedAt':stamp(),'departureDate':'2026-11-09','departureTime':'09:00','complete':False,'stationCount':len(stations),'processedStations':[],'plans':{o['id']:{} for o in offices},'entries':entries,'completedPairs':[],'errors':[],'source':'高德明确站点到站点地铁API＋地面路线API','clockNote':'地铁路段＋换乘步行＋两端地面接驳；不另加首末站站内步行或候车。','coverageNote':'全线网候选筛查后，明确指定首末站查询；返回首末站不一致的结果被拒绝。范围仍为校准路网估算，未穷举任意换乘或其他地图平台。'}
    if result['methodVersion']!=VERSION:raise RuntimeError('Incompatible checkpoint')
    atomic_json(ROOT/'public/data/metro-plans.json',result)
    done=set(result['completedPairs']);tails={};tasks=[]
    for office in offices:
        oid=office['id']
        for sid in candidates[oid]:
            s=by_id[sid];names=set(targets[oid])
            # Candidate discovery only; the actual rail proof below always makes a station-pair request.
            for option in metro_options(full_query(s,office),s):
                if sum_leg_seconds(option['journeyLegs'])<=1200 and option['arrivalName'] in by_name:names.add(option['arrivalName'])
            for name in names:
                target=by_name[name]
                if target['id']==sid:continue
                key=(oid,target['id'])
                if key not in tails:
                    best=None
                    for gate in entries.get(target['id'],[]):
                        if gate.get('source')!='amap':continue
                        for mode in ['walking','bicycling']:
                            leg=route(mode,gate['location'],office['entrance'])
                            if leg and (best is None or leg['duration']<best['duration']):best=surface(leg,mode,gate['location'],office['entrance'],gate['name'],office['name'])
                    tails[key]=best
                if not tails[key] or round_seconds(tails[key]['duration'])>1200:continue
                token=f'{oid}:{sid}:{target["id"]}'
                if token not in done or recheck:tasks.append((token,s,target,office,tails[key]))
    print(json.dumps({'stationPairTasks':len(tasks),'cachedCompletedPairs':len(done),'companyTailTargets':len(tails)}),flush=True)
    def calculate(task):
        token,s,t,office,tail=task
        options=exact_station_options(station_query(s,t),s,t)
        if not options:return token,None
        option=min(options,key=lambda p:sum_leg_seconds(p['journeyLegs']));duration=option['fixedDuration']+tail['duration']
        if sum_leg_seconds(option['journeyLegs']+[tail])>1200:return token,None
        plan={'id':s['id']+'-'+office['id'],'stationId':s['id'],'stationName':s['name'],'officeId':office['id'],'duration':duration,'legs':option['journeyLegs']+[tail],'lines':option['lines'],'measuredAt':stamp(),'source':'amap','originalTotalDuration':option['rawDuration'],'originalReferenceScope':'stations','clock':VERSION,'metroApi':{'originPoiId':s['id'],'destinationPoiId':t['id'],'originName':s['name'],'destinationName':t['name'],'strategy':6}}
        assert abs(sum(l['duration'] for l in plan['legs'])-duration)<.001
        return token,plan
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending={pool.submit(calculate,t):t for t in tasks}
        for i,future in enumerate(as_completed(pending)):
            token,plan=future.result()
            if token not in done:result['completedPairs'].append(token);done.add(token)
            if plan:
                old=result['plans'][plan['officeId']].get(plan['stationId'])
                if old is None or plan_seconds(plan)<plan_seconds(old):result['plans'][plan['officeId']][plan['stationId']]=plan
            if i%20==0:
                result['generatedAt']=stamp();atomic_json(checkpoint,result)
                print(json.dumps({'completedPairs':len(result['completedPairs']),'bestBoardingStations':{k:len(v) for k,v in result['plans'].items()}}),flush=True)
    result['complete']=True;result['processedStations']=[s['id'] for s in stations];result['generatedAt']=stamp()
    atomic_json(checkpoint,result);atomic_json(ROOT/'public/data/metro-plans.json',result)
    print('Explicit station-pair preparation complete.',flush=True)
