import test from 'node:test';
import assert from 'node:assert/strict';
import {qualified,roundDuration,roundLeg,sumLegDurations,formatDuration,surfaceDuration,polyline,withinShenzhen,mapLink,placePoiId} from '../lib/commute.ts';
import {fullMetroLeg} from '../lib/full-metro.ts';

test('policy thresholds use whole minutes with a 30-second rounding boundary',()=>{
  assert.equal(qualified(1200,'bicycling'),true);
  assert.equal(qualified(1229.999,'bicycling'),true);
  assert.equal(qualified(1230,'bicycling'),false);
  assert.equal(qualified(1200,'metro'),true);
  assert.equal(qualified(1800,'walking'),true);
  assert.equal(qualified(1829.999,'walking'),true);
  assert.equal(qualified(1830,'walking'),false);
  for(const n of [-1,NaN,Infinity])assert.equal(qualified(n,'walking'),false);
});
test('round each segment before summing; presentation and qualification use the same minutes',()=>{
  for(const [seconds,minutes] of [[0,1],[1,1],[19,1],[20,1],[29,1],[30,1],[79,1],[80,1],[89,1],[90,2],[18*60+19,18],[18*60+20,18],[18*60+29,18],[18*60+30,19],[18*60+31,19]]){
    assert.equal(roundDuration(seconds),minutes*60);
    assert.equal(formatDuration(seconds),`${minutes}分`);
  }
  assert.equal(sumLegDurations([{duration:0},{duration:29}]),120);
  const down=[{duration:629},{duration:629}];
  assert.equal(sumLegDurations(down),1200);
  assert.equal(roundDuration(down.reduce((sum,l)=>sum+l.duration,0)),1260);
  assert.equal(sumLegDurations([{duration:240,rawDuration:203}]),180);
  const up=[{duration:570},{duration:570}];
  assert.equal(sumLegDurations(up),1200);
  assert.equal(roundDuration(1140),1140);
  assert.equal(formatDuration(NaN),'暂无路线');
  const raw={mode:'walking' as const,duration:1111,label:'步行',from:'小区',to:'工区',origin:[113.94,22.52] as [number,number],destination:[113.95,22.52] as [number,number],distance:100,paths:[],source:'amap' as const};
  const rounded=roundLeg(raw);
  assert.equal(rounded.duration,1140);
  assert.equal(rounded.rawDuration,1111);
  assert.deepEqual(roundLeg(rounded),rounded);
  assert.equal(raw.duration,1111);
});
test('AMap walking and cycling responses use different duration locations',()=>{
  assert.equal(surfaceDuration({cost:{duration:'980'},distance:'1225'}),980);
  assert.equal(surfaceDuration({duration:'510',distance:'1511'}),510);
  assert.equal(surfaceDuration({duration:'0',distance:'1511'}),null);
  assert.equal(surfaceDuration({distance:'100'}),null);
  assert.equal(surfaceDuration({duration:null,distance:0}),null);
  assert.equal(surfaceDuration({duration:'',distance:0}),null);
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
  const url=new URL(mapLink({mode:'walking',from:'小区&A',to:'工区',origin:[113.94,22.52],destination:[113.95,22.52],label:'步行',duration:10,distance:10,paths:[],source:'amap'})!);
  assert.equal(url.protocol,'iosamap:');
  assert.equal(url.searchParams.get('t'),'2');
  assert.equal(url.searchParams.get('sname'),'小区&A');
  assert.equal(url.searchParams.get('slon'),'113.94');
  assert.equal(url.searchParams.get('slat'),'22.52');
  const rail=new URL(mapLink({mode:'metro',from:'南油站',to:'粤海门站',originPoiId:'nanyou',destinationPoiId:'yuehaimen',origin:[113.925797,22.510346],destination:[113.945531,22.532695],label:'地铁9号线',duration:600,distance:3500,paths:[],source:'amap'})!);
  assert.equal(rail.protocol,'iosamap:');
  assert.equal(rail.searchParams.get('sid'),'nanyou');
  assert.equal(rail.searchParams.get('did'),'yuehaimen');
  assert.equal(rail.searchParams.get('sname'),'南油(地铁站)');
  assert.equal(rail.searchParams.get('dname'),'粤海门(地铁站)');
  assert.equal(rail.searchParams.get('t'),'1');
  const full=new URL(mapLink({mode:'metro',kind:'full-transit',from:'蔚蓝海岸',to:'深圳湾创新科技中心',origin:[113.94,22.52],destination:[113.95,22.52],label:'地铁完整方案',duration:1100,distance:3000,paths:[],source:'amap'})!);
  assert.equal(full.searchParams.get('sname'),'蔚蓝海岸');
  assert.equal(full.searchParams.get('dname'),'深圳湾创新科技中心');
});

test('known places keep POI identity, while moved or anonymous map points use their coordinates',()=>{
  const base={id:'B0HOME0001',name:'小区',address:'',location:[113.94,22.52] as [number,number]};
  assert.equal(placePoiId(base),'B0HOME0001'); // Also supports existing search history.
  assert.equal(placePoiId({...base,id:'map-point',kind:'map',poiId:'B0HOME0001'}),'B0HOME0001');
  assert.equal(placePoiId({...base,kind:'map'}),undefined); // A retained label is not POI identity.
  assert.equal(placePoiId({...base,id:'map-point',kind:'map'}),undefined);
  assert.equal(placePoiId({...base,id:'address-0',kind:'address'}),undefined);
});

test('full metro keeps complete API time including access, transfers and waiting',()=>{
  const line={type:'地铁线路',name:'地铁9号线(前湾--文锦)',cost:{duration:'600'},departure_stop:{name:'南油'},arrival_stop:{name:'粤海门'},polyline:'113.92,22.51;113.94,22.53'};
  const transit={cost:{duration:'1200'},distance:'4000',segments:[{walking:{cost:{duration:'200'},steps:[{polyline:'113.91,22.51;113.92,22.51'}]},bus:{buslines:[line]}},{walking:{cost:{duration:'150'}}}]};
  const parse=(transits:unknown[])=>fullMetroLeg({route:{transits}} as Parameters<typeof fullMetroLeg>[0],[113.91,22.51],[113.94,22.53],'小区','工区');
  const leg=parse([transit]);
  assert.equal(leg?.duration,1200); // Do not sum to 950 or subtract the unexplained 250 seconds.
  assert.equal(leg?.kind,'full-transit');
  assert.equal(leg?.paths.length,2);
  assert.equal(qualified(leg!.duration,'metro'),true);
  const slower={...transit,cost:{duration:'1230'}};
  assert.equal(qualified(parse([slower])!.duration,'metro'),false);
  assert.equal(parse([slower,transit])?.duration,1200);
  assert.equal(parse([{...transit,cost:{}}]),null);
  assert.equal(parse([{...transit,segments:[{walking:{cost:{duration:'600'}}}]}]),null);
  assert.equal(parse([{...transit,segments:[...transit.segments,{bus:{buslines:[{...line,type:'普通公交线路'}]}}]}]),null);
  for(const key of ['taxi','railway','riding'])assert.equal(parse([{...transit,segments:[...transit.segments,{[key]:{distance:'100'}}]}]),null);
});
