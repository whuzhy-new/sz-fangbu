"""Precompute 50m raster isochrones; WebApp only downloads completed geometry."""
import json,datetime,math
import numpy as np
from shapely.geometry import box,mapping,shape
from shapely.ops import unary_union,transform
from pyproj import Geod
from amap import ROOT,WORK,atomic_json
from network import Network
from geo import wgs_to_gcj
from correction import BicycleCorrection
from duration_policy import plan_seconds,ROUNDING_VERSION
from coverage_geometry import complete_small_holes,apply_verified_communities,polygon_parts

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
            rail_legs=[l for l in p['legs'] if l['mode']=='metro']
            expected=p.get('metroApi',{})
            if not rail_legs or expected.get('originName')!=p['stationName'] or rail_legs[0]['from']!=p['stationName']+'站' or rail_legs[-1]['to']!=expected.get('destinationName','')+'站':raise RuntimeError('Disconnected station-pair proof rejected')
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
    if not rail['complete'] or rail.get('methodVersion')!='amap-station-pair-v3':raise RuntimeError('Verified station-pair preparation is not complete; refusing to generate an invalid map.')
    offices=json.loads((ROOT/'public/data/offices.json').read_text());net=Network();correction=BicycleCorrection()
    corrections=json.loads((ROOT/'public/data/coverage-corrections.json').read_text())['features']
    for feature in corrections:
        props=feature['properties']
        if props.get('departureDate')!=rail['departureDate'] or props.get('departureTime')!=rail['departureTime']:raise RuntimeError('Community proof date does not match the metro snapshot')
        def to_projected(x,y,z=None):
            if np.isscalar(x):return net.point([x,y])
            points=[net.point([a,b]) for a,b in zip(x,y)];return [p[0] for p in points],[p[1] for p in points]
        feature['geometry']=transform(to_projected,shape(feature['geometry']))
    features=[];completion={};community_stats={}
    for office in offices:
        oid=office['id'];fields={}
        for mode,limit in [('walking',1800),('bicycling',1200)]:
            fields[mode]=net.field([(office['entrance'],0)],mode,limit=3600)
        targets=[]
        for sid,p in rail['plans'][oid].items():
            fixed_duration=plan_seconds(p)
            # Residential access is a separate leg and costs at least one minute.
            if fixed_duration+60>1200:continue
            for entry in rail['entries'].get(sid,[]):
                if entry['source']=='amap':targets.append((entry['location'],fixed_duration))
        for mode in ['walking','bicycling']:
            # Scale bicycle access graph costs only; fixed rail+office costs are actual AMap values.
            fields['metro-'+mode]=net.field(targets,mode,limit=1230,edge_scale=correction.accessRatio if mode=='bicycling' else 1)
        possible=np.zeros(len(net.xy),dtype=bool)
        for key,field in fields.items():possible|=field<= (2300 if key=='walking' else 2000 if key=='bicycling' else 1230)
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
        geometries={}
        for mode,limit in [('walking',1800),('bicycling',1200),('metro',1200)]:
            # Fixed seeds are whole minutes, so rounding the combined field is
            # gives the same eligibility mask as fixed minutes + rounded access:
            # seeds leave at least one minute for access. Use half-up, not
            # numpy/Python's banker's rounding at exactly 30 seconds.
            mask=(np.maximum(60,np.floor(values[mode]/60+.5)*60)<=limit).reshape(len(ys),len(xs));geometry=mask_geometry(mask,xs,ys)
            if geometry is not None:geometries[mode]=geometry
        geometries,community_stats[oid]=apply_verified_communities(geometries,[f for f in corrections if f['properties']['officeId']==oid])
        geometries,completion[oid]=complete_small_holes(geometries)
        for mode,geometry in geometries.items():
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
            print(json.dumps({'office':oid,'mode':mode,'areaKm2':area}),flush=True)
    # Coordinate rounding can create tiny interior slivers. Complete them using
    # geodesic square metres after export, rather than treating degrees as metres.
    geod=Geod(ellps='WGS84');cleanup={}
    def gcj_area(g):return sum(abs(geod.geometry_area_perimeter(p)[0]) for p in polygon_parts(g))
    for office in offices:
        group=[f for f in features if f['properties']['officeId']==office['id']]
        layers={f['properties']['mode']:shape(f['geometry']) for f in group}
        completed,cleanup[office['id']]=complete_small_holes(layers,area_measure=gcj_area)
        for f in group:
            geometry=completed[f['properties']['mode']]
            assert geometry.is_valid
            f['geometry']=mapping(geometry)
    atomic_json(ROOT/'public/data/coverage.json',{'type':'FeatureCollection','features':features,'metadata':{'methodVersion':rail['methodVersion'],'durationRounding':ROUNDING_VERSION,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resolutionMeters':RES,'complete':True,'processedStations':len(rail['processedStations']),'stationCount':rail['stationCount'],'bicycleCalibrationSamples':len(correction.rows),'bicycleAccessTimeRatio':correction.accessRatio,'osmDate':'2026-11-07','coordinateSystem':'GCJ02','smallHoleCompletion':{'maxAreaM2':10000,'offices':completion,'exportedCleanup':cleanup},'verifiedCommunityCorrections':community_stats,'note':'高德固定地铁段＋校准OSM路网，50米栅格估算。时长按分钟取整，每段先取整再相加。1万平方米以内内部小洞补全，住宅空白按小区门口核验；具体位置仍须单独核验。'}})
    export_index(rail)
