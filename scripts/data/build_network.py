"""Extract walk/bike directed networks. Run locally, never in the WebApp."""
import json, pathlib, time
import numpy as np
import osmium
from pyproj import Transformer
from scipy.sparse import coo_matrix, save_npz
from amap import ROOT, WORK, atomic_json

BBOX=(113.75,22.42,114.40,22.83)

class Nodes(osmium.SimpleHandler):
    def __init__(self):
        super().__init__();self.coords={};self.entrances=[]
    def node(self,n):
        x,y=n.location.lon,n.location.lat
        if BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3]:
            self.coords[n.id]=(x,y)
            if n.tags.get('railway')=='subway_entrance':
                self.entrances.append({'osmId':n.id,'name':n.tags.get('name',''),'ref':n.tags.get('ref',''),'location':[x,y]})

class Ways(osmium.SimpleHandler):
    def __init__(self,coords):
        super().__init__();self.coords=coords;self.nodes={};self.edges=[];self.types={}
    def way(self,w):
        h=w.tags.get('highway')
        if not h or h in {'motorway','motorway_link','construction','proposed','raceway'}:return
        if w.tags.get('access') in {'no','private'}:return
        tags=dict(w.tags)
        walk=tags.get('foot')!='no'
        bike=tags.get('bicycle') not in {'no','use_sidepath'}
        if h in {'trunk','trunk_link'}:
            walk=walk and (tags.get('foot') in {'yes','designated','permissive'} or tags.get('sidewalk') in {'yes','both','left','right'})
            bike=bike and tags.get('bicycle') in {'yes','designated','permissive'}
        if h in {'steps','pedestrian','footway'} and tags.get('bicycle') not in {'yes','designated','permissive'}:bike=False
        if not(walk or bike):return
        direction=-1 if tags.get('oneway')=='-1' else 1 if tags.get('oneway') in {'yes','1','true'} or tags.get('junction')=='roundabout' else 0
        if tags.get('oneway:bicycle')=='no':direction=0
        refs=[n.ref for n in w.nodes]
        for a,b in zip(refs,refs[1:]):
            if a not in self.coords or b not in self.coords:continue
            ia=self.nodes.setdefault(a,len(self.nodes));ib=self.nodes.setdefault(b,len(self.nodes))
            if ia==ib:continue
            self.edges.append((ia,ib,walk,bike,direction,h=='steps'))
        self.types[h]=self.types.get(h,0)+1

if __name__=='__main__':
    if (WORK/'network/nodes.npz').exists():
        print('Existing network is ready. Remove work/network to rebuild.',flush=True);raise SystemExit
    start=time.monotonic();path=WORK/'guangdong.osm.pbf'
    ns=Nodes();ns.apply_file(str(path))
    print('Bounding-box nodes:',len(ns.coords),'subway entrances:',len(ns.entrances),'elapsed:',round(time.monotonic()-start),flush=True)
    ws=Ways(ns.coords);ws.apply_file(str(path))
    print('Graph nodes:',len(ws.nodes),'segments:',len(ws.edges),'elapsed:',round(time.monotonic()-start),flush=True)
    xy=np.array([ns.coords[n] for n in ws.nodes],dtype=np.float64)
    projector=Transformer.from_crs('EPSG:4326','EPSG:32649',always_xy=True)
    px,py=projector.transform(xy[:,0],xy[:,1]);projected=np.stack([px,py],axis=1)
    size=len(xy);target=WORK/'network';target.mkdir(exist_ok=True)
    np.savez_compressed(target/'nodes.npz',wgs84=xy,projected=projected)
    for mode,speed in [('walking',1.25),('bicycling',10.755532740416204/3.6)]:
        # Keep the minimum weight for parallel edges; summing them would corrupt routes.
        edges={}
        for a,b,walk,bike,direction,steps in ws.edges:
            if not(walk if mode=='walking' else bike):continue
            length=float(np.linalg.norm(projected[a]-projected[b]))
            duration=length/(1.25 if steps else speed)
            directions=[(a,b),(b,a)] if mode=='walking' or direction==0 else [(a,b)] if direction==1 else [(b,a)]
            for u,v in directions:
                if duration<edges.get((u,v),float('inf')):edges[u,v]=duration
        rows=[a for a,b in edges];cols=[b for a,b in edges]
        matrix=coo_matrix((list(edges.values()),(rows,cols)),shape=(size,size)).tocsr()
        save_npz(target/(mode+'.npz'),matrix)
        print(mode,'directed edges:',matrix.nnz,flush=True)
    atomic_json(target/'entrances.json',ns.entrances)
    atomic_json(target/'metadata.json',{'bboxWgs84':BBOX,'nodeCount':size,'segmentCount':len(ws.edges),'osmDate':'2026-11-07','source':'https://download.geofabrik.de/asia/china/guangdong.html','roadTypes':ws.types,'walkingSpeedKmh':4.5,'bicyclingSpeedKmh':10.755532740416204})
    print('Network ready in',round(time.monotonic()-start),'seconds',flush=True)
