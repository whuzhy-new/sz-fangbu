import type {Coord} from "./commute.ts";

export type AccessMode="walking"|"bicycling";
type ArraySpec={offset:number;length:number;type:string};
export type NetworkManifest={version:string;nodeCount:number;cellSize:number;columns:number;rows:number;offset:Coord;walkingSpeed:number;bicyclingSpeed:number;bicycleAccessRatio:number;maxSnapMeters:number;osmDate:string;files:Record<string,{url:string;bytes:number;arrays:Record<string,ArraySpec>}>};
export type RoadGraph={offsets:Uint32Array;targets:Uint32Array;costs:Float32Array};
export type RoadNetwork={manifest:NetworkManifest;xy:Float32Array;flags:Uint8Array;cells:Uint32Array;walking:RoadGraph;bicycling:RoadGraph};
export type AccessTime={walking:number|null;bicycling:number|null};

/** Build incoming edges so a search rooted at home can score gate → home. */
export function reverseRoadGraph(graph:RoadGraph):RoadGraph {
  const offsets=new Uint32Array(graph.offsets.length);
  for(const target of graph.targets)offsets[target+1]++;
  for(let node=1;node<offsets.length;node++)offsets[node]+=offsets[node-1];
  const cursor=offsets.slice(0,-1);
  const targets=new Uint32Array(graph.targets.length),costs=new Float32Array(graph.costs.length);
  for(let source=0;source<cursor.length;source++){
    for(let edge=graph.offsets[source];edge<graph.offsets[source+1];edge++){
      const index=cursor[graph.targets[edge]]++;
      targets[index]=source;costs[index]=graph.costs[edge];
    }
  }
  return {offsets,targets,costs};
}

// GCJ02 -> WGS84 -> UTM49N, matching the offline graph's EPSG:32649.
function wgsToGCJ(lon:number,lat:number):Coord {
  const x=lon-105,y=lat-35,p=Math.PI;
  let dy=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  dy+=(20*Math.sin(6*x*p)+20*Math.sin(2*x*p))*2/3+(20*Math.sin(y*p)+40*Math.sin(y*p/3))*2/3+(160*Math.sin(y*p/12)+320*Math.sin(y*p/30))*2/3;
  let dx=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dx+=(20*Math.sin(6*x*p)+20*Math.sin(2*x*p))*2/3+(20*Math.sin(x*p)+40*Math.sin(x*p/3))*2/3+(150*Math.sin(x*p/12)+300*Math.sin(x*p/30))*2/3;
  const rad=lat*p/180,magic=1-.00669342162296594323*Math.sin(rad)**2;
  return [lon+dx*180/(6378245/Math.sqrt(magic)*Math.cos(rad)*p),lat+dy*180/(6378245*(1-.00669342162296594323)/(magic*Math.sqrt(magic))*p)];
}
export function projectLocation(location:Coord):Coord {
  let [lon,lat]=location;
  for(let i=0;i<5;i++){const shifted=wgsToGCJ(lon,lat);lon-=shifted[0]-location[0];lat-=shifted[1]-location[1];}
  const p=lat*Math.PI/180,l=(lon-111)*Math.PI/180,a=6378137,e=.0066943799901413165,ep=e/(1-e),k=.9996;
  const n=a/Math.sqrt(1-e*Math.sin(p)**2),t=Math.tan(p)**2,c=ep*Math.cos(p)**2,b=l*Math.cos(p);
  const m=a*((1-e/4-3*e**2/64-5*e**3/256)*p-(3*e/8+3*e**2/32+45*e**3/1024)*Math.sin(2*p)+(15*e**2/256+45*e**3/1024)*Math.sin(4*p)-35*e**3/3072*Math.sin(6*p));
  return [500000+k*n*(b+(1-t+c)*b**3/6+(5-18*t+t*t+72*c-58*ep)*b**5/120),k*(m+n*Math.tan(p)*(b*b/2+(5-t+9*c+4*c*c)*b**4/24+(61-58*t+t*t+600*c-330*ep)*b**6/720))];
}

