import test from 'node:test';
import assert from 'node:assert/strict';
import {rankAccessCandidates} from '../lib/segmented-search.ts';
import type {Coord} from '../lib/commute.ts';
const point:Coord=[114,22.6];
const candidate=(stationId:string,id:string,distance:number,duration=600)=>({plan:{stationId,duration},entry:{id,location:[point[0]+distance/100000,point[1]] as Coord},distance});

test('exact road access can prioritize a farther entrance over a nearer one',()=>{
  const result=rankAccessCandidates([candidate('near','a',1000),candidate('far','b',1600)],[{walking:900,bicycling:800},{walking:500,bicycling:200}]);
  assert.equal(result.proofs[0].key,'far:b:bicycling');
  assert.equal(result.summary.total,4);
});

test('all candidates are compared, while proofs include at most two exits of one station',()=>{
  const candidates=Array.from({length:5},(_,s)=>Array.from({length:12},(_,e)=>candidate(`s${s}`,`e${e}`,100+s*100+e))).flat();
  const result=rankAccessCandidates(candidates,candidates.map(()=>({walking:400,bicycling:200})));
  assert.equal(result.tasks.length,120);
  assert.equal(result.summary.total,120);
  assert.equal(result.proofs.length,3);
  assert.equal(new Set(result.proofs.map(task=>task.candidate.plan.stationId)).size,2);
});

test('missing road connections remain unknown and can still be checked by AMap',()=>{
  const result=rankAccessCandidates([candidate('near','a',100)],[{walking:null,bicycling:null}]);
  assert.equal(result.summary.bestDuration,null);
  assert.equal(result.summary.reachable,0);
  assert.equal(result.proofs.length,2);
});

test('identical API requests keep the shortest fixed metro part',()=>{
  const result=rankAccessCandidates([candidate('slow','a',100,900),candidate('fast','b',100,600)],[{walking:300,bicycling:200},{walking:300,bicycling:200}]);
  assert.equal(result.tasks.length,4);
  assert.equal(result.proofs.length,2);
  assert.ok(result.proofs.every(task=>task.candidate.plan.stationId==='fast'));
});

test('access is rounded separately from the fixed metro legs',()=>{
  const result=rankAccessCandidates([candidate('a','x',100,1140)],[{walking:29,bicycling:90}]);
  assert.equal(result.summary.bestDuration,1200);
  assert.equal(result.summary.withinLimit,1);
});

test('a nearby metro gate gets a walking proof before optimistic bicycle estimates',()=>{
  const result=rankAccessCandidates([candidate('near','c',71,1020),candidate('near','d',75,1020),candidate('far','a',700,600)],
    [{walking:120,bicycling:10},{walking:130,bicycling:11},{walking:800,bicycling:200}]);
  assert.equal(result.proofs[0].key,'near:c:walking');
  assert.equal(result.proofs.length,3);
  assert.ok(result.proofs.some(task=>task.candidate.plan.stationId==='far'));
});

test('a nearby station also checks a walking entrance on the opposite side',()=>{
  const c=candidate('near','c',71,1020),a=candidate('near','a',83,1020),d=candidate('near','d',75,1020),far=candidate('far','x',700,600);
  c.entry.location=[point[0]-.000595,point[1]-.000322];
  a.entry.location=[point[0]+.000670,point[1]+.000416];
  d.entry.location=[point[0]+.000627,point[1]-.000345];
  const result=rankAccessCandidates([c,a,d,far],[{walking:108,bicycling:51},{walking:107,bicycling:494},{walking:66,bicycling:32},{walking:800,bicycling:200}]);
  assert.deepEqual(result.proofs.map(task=>task.key),['near:c:walking','near:a:walking','far:x:bicycling']);
});
