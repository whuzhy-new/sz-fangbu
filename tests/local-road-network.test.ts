import test from 'node:test';
import assert from 'node:assert/strict';
import {allAccessTimes,nearestNodes,projectLocation,reverseRoadGraph,type RoadNetwork} from '../lib/local-road-network.ts';
import type {Coord} from '../lib/commute.ts';

const locations:Coord[]=[[113.9,22.53],[113.904,22.53],[113.908,22.53]];
function fixture():RoadNetwork {
  const offset=projectLocation(locations[0]);
  const xy=new Float32Array(locations.flatMap(p=>{const q=projectLocation(p);return [q[0]-offset[0],q[1]-offset[1]];}));
  const columns=10,rows=2,counts=new Uint32Array(columns*rows);
  locations.forEach((_,id)=>counts[Math.floor(xy[id*2+1]/100)*columns+Math.floor(xy[id*2]/100)]++);
  const cells=new Uint32Array(counts.length+1);counts.forEach((count,i)=>cells[i+1]=cells[i]+count);
  return {manifest:{version:'directed-road-network-v1',nodeCount:3,cellSize:100,columns,rows,offset,walkingSpeed:1.25,bicyclingSpeed:3,bicycleAccessRatio:1.2,maxSnapMeters:150,osmDate:'test',files:{}},xy,cells,flags:new Uint8Array([3,3,3]),
    walking:{offsets:new Uint32Array([0,1,3,4]),targets:new Uint32Array([1,0,2,1]),costs:new Float32Array([100,100,100,100])},
    bicycling:{offsets:new Uint32Array([0,0,1,2]),targets:new Uint32Array([0,1]),costs:new Float32Array([48,48])}};
}

test('coordinate conversion matches the Python EPSG:32649 graph within a centimetre',()=>{
  const p=projectLocation([113.921442,22.543001]);
  assert.ok(Math.abs(p[0]-799977.9866)<.01);
  assert.ok(Math.abs(p[1]-2496198.1884)<.01);
});

test('one forward search returns every target, respecting bicycle directions',()=>{
  const network=fixture();
  const forward=allAccessTimes(network,locations[0],locations);
  assert.equal(forward.length,3);
  assert.ok(Math.abs(forward[2].walking!-200)<.001);
  assert.equal(forward[2].bicycling,null);
  const backward=allAccessTimes(network,locations[2],[locations[0]]);
  assert.ok(Math.abs(backward[0].walking!-200)<.001);
  assert.ok(Math.abs(backward[0].bicycling!-96)<.001);
});

test('points off the road network remain unknown instead of using straight-line times',()=>{
  const network=fixture(),point:Coord=[113.95,22.6];
  assert.equal(nearestNodes(network,point,'walking').length,0);
  assert.deepEqual(allAccessTimes(network,point,locations),locations.map(()=>({walking:null,bicycling:null})));
});

test('return ranking searches incoming edges from home without changing forward edges',()=>{
  const network=fixture();
  const reversed={...network,bicycling:reverseRoadGraph(network.bicycling)};
  const times=allAccessTimes(reversed,locations[0],locations);
  assert.ok(times.every((time,index)=>time.bicycling!==null&&Math.abs(time.bicycling-48*index)<.001));
  assert.equal(allAccessTimes(network,locations[0],[locations[2]])[0].bicycling,null);
});

test('the search limit excludes inaccessible targets without inventing durations',()=>{
  const result=allAccessTimes(fixture(),locations[0],[locations[2]],150);
  assert.deepEqual(result,[{walking:null,bicycling:null}]);
});