export function nearestNodes(network:RoadNetwork,location:Coord,mode:AccessMode) {
  const {manifest:m,xy,cells,flags}=network;
  const projected=projectLocation(location),x=projected[0]-m.offset[0],y=projected[1]-m.offset[1],r=m.maxSnapMeters;
  const bit=mode==="walking"?1:2,best:{id:number;distance:number}[]=[];
  const x0=Math.max(0,Math.floor((x-r)/m.cellSize)),x1=Math.min(m.columns-1,Math.floor((x+r)/m.cellSize));
  const y0=Math.max(0,Math.floor((y-r)/m.cellSize)),y1=Math.min(m.rows-1,Math.floor((y+r)/m.cellSize));
  for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++) {
    const cell=cy*m.columns+cx;
    for(let id=cells[cell];id<cells[cell+1];id++) {
      if(!(flags[id]&bit))continue;
      const distance=Math.hypot(xy[id*2]-x,xy[id*2+1]-y);
      if(distance>r||(best.length===4&&distance>=best[3].distance))continue;
      best.push({id,distance});best.sort((a,b)=>a.distance-b.distance);if(best.length>4)best.pop();
    }
  }
  return best;
}

class MinHeap {
  ids:number[]=[];costs:number[]=[];
  push(id:number,cost:number){
    let i=this.ids.length;this.ids.push(id);this.costs.push(cost);
    while(i>0){const parent=(i-1)>>1;if(this.costs[parent]<=cost)break;this.ids[i]=this.ids[parent];this.costs[i]=this.costs[parent];i=parent;}
    this.ids[i]=id;this.costs[i]=cost;
  }
  pop():[number,number]{
    const id=this.ids[0],cost=this.costs[0],lastId=this.ids.pop()!,lastCost=this.costs.pop()!;
    if(this.ids.length){let i=0;while(i*2+1<this.ids.length){let child=i*2+1;if(child+1<this.ids.length&&this.costs[child+1]<this.costs[child])child++;if(this.costs[child]>=lastCost)break;this.ids[i]=this.ids[child];this.costs[i]=this.costs[child];i=child;}this.ids[i]=lastId;this.costs[i]=lastCost;}
    return [id,cost];
  }
}

/** Two forward searches, followed by reads for every target. No grid rounding. */
export function allAccessTimes(network:RoadNetwork,origin:Coord,targets:Coord[],limit=2000):AccessTime[] {
  const times:AccessTime[]=targets.map(()=>({walking:null,bicycling:null}));
  const distance=new Float64Array(network.manifest.nodeCount);
  for(const mode of ["walking","bicycling"] as const) {
    distance.fill(Infinity);
    const heap=new MinHeap(),graph=network[mode],m=network.manifest;
    const speed=mode==="walking"?m.walkingSpeed:m.bicyclingSpeed,scale=mode==="walking"?1:m.bicycleAccessRatio;
    for(const snap of nearestNodes(network,origin,mode)){const cost=snap.distance/speed*scale;distance[snap.id]=cost;heap.push(snap.id,cost);}
    while(heap.ids.length){
      const [node,cost]=heap.pop();if(cost>distance[node]||cost>limit)continue;
      for(let edge=graph.offsets[node];edge<graph.offsets[node+1];edge++) {
        const next=graph.targets[edge],value=cost+graph.costs[edge];
        if(value<distance[next]&&value<=limit){distance[next]=value;heap.push(next,value);}
      }
    }
    targets.forEach((target,index)=>{
      let value=Infinity;
      for(const snap of nearestNodes(network,target,mode))value=Math.min(value,distance[snap.id]+snap.distance/speed*scale);
      times[index][mode]=Number.isFinite(value)&&value<=limit?value:null;
    });
  }
  return times;
}

export async function loadRoadNetwork(fetchAsset:(path:string)=>Promise<Response>):Promise<RoadNetwork> {
  const response=await fetchAsset('/data/road-network/manifest.json');
  if(!response.ok)throw new Error('Local network manifest unavailable');
  const manifest=await response.json() as NetworkManifest;
  if(manifest.version!=="directed-road-network-v1")throw new Error('Unsupported local network');
  const files=await Promise.all(['nodes','walking','bicycling'].map(async name=>{
    const file=manifest.files[name],response=await fetchAsset(file.url);
    if(!response.ok)throw new Error('Local network unavailable');
    let buffer=await response.arrayBuffer();
    const bytes=new Uint8Array(buffer);
    if(bytes[0]===31&&bytes[1]===139)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(buffer.byteLength!==file.bytes)throw new Error('Incomplete local network');
    return Object.fromEntries(Object.entries(file.arrays).map(([key,spec])=>[key,spec.type==='<u4'?new Uint32Array(buffer,spec.offset,spec.length):spec.type==='<f4'?new Float32Array(buffer,spec.offset,spec.length):new Uint8Array(buffer,spec.offset,spec.length)]));
  }));
  return {manifest,...files[0],walking:files[1],bicycling:files[2]} as unknown as RoadNetwork;
}
