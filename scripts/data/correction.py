"""Spatial correction for fixed office bicycle fields, never used as address proof."""
import json
import numpy as np
from scipy.spatial import cKDTree
from amap import ROOT,WORK

class BicycleCorrection:
    def __init__(self, rows=None, access_ratio=None):
        path=WORK/'bicycle-calibration.json'
        self.rows=rows if rows is not None else (json.loads(path.read_text()) if path.exists() else [])
        self.groups={}
        for office in {r['officeId'] for r in self.rows}:
            rows=[r for r in self.rows if r['officeId']==office]
            xy=np.array([r['projected'] for r in rows]);ratio=np.clip([r['amapSeconds']/max(r['modelSeconds'],60) for r in rows],.4,3)
            self.groups[office]=(cKDTree(xy),ratio)
        # Ground access needs a correction independent of the destination office.
        # Median time ratio is robust to isolated missing or forbidden OSM links.
        self.accessRatio=float(np.median([r['amapSeconds']/r['modelSeconds'] for r in self.rows if r['modelSeconds']>30])) if self.rows else 1
        # Retargeting one office must not silently reweight the shared street
        # graph or change other offices. Its exported ratio remains authoritative.
        metadata=ROOT/'public/data/calibration.json'
        if access_ratio is None and metadata.exists():
            access_ratio=json.loads(metadata.read_text()).get('bicycleAccessTimeRatio')
        if access_ratio is not None:
            self.accessRatio=float(access_ratio)
    def direct(self,office,points,times):
        if office not in self.groups:return times
        tree,ratios=self.groups[office];dist,idx=tree.query(points,k=min(8,len(ratios)))
        if dist.ndim==1:dist=dist[:,None];idx=idx[:,None]
        weight=1/np.maximum(dist,100)**2
        local=(weight*ratios[idx]).sum(axis=1)/weight.sum(axis=1)
        return times*local
