import json
import numpy as np
from pyproj import Transformer
from scipy.sparse import load_npz, csr_matrix, bmat
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from amap import WORK
from geo import gcj_to_wgs

class Network:
    def __init__(self):
        nodes=np.load(WORK/'network/nodes.npz')
        self.xy=nodes['projected'];self.wgs=nodes['wgs84']
        self.project=Transformer.from_crs(4326,32649,always_xy=True)
        self.inverse=Transformer.from_crs(32649,4326,always_xy=True)
        self.graphs={};self.trees={};self.ids={}
        for mode in ['walking','bicycling']:
            graph=load_npz(WORK/'network'/f'{mode}.npz')
            active=np.flatnonzero((np.diff(graph.indptr)>0)|(np.diff(graph.T.tocsr().indptr)>0))
            self.graphs[mode]=graph;self.ids[mode]=active;self.trees[mode]=cKDTree(self.xy[active])
    def point(self,gcj):return np.array(self.project.transform(*gcj_to_wgs(*gcj)))
    def snaps(self,gcj,mode,k=4):
        dist,idx=self.trees[mode].query(self.point(gcj),k=k)
        return np.atleast_1d(dist),self.ids[mode][np.atleast_1d(idx)]
    def field(self,targets,mode,limit=7200,edge_scale=1,to_home=False):
        speed=1.25 if mode=='walking' else 10.755532740416204/3.6
        roads=self.graphs[mode]
        graph=((roads if to_home else roads.T)*edge_scale).tocsr();n=graph.shape[0]
        seeds={}
        for location,initial in targets:
            distances,ids=self.snaps(location,mode)
            for distance,idx in zip(distances,ids):
                if distance>150:continue
                cost=initial+distance/speed*edge_scale
                if cost<seeds.get(int(idx),float('inf')):seeds[int(idx)]=cost
        if not seeds:return np.full(n,np.inf)
        row=csr_matrix((list(seeds.values()),([0]*len(seeds),list(seeds))),shape=(1,n))
        matrix=bmat([[graph,csr_matrix((n,1))],[row,csr_matrix((1,1))]],format='csr')
        return dijkstra(matrix,directed=True,indices=n,limit=limit)[:n]
    def time_at(self,point,field,mode):
        speed=1.25 if mode=='walking' else 10.755532740416204/3.6
        distances,ids=self.snaps(point,mode)
        times=field[ids]+distances/speed
        times[distances>150]=np.inf
        return float(times.min()),float(distances.min())
