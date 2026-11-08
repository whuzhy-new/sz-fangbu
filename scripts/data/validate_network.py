"""Independent named-address validation, not reuse of speed-fitting samples."""
import json,sys,datetime,math
import numpy as np
from amap import ROOT,WORK,request,route,atomic_json
from network import Network
from correction import BicycleCorrection

names=['蔚蓝海岸','桂庙新村','南油生活区','南水村','招商海月花园','大冲新城花园','新德家园','后海花园']
offices=json.loads((ROOT/'public/data/offices.json').read_text())
net=Network();correction=BicycleCorrection();fields={}
for o in offices:
    for mode in ['walking','bicycling']:
        fields[o['id'],mode]=net.field([(o['entrance'],0)],mode,limit=18000)
rows=[]
for name in names:
    res=request('v3/place/text',{'keywords':name,'types':'120000','city':'440300','citylimit':'true','offset':5,'extensions':'all'},'search')
    pois=[p for p in res.get('pois',[]) if p.get('adname')=='南山区']
    if not pois:continue
    poi=next((p for p in pois if p['name']==name),pois[0]);location=poi.get('entr_location')
    if not isinstance(location,str) or ',' not in location:location=poi['location']
    location=[float(v) for v in location.split(',')]
    office=min(offices,key=lambda o:np.linalg.norm(net.point(o['entrance'])-net.point(location)))
    for mode in ['walking','bicycling']:
        official=route(mode,location,office['entrance'])
        if not official:continue
        predicted,snap=net.time_at(location,fields[office['id'],mode],mode)
        if mode=='bicycling':predicted=float(correction.direct(office['id'],np.array([net.point(location)]),np.array([predicted]))[0])
        row={'name':poi['name'],'origin':location,'officeId':office['id'],'mode':mode,'amapDistanceM':official['distance'],'amapDurationSeconds':official['duration'],'modelDurationSeconds':round(predicted,1) if math.isfinite(predicted) else None,'errorSeconds':round(predicted-official['duration'],1) if math.isfinite(predicted) else None,'snapDistanceM':round(snap,1)}
        rows.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
        atomic_json(WORK/'network-validation.json',rows)
summary={}
for mode in ['walking','bicycling']:
    subset=[r for r in rows if r['mode']==mode and r['errorSeconds'] is not None]
    errs=[abs(r['errorSeconds']) for r in subset]
    summary[mode]={'sampleCount':len(subset),'meanAbsoluteErrorSeconds':round(float(np.mean(errs)),1) if errs else None,'maxAbsoluteErrorSeconds':max(errs) if errs else None,'p90AbsoluteErrorSeconds':round(float(np.percentile(errs,90)),1) if errs else None,'unreachableSamples':sum(r['modelDurationSeconds'] is None for r in rows if r['mode']==mode)}
atomic_json(ROOT/'public/data/validation.json',{'measuredAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sampleDesign':'8个小区地点，每个地点到最近工区，步行与普通自行车各一次；未用于速度及空间校准。','speedCalibration':{'walkingKmh':4.5,'bicyclingKmh':10.755532740416204,'samplePairs':6,'spatialCalibrationPairs':len(correction.rows)},'summary':summary,'samples':rows,'note':'小样本误差统计不构成所有地点的误差上限。临界地点以高德具体路线核验。'})
print('Validation summary:',json.dumps(summary,ensure_ascii=False),flush=True)
