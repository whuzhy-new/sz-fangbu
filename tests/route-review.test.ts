import test from 'node:test';
import assert from 'node:assert/strict';
import {detectAmapPlatform,reviewRoutes} from '../lib/route-review.ts';
import type {Coord,Leg,Plan} from '../lib/commute.ts';

const a:Coord=[113.92,22.51],b:Coord=[113.94,22.53],c:Coord=[113.95,22.54];
const leg=(mode:Leg['mode'],from:string,to:string,duration:number,origin=a,destination=b):Leg=>({mode,from,to,duration,origin,destination,label:mode,distance:100,paths:[],source:'amap'});
const rail=(from:string,to:string,duration:number,origin=a,destination=b):Leg=>({...leg('metro',from,to,duration,origin,destination),originPoiId:`poi-${from}`,destinationPoiId:`poi-${to}`});
const plan=(legs:Leg[],metroMethod:Plan['metroMethod']='segmented'):Plan=>({id:'test',officeId:'innovation',mode:'metro',title:'测试方案',duration:1200,limit:1200,qualified:true,legs,measuredAt:'2026-11-09',source:'amap',metroMethod});

test('detects Android and Apple mobile devices for native map links',()=>{
  assert.equal(detectAmapPlatform({userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9)'}),'android');
  assert.equal(detectAmapPlatform({userAgent:'Mozilla/5.0',userAgentData:{platform:'Android'}}),'android');
  assert.equal(detectAmapPlatform({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}),'ios');
});

test('iPad desktop mode is detected without treating a Mac as a mobile device',()=>{
  const desktop={userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel'};
  assert.equal(detectAmapPlatform({...desktop,maxTouchPoints:5}),'ios');
  assert.equal(detectAmapPlatform({...desktop,maxTouchPoints:0}),null);
  assert.equal(detectAmapPlatform({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',platform:'Win32',maxTouchPoints:10}),null);
});

test('segmented review provides three QR URLs with the correct travel modes and endpoints',()=>{
  const routes=reviewRoutes(plan([leg('walking','小区','南油地铁站A口',120),rail('南油站','粤海门站',600),leg('bicycling','粤海门E口','工区',180)]));
  assert.deepEqual(routes.map(r=>r.id),['access','metro','egress']);
  assert.equal(new URL(routes[0].url!).searchParams.get('t'),'2');
  assert.equal(new URL(routes[2].url!).searchParams.get('t'),'3');
  const url=new URL(routes[1].url!);
  assert.equal(url.protocol,'iosamap:');
  assert.equal(url.searchParams.get('sname'),'南油(地铁站)');
  assert.equal(url.searchParams.get('dname'),'粤海门(地铁站)');
  assert.equal(url.searchParams.get('sid'),'poi-南油站');
  assert.equal(url.searchParams.get('did'),'poi-粤海门站');
  assert.equal(url.searchParams.get('t'),'1');
});

test('multiple metro legs and station transfer walking share one station-to-station QR',()=>{
  const transfer={...leg('walking','换乘通道','换乘站台',120),kind:'transfer' as const};
  const routes=reviewRoutes(plan([leg('walking','小区','车公庙A口',60),rail('车公庙站','红树湾南站',300,a,b),transfer,rail('红树湾南站','粤海门站',240,b,c),leg('walking','粤海门E口','工区',120)]));
  assert.equal(routes.length,3);
  assert.equal(routes[1].leg.duration,660);
  const url=new URL(routes[1].url!);
  assert.equal(url.searchParams.get('sid'),'poi-车公庙站');
  assert.equal(url.searchParams.get('did'),'poi-粤海门站');
  assert.equal(url.searchParams.get('dlon'),'113.95');
  assert.equal(url.searchParams.get('dlat'),'22.54');
  assert.equal(routes[1].leg.rawDuration,undefined);
});

test('a complete metro route stays one QR and keeps the home and office names',()=>{
  const full={...leg('metro','蔚蓝海岸','深圳湾创新科技中心',1200),kind:'full-transit' as const};
  const routes=reviewRoutes(plan([full],'full'));
  assert.equal(routes.length,1);
  assert.equal(new URL(routes[0].url!).searchParams.get('sname'),'蔚蓝海岸');
  assert.equal(new URL(routes[0].url!).searchParams.get('dname'),'深圳湾创新科技中心');
  assert.equal(new URL(routes[0].url!).searchParams.get('t'),'1');
});

test('walking and cycling review each provide one correctly configured QR route',()=>{
  for(const [mode,expected] of [['walking','2'],['bicycling','3']] as const) {
    const surface=leg(mode,'小区入口','深圳湾创新科技中心',900);
    const routes=reviewRoutes({...plan([surface]),mode,metroMethod:undefined});
    assert.equal(routes.length,1);
    const url=new URL(routes[0].url!);
    assert.equal(url.searchParams.get('t'),expected);
    assert.equal(url.searchParams.get('sname'),'小区入口');
    assert.equal(url.searchParams.get('dname'),'深圳湾创新科技中心');
  }
});

test('every QR switches platform together without adding IDs to coordinate-only cycling',()=>{
  const access={...leg('bicycling','小区入口','深大D口',120),originPoiId:'B0HOME0001',destinationPoiId:'B0ENTRY001'};
  const metro={...rail('深大站','粤海门站',150),originPoiId:'BV10249974',destinationPoiId:'BV10724144'};
  const egress={...leg('walking','粤海门G口','工区',120),originPoiId:'B0EXIT0001',destinationPoiId:'B0OFFICE01',routingIdentity:'poi' as const};
  for(const platform of ['ios','android'] as const) {
    const routes=reviewRoutes(plan([access,metro,egress]),platform);
    const urls=routes.map(route=>new URL(route.url!));
    assert.ok(urls.every(url=>url.protocol===(platform==='ios'?'iosamap:':'amapuri:')));
    assert.deepEqual(urls.map(url=>url.searchParams.get('sid')),[null,'BV10249974','B0EXIT0001']);
    assert.deepEqual(urls.map(url=>url.searchParams.get('did')),[null,'BV10724144','B0OFFICE01']);
    assert.deepEqual(urls.map(url=>url.searchParams.get('t')),['3','1','2']);
    assert.equal(urls[0].searchParams.get('rideType'),platform==='android'?'bike':null);
  }
});

test('an anonymous origin remains an explicit coordinate without becoming current location',()=>{
  const access={...leg('walking','地图选点','深大D口',120),destinationPoiId:'B0ENTRY001',routingIdentity:'poi' as const};
  for(const platform of ['ios','android'] as const) {
    const route=reviewRoutes({...plan([access]),mode:'walking',metroMethod:undefined},platform)[0];
    const url=new URL(route.url!);
    assert.equal(url.searchParams.has('sid'),false);
    assert.equal(url.searchParams.get('did'),'B0ENTRY001');
    assert.equal(url.searchParams.get('slon'),'113.92');
    assert.equal(url.searchParams.get('slat'),'22.51');
    assert.equal(url.searchParams.get('t'),'2');
  }
});

test('Shenda to Yuehaimen review pins the actual station POIs on both mobile platforms',()=>{
  const metro={...rail('深大站','粤海门站',150,[113.944173,22.538667],[113.945531,22.532695]),originPoiId:'BV10249974',destinationPoiId:'BV10724144'};
  const p=plan([leg('walking','小区','深大D口',60),metro,leg('walking','粤海门G口','工区',120)]);
  for(const platform of ['ios','android'] as const) {
    const url=new URL(reviewRoutes(p,platform)[1].url!);
    assert.equal(url.protocol,platform==='ios'?'iosamap:':'amapuri:');
    assert.equal(url.host,platform==='ios'?'path':'route');
    assert.equal(url.pathname,platform==='ios'?'':'/plan/');
    assert.equal(url.searchParams.get('sid'),'BV10249974');
    assert.equal(url.searchParams.get('did'),'BV10724144');
    assert.equal(url.searchParams.get('t'),'1');
    assert.equal(url.searchParams.get('dev'),'0');
    assert.equal(reviewRoutes(p,platform)[1].leg.duration,180);
    assert.equal(url.searchParams.has('from'),false); // No coordinate-only transit fallback.
  }
});

test('missing station IDs never silently produce the coordinate-only QR that adds walking',()=>{
  for(const ids of [{},{originPoiId:'one'},{destinationPoiId:'two'}]) {
    const routes=reviewRoutes(plan([leg('walking','小区','进站口',60),{...leg('metro','深大站','粤海门站',150),...ids},leg('walking','出站口','工区',120)]));
    assert.equal(routes[1].url,null);
    assert.ok(routes[0].url&&routes[2].url);
  }
});
