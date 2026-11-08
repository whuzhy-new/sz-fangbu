"""Independent spatial calibration points; named-address validation is held out."""
import json,math,datetime
import numpy as np
from amap import ROOT,WORK,route,atomic_json
from network import Network
from geo import wgs_to_gcj

if __name__=='__main__':
    net=Network();offices=json.loads((ROOT/'public/data/offices.json').read_text())
    output=WORK/'bicycle-calibration.json'
    rows=json.loads(output.read_text()) if output.exists() else []
    done={r['id'] for r in rows}
    for office in offices:
        field=net.field([(office['entrance'],0)],'bicycling',limit=9000)
        center=net.point(office['entrance'])
        for radius in [350,900,1800,3000]:
            for sector in range(12):
                key=f"{office['id']}-{radius}-{sector}"
                if key in done:continue
                angle=(sector+.37)*math.pi/6
                point=center+radius*np.array([math.cos(angle),math.sin(angle)])
                snap,idx=net.trees['bicycling'].query(point)
                if snap>200:continue
                node=net.ids['bicycling'][idx]
                location=list(wgs_to_gcj(*net.wgs[node]))
                predicted,_=net.time_at(location,field,'bicycling')
                if not math.isfinite(predicted) or predicted>7200:continue
                actual=route('bicycling',location,office['entrance'])
                if not actual:continue
                rows.append({'id':key,'officeId':office['id'],'origin':location,'projected':net.xy[node].tolist(),'modelSeconds':predicted,'amapSeconds':actual['duration'],'amapDistanceM':actual['distance']})
                atomic_json(output,rows)
                if len(rows)%12==0:print('Bicycle calibration samples:',len(rows),flush=True)
    atomic_json(ROOT/'public/data/calibration.json',{'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sampleDesign':'三个工区周围350/900/1800/3000米，12个方位；与验证小区分离。','samples':rows,'note':'校准只能减小局部误差，无法补全道路通行限制。'})
