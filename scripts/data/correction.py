"""Spatial correction for fixed office bicycle fields, never used as address proof."""
import json
import numpy as np
from scipy.spatial import cKDTree
from amap import WORK

class BicycleCorrection:
    def __init__(self):
        path=WORK/'bicycle-calibration.json'
        self.rows=json.loads(path.read_text()) if path.exists() else []
        self.groups={}
        for office in {r['officeId'] for r in self.rows}:
            rows=[r for r in self.rows if r['officeId']==office]
            xy=np.array([r['projected'] for r in rows]);ratio=np.clip([r['amapSeconds']/max(r['modelSeconds'],60) for r in rows],.4,3)
            self.groups[office]=(cKDTree(xy),ratio)
        # Ground access needs a correction independent of the destination office.
        # Median time ratio is robust to isolated missing or forbidden OSM links.
        self.accessRatio=float(np.median([r['amapSeconds']/r['modelSeconds'] for r in self.rows if r['modelSeconds']>30])) if self.rows else 1
    def direct(self,office,points,times):
        if office not in self.groups:return times
        tree,ratios=self.groups[office];dist,idx=tree.query(points,k=min(8,len(ratios)))
        if dist.ndim==1:dist=dist[:,None];idx=idx[:,None]
        weight=1/np.maximum(dist,100)**2
        local=(weight*ratios[idx]).sum(axis=1)/weight.sum(axis=1)
        return times*local
