"""Package the existing directed OSM graphs for exact-coordinate local searches.

No API calls. Node ordering provides a compact spatial index for 150 m snaps.
"""
import gzip
import json
import time
import numpy as np
from amap import ROOT, WORK, atomic_json
from network import Network
from correction import BicycleCorrection

def build():
    start=time.monotonic();net=Network();correction=BicycleCorrection()
    root=ROOT/'public/data/road-network';root.mkdir(exist_ok=True)
    cell_size=100
    lower=np.floor(net.xy.min(axis=0)/cell_size)*cell_size
    cells=np.floor((net.xy-lower)/cell_size).astype(np.int32)
    columns,rows=(cells.max(axis=0)+1).tolist()
    cell_ids=cells[:,1]*columns+cells[:,0]
    order=np.argsort(cell_ids,kind='stable');reverse=np.empty(len(order),dtype=np.int32);reverse[order]=np.arange(len(order))
    flags=np.zeros(len(order),dtype=np.uint8)
    for bit,mode in enumerate(['walking','bicycling']):flags[reverse[net.ids[mode]]]|=1<<bit
    pointer=np.r_[0,np.cumsum(np.bincount(cell_ids,minlength=columns*rows))].astype('<u4')
    metadata={'version':'directed-road-network-v1','nodeCount':len(order),'cellSize':cell_size,
              'columns':columns,'rows':rows,'offset':lower.tolist(),'bicycleAccessRatio':correction.accessRatio,
              'walkingSpeed':1.25,'bicyclingSpeed':10.755532740416204/3.6,'maxSnapMeters':150,
              'osmDate':json.loads((WORK/'network/metadata.json').read_text())['osmDate'],'files':{}}
    def write(name,arrays):
        chunks=[];description={};offset=0
        for key,array in arrays:
            padding=(-offset)%4
            chunks.append(b'\0'*padding);offset+=padding
            description[key]={'offset':offset,'length':array.size,'type':array.dtype.str}
            data=array.tobytes();chunks.append(data);offset+=len(data)
        filename=f'{name}.bin.gz'
        with gzip.GzipFile(filename=str(root/filename),mode='wb',mtime=0) as stream:stream.write(b''.join(chunks))
        metadata['files'][name]={'url':f'/data/road-network/{filename}','arrays':description,'bytes':offset}
        print(f'{name}: {offset:,} raw bytes; {(root/filename).stat().st_size:,} compressed',flush=True)
    write('nodes',[('xy',(net.xy[order]-lower).astype('<f4').ravel()),('flags',flags),('cells',pointer)])
    for mode in ['walking','bicycling']:
        graph=net.graphs[mode][order,:][:,order].tocsr();graph.sort_indices()
        scale=correction.accessRatio if mode=='bicycling' else 1
        write(mode,[('offsets',graph.indptr.astype('<u4')),('targets',graph.indices.astype('<u4')),('costs',(graph.data*scale).astype('<f4'))])
    atomic_json(root/'manifest.json',metadata)
    print(f'Exported in {time.monotonic()-start:.2f}s without API calls.',flush=True)

if __name__=='__main__':build()
