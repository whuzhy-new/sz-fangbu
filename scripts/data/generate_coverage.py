"""Precompute 50m raster isochrones; WebApp only downloads completed geometry."""
import json,datetime,math
import numpy as np
from shapely.geometry import box,mapping
from shapely.ops import unary_union,transform
from amap import ROOT,WORK,atomic_json
from network import Network
from geo import wgs_to_gcj
from correction import BicycleCorrection

RES=50
def mask_geometry(mask,xs,ys):
    strips=[]
    for row,y in zip(mask,ys):
        edges=np.diff(np.r_[False,row,False].astype(int));starts=np.flatnonzero(edges==1);ends=np.flatnonzero(edges==-1)
        strips.extend(box(xs[a]-RES/2,y-RES/2,xs[b-1]+RES/2,y+RES/2) for a,b in zip(starts,ends))
    return unary_union(strips).simplify(18,preserve_topology=True) if strips else None
def export_index(rail):
    stations=json.loads((ROOT/'public/data/stations.json').read_text())['stations']
    by_name={s['name']:s for s in stations}
    for plans in rail['plans'].values():
        for p in plans.values():
            for leg in p['legs']:
                if leg['mode']!='metro':continue
                pair=leg.get('instructions',[''])[0].split('：')[-1].split(' → ')
                if len(pair)!=2:continue
                for name,key,label in [(pair[0],'origin','from'),(pair[1],'destination','to')]:
                    if name in by_name:leg[key]=by_name[name]['location'];leg[label]=name+'站'
    atomic_json(ROOT/'public/data/metro-plans.json',rail)
    skinny={**rail,'plans':{}}
    for office,plans in rail['plans'].items():
        skinny['plans'][office]={sid:{**p,'legs':[{**leg,'paths':[]} for leg in p['legs']]} for sid,p in plans.items()}
    atomic_json(ROOT/'data/metro-index.json',skinny)

if __name__=='__main__':
    rail=json.loads((ROOT/'public/data/metro-plans.json').read_text())
    if not rail['complete']:raise RuntimeError('Rail preparation is not complete; refusing to publish a partial map.')
    offices=json.loads((ROOT/'public/data/offices.json').read_text());net=Network();correction=BicycleCorrection()
    features=[]
    for office in offices:
        oid=office['id'];fields={}
        for mode,limit in [('walking',1800),('bicycling',1200)]:
            fields[mode]=net.field([(office['entrance'],0)],mode,limit=3600)
        targets=[]
        for sid,p in rail['plans'][oid].items():
            if p['duration']>=1200:continue
            for entry in rail['entries'].get(sid,[]):
                if entry['source']=='amap':targets.append((entry['location'],p['duration']))
        for mode in ['walking','bicycling']:
            # Scale bicycle access graph costs only; fixed rail+office costs are actual AMap values.
            fields['metro-'+mode]=net.field(targets,mode,limit=1200,edge_scale=correction.accessRatio if mode=='bicycling' else 1)
        possible=np.zeros(len(net.xy),dtype=bool)
        for key,field in fields.items():possible|=field<= (2300 if key=='walking' else 2000 if key=='bicycling' else 1200)
        pts=net.xy[possible]
        lo=np.floor((pts.min(axis=0)-150)/RES)*RES;hi=np.ceil((pts.max(axis=0)+150)/RES)*RES
        xs=np.arange(lo[0],hi[0]+RES,RES);ys=np.arange(lo[1],hi[1]+RES,RES)
        xx,yy=np.meshgrid(xs,ys);grid=np.column_stack([xx.ravel(),yy.ravel()]);values={}
        for mode in ['walking','bicycling']:
            distances,idx=net.trees[mode].query(grid,k=4);ids=net.ids[mode][idx]
            speed=1.25 if mode=='walking' else 10.755532740416204/3.6
            snap=distances/speed;snap[distances>150]=np.inf
            direct=(fields[mode][ids]+snap).min(axis=1)
            values[mode]=correction.direct(oid,grid,direct) if mode=='bicycling' else direct
            values['metro-'+mode]=(fields['metro-'+mode][ids]+snap*(correction.accessRatio if mode=='bicycling' else 1)).min(axis=1)
        values['metro']=np.minimum(values.pop('metro-walking'),values.pop('metro-bicycling'))
        for mode,limit in [('walking',1800),('bicycling',1200),('metro',1200)]:
            mask=(values[mode]<=limit).reshape(len(ys),len(xs));geometry=mask_geometry(mask,xs,ys)
            if geometry is None:continue
            area=round(geometry.area/1e6,3)
            def to_gcj(x,y,z=None):
                lon,lat=net.inverse.transform(x,y)
                if np.isscalar(lon):return wgs_to_gcj(lon,lat)
                p=[wgs_to_gcj(a,b) for a,b in zip(lon,lat)];return [v[0] for v in p],[v[1] for v in p]
            geo=mapping(transform(to_gcj,geometry))
            def rounded(v):return [rounded(i) for i in v] if isinstance(v,(list,tuple)) else round(v,6)
            geo['coordinates']=rounded(geo['coordinates'])
            features.append({'type':'Feature','properties':{'officeId':oid,'mode':mode,'areaKm2':area},'geometry':geo})
            print(json.dumps({'office':oid,'mode':mode,'areaKm2':area,'cells':int(mask.sum())}),flush=True)
    atomic_json(ROOT/'public/data/coverage.json',{'type':'FeatureCollection','features':features,'metadata':{'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resolutionMeters':RES,'complete':True,'processedStations':len(rail['processedStations']),'stationCount':rail['stationCount'],'bicycleCalibrationSamples':len(correction.rows),'bicycleAccessTimeRatio':correction.accessRatio,'osmDate':'2026-11-07','coordinateSystem':'GCJ02','note':'高德地铁固定段与工区接驳＋校准OSM路网。50米栅格估算，边界及小区入口须高德单点复核；未穷举任意换乘及其他地图平台。'}})
    export_index(rail)
