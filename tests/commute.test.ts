import test from 'node:test';
import assert from 'node:assert/strict';
import {qualified,surfaceDuration,polyline,withinShenzhen,mapLink} from '../lib/commute.ts';

test('policy thresholds include exactly 20/30 minutes; rounding never grants eligibility',()=>{
  assert.equal(qualified(1200,'bicycling'),true);
  assert.equal(qualified(1200.01,'bicycling'),false);
  assert.equal(qualified(1200,'metro'),true);
  assert.equal(qualified(1800,'walking'),true);
  assert.equal(qualified(1800.01,'walking'),false);
  for(const n of [-1,NaN,Infinity])assert.equal(qualified(n,'walking'),false);
});
test('AMap walking and cycling responses use different duration locations',()=>{
  assert.equal(surfaceDuration({cost:{duration:'980'},distance:'1225'}),980);
  assert.equal(surfaceDuration({duration:'510',distance:'1511'}),510);
  assert.equal(surfaceDuration({duration:'0',distance:'1511'}),null);
  assert.equal(surfaceDuration({distance:'100'}),null);
  assert.equal(surfaceDuration({duration:'-10'}),null);
});
test('polyline object and string formats; invalid coordinates are discarded',()=>{
  assert.deepEqual(polyline({polyline:'113.9,22.5;bad;114,22.6'}),[[113.9,22.5],[114,22.6]]);
  assert.deepEqual(polyline(null),[]);
});
test('verify bounds reject invalid input and map link encodes names',()=>{
  assert.equal(withinShenzhen([113.94,22.52]),true);
  assert.equal(withinShenzhen([NaN,22.52]),false);
  assert.equal(withinShenzhen([116.4,39.9]),false);
  const url=new URL(mapLink({mode:'walking',from:'小区&A',to:'工区',origin:[113.94,22.52],destination:[113.95,22.52],label:'步行',duration:10,distance:10,paths:[],source:'amap'}));
  assert.equal(url.searchParams.get('mode'),'walk');
  assert.equal(url.searchParams.get('from'),'113.94,22.52,小区&A');
});
