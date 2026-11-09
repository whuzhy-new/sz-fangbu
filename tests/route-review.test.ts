import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRoutes} from '../lib/route-review.ts';
import type {Coord,Leg,Plan} from '../lib/commute.ts';

const a:Coord=[113.92,22.51],b:Coord=[113.94,22.53],c:Coord=[113.95,22.54];
const leg=(mode:Leg['mode'],from:string,to:string,duration:number,origin=a,destination=b):Leg=>({mode,from,to,duration,origin,destination,label:mode,distance:100,paths:[],source:'amap'});
const plan=(legs:Leg[],metroMethod:Plan['metroMethod']='segmented'):Plan=>({id:'test',officeId:'innovation',mode:'metro',title:'测试方案',duration:1200,limit:1200,qualified:true,legs,measuredAt:'2026-11-09',source:'amap',metroMethod});

test('segmented review provides three QR URLs with the correct travel modes and endpoints',()=>{
  const routes=reviewRoutes(plan([leg('walking','小区','南油地铁站A口',120),leg('metro','南油站','粤海门站',600),leg('bicycling','粤海门E口','工区',180)]));
  assert.deepEqual(routes.map(r=>r.id),['access','metro','egress']);
  assert.deepEqual(routes.map(r=>new URL(r.url).searchParams.get('mode')),['walk','bus','ride']);
  const rail=new URL(routes[1].url);
  assert.equal(rail.searchParams.get('from'),'113.92,22.51,南油(地铁站)');
  assert.equal(rail.searchParams.get('to'),'113.94,22.53,粤海门(地铁站)');
  assert.ok(routes.every(r=>new URL(r.url).searchParams.get('callnative')==='1'));
});

test('multiple metro legs and station transfer walking share one station-to-station QR',()=>{
  const transfer={...leg('walking','换乘通道','换乘站台',120),kind:'transfer' as const};
  const routes=reviewRoutes(plan([leg('walking','小区','车公庙A口',60),leg('metro','车公庙站','红树湾南站',300,a,b),transfer,leg('metro','红树湾南站','粤海门站',240,b,c),leg('walking','粤海门E口','工区',120)]));
  assert.equal(routes.length,3);
  assert.equal(routes[1].leg.duration,660);
  assert.equal(new URL(routes[1].url).searchParams.get('to'),'113.95,22.54,粤海门(地铁站)');
  assert.equal(routes[1].leg.rawDuration,undefined);
});

test('a complete metro route stays one QR and keeps the home and office names',()=>{
  const full={...leg('metro','蔚蓝海岸','深圳湾创新科技中心',1200),kind:'full-transit' as const};
  const routes=reviewRoutes(plan([full],'full'));
  assert.equal(routes.length,1);
  assert.equal(new URL(routes[0].url).searchParams.get('from'),'113.92,22.51,蔚蓝海岸');
  assert.equal(new URL(routes[0].url).searchParams.get('to'),'113.94,22.53,深圳湾创新科技中心');
});
