import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,SourceTextModule,SyntheticModule} from 'node:vm';
import ts from 'typescript';
import * as commute from '../lib/commute.ts';
import * as segmentedSearch from '../lib/segmented-search.ts';
import {reviewRoutes} from '../lib/route-review.ts';
import {surfaceRouteParams,transitRouteParams} from '../lib/amap-route-params.ts';

// Exercise the real streaming handler with isolated map responses, without
// spending API quota or depending on Cloudflare bindings and live timetable data.
const handlerSource=ts.transpileModule(readFileSync(new URL('../app/api/verify/route.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
}).outputText;
const point=[113.925797,22.510346],measuredAt='2026-11-09T01:00:00.000Z';
const offices=[{id:'innovation',name:'创新工区',poiId:'B0OFFICE01',walkingIdentity:'poi',entrance:[113.946916,22.529489]},
  {id:'prince',name:'太子工区',poiId:'B0OFFICE02',entrance:[113.914019,22.484158]}];
const leg=(mode,duration,origin,destination,from,to)=>({mode,duration,origin,destination,from,to,
  label:mode,distance:100,paths:[],source:'amap',measuredAt});

async function verify({surface={},direct={},access=200,fixed=[750,150],officeIds=['innovation'],entryCount=1,stationCount=1,modelAccess=200,deadlineController,abortAfterSurface=false,localFailure=false,poiId,staleOfficeEndpoint=false,staleRoutingIdentity=false}={}){
  const calls=[];
  class MapApiError extends Error{}
  const stations=Array.from({length:stationCount},(_,i)=>({id:`nanyou-${i}`,name:i?`南油${i}`:'南油',location:point}));
  const plans=Object.fromEntries(offices.map(office=>[office.id,Object.fromEntries(stations.map(station=>[station.id,{id:`${office.id}-${station.id}`,
    stationId:station.id,stationName:station.name,officeId:office.id,duration:fixed[0]+fixed[1],measuredAt,
    metroApi:{originName:station.name,destinationName:'粤海门'},legs:[
      leg('metro',fixed[0],point,[113.945531,22.532695],station.name+'站','粤海门站'),
      {...leg('walking',fixed[1],[113.945531,22.532695],staleOfficeEndpoint?[113.947837,22.528476]:office.entrance,'粤海门E口',office.name),routingIdentity:staleRoutingIdentity?undefined:'poi',originPoiId:'B0EXIT0001',destinationPoiId:office.poiId}]}]))]));
  const entries={...Object.fromEntries(stations.map((station,n)=>[station.id,Array.from({length:entryCount},(_,i)=>({id:`B0ENTRY${n}${i}`,name:`南油地铁站${n}-${i}口`,location:[point[0]+i*.0001,point[1]+n*.0002],source:'amap'}))])),
    yuehaimen:[{id:'B0EXIT0001',name:'粤海门E口',location:[113.945531,22.532695],source:'amap'}]};
  const dependencies={
    '@/public/data/offices.json':{default:offices},
    '@/data/metro-index.json':{default:{complete:true,methodVersion:'amap-station-pair-v3',durationRounding:commute.DURATION_ROUNDING_VERSION,plans,entries}},
    '@/lib/local-access-server':{async localAccessTimes(origin,targets){if(localFailure)throw new Error('unavailable');return {times:targets.map(()=>({walking:modelAccess,bicycling:modelAccess})),elapsedMs:1,osmDate:'2026-11-07'};}},
    '@/lib/segmented-search':segmentedSearch,
    '@/public/data/stations.json':{default:{stations:[...stations,{id:'yuehaimen',name:'粤海门',location:[113.945531,22.532695]}]}},
    '@/lib/commute':commute,
    '@/lib/amap-server':{
      MapApiError,METRO_DEPARTURE:{label:'2026-11-09 09:00'},
      async surfaceLeg(mode,origin,destination,from,to,options){
        const office=offices.find(o=>o.name===to);
        calls.push(`${office?.id??'access'}:${mode}`);
        const duration=office?(surface[office.id]?.[mode]??(mode==='walking'?1830:1230)):access;
        if(office&&abortAfterSurface)deadlineController.abort();
        if(duration==='error')throw new MapApiError('地图查询失败');
        return duration===null?null:{...leg(mode,duration,origin,destination,from,to),...surfaceRouteParams(mode,origin,destination,options).endpoints};
      },
      async fullMetro(origin,destination,from,to,options){
        const office=offices.find(o=>o.name===to);
        calls.push(`${office.id}:direct`);
        const duration=direct[office.id]??1230;
        if(duration==='error')throw new MapApiError('完整地铁查询失败');
        return {...leg('metro',duration,origin,destination,from,to),kind:'full-transit',...transitRouteParams(origin,destination,options).endpoints};
      }
    }
  };
  const signals=deadlineController?{any:signals=>AbortSignal.any(signals),timeout:ms=>{assert.equal(ms,4500);return deadlineController.signal;}}:AbortSignal;
  const context=createContext({Request,Response,ReadableStream,TextEncoder,AbortSignal:signals});
  const route=new SourceTextModule(handlerSource,{context});
  await route.link(specifier=>{
    const exports=dependencies[specifier];
    assert.ok(exports,`Unexpected route dependency: ${specifier}`);
    return new SyntheticModule(Object.keys(exports),function(){
      for(const [key,value] of Object.entries(exports))this.setExport(key,value);
    },{context});
  });
  await route.evaluate();
  const response=await route.namespace.POST(new Request('http://localhost/api/verify',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({location:point,name:'测试小区门口',officeIds,poiId})
  }));
  assert.equal(response.status,200);
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type,'done');
  assert.ok(!events.some(e=>e.type==='error'));
  return {calls,events,results:events.filter(e=>e.type==='office-result').map(e=>e.result)};
}

for(const [mode,duration] of [['walking',1800],['bicycling',1200]]){
  test(`${mode} meets its inclusive threshold: neither metro stage is requested`,async()=>{
    const {calls,events,results:[result]}=await verify({surface:{innovation:{[mode]:duration}}});
    assert.deepEqual(calls,['innovation:walking','innovation:bicycling']);
    assert.equal(result.checked,2);
    assert.ok(result.plans.some(p=>p.mode===mode&&p.qualified));
    assert.ok(events.filter(e=>e.type==='plan').every(e=>e.plan.mode!=='metro'));
    assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>[e.officeId,e.stage]),[['innovation','surface']]);
  });
}

test('direct metro runs after both surface routes fail and skips segmented queries at 20 minutes',async()=>{
  const {calls,events,results:[result]}=await verify({direct:{innovation:1200}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct']);
  assert.equal(result.checked,3);
  assert.equal(result.plans.find(p=>p.qualified)?.metroMethod,'full');
  assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>e.stage),['surface','metro-full']);
});

test('segmented metro runs only after the direct total exceeds 20 minutes',async()=>{
  const {calls,events,results:[result]}=await verify({direct:{innovation:1230}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct','access:walking']);
  assert.ok(result.plans.some(p=>p.metroMethod==='full'&&!p.qualified));
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified&&p.duration===1140));
  assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>e.stage),['surface','metro-full','metro-segmented']);
  const metro=result.plans.find(p=>p.metroMethod==='segmented').legs.find(l=>l.mode==='metro');
  assert.equal(metro.originPoiId,'nanyou-0');
  assert.equal(metro.destinationPoiId,'yuehaimen');
  const native=new URL(commute.mapLink(metro,'ios'));
  assert.equal(native.searchParams.get('sid'),'nanyou-0');
  assert.equal(native.searchParams.get('did'),'yuehaimen');
});

test('QR endpoints preserve the identity actually used in API requests',async()=>{
  const origin='B0HOME0001';
  const surface=await verify({poiId:origin,surface:{innovation:{walking:1200}}});
  const direct=await verify({poiId:origin,direct:{innovation:1200}});
  for(const p of [...surface.results[0].plans,direct.results[0].plans.find(p=>p.metroMethod==='full')]) {
    if(p.mode==='bicycling'){
      assert.equal(p.legs[0].routingIdentity,'coordinates');
      assert.equal(p.legs[0].originPoiId,undefined);
      assert.equal(p.legs[0].destinationPoiId,undefined);
      continue;
    }
    assert.equal(p.legs[0].originPoiId,origin);
    assert.equal(p.legs[0].destinationPoiId,'B0OFFICE01');
    for(const platform of ['ios','android']) {
      const url=new URL(reviewRoutes(p,platform)[0].url);
      assert.equal(url.searchParams.get('sid'),origin);
      assert.equal(url.searchParams.get('did'),'B0OFFICE01');
    }
  }
  const segmented=await verify({poiId:origin});
  const p=segmented.results[0].plans.find(p=>p.metroMethod==='segmented');
  assert.deepEqual(p.legs.map(l=>[l.originPoiId,l.destinationPoiId]),[[origin,'B0ENTRY00'],['nanyou-0','yuehaimen'],['B0EXIT0001','B0OFFICE01']]);
  const anonymous=await verify();
  const access=anonymous.results[0].plans.find(p=>p.metroMethod==='segmented').legs[0];
  assert.equal(access.originPoiId,undefined);
  assert.deepEqual(access.origin,point);
  assert.equal(access.destinationPoiId,'B0ENTRY00');
});

test('20 minutes 29 seconds rounds down and short-circuits later stages',async()=>{
  const surface=await verify({surface:{innovation:{bicycling:1229}}});
  assert.deepEqual(surface.calls,['innovation:walking','innovation:bicycling']);
  const bike=surface.results[0].plans.find(p=>p.mode==='bicycling');
  assert.equal(bike.duration,1200);assert.equal(bike.legs[0].rawDuration,1229);
  const direct=await verify({direct:{innovation:1229}});
  assert.deepEqual(direct.calls,['innovation:walking','innovation:bicycling','innovation:direct']);
  assert.equal(direct.results[0].plans.find(p=>p.qualified).duration,1200);
});

test('rounded fixed legs and access are added separately, including candidate filtering',async()=>{
  const {results:[result]}=await verify({fixed:[569,629],access:29});
  const plan=result.plans.find(p=>p.metroMethod==='segmented');
  assert.ok(plan?.qualified);
  assert.equal(plan.duration,1200);
  assert.deepEqual(plan.legs.map(l=>l.duration),[60,540,600]);
  assert.deepEqual(plan.legs.map(l=>l.rawDuration),[29,569,629]);
});

test('one-minute access minimum rejects a 20-minute fixed plan before querying access',async()=>{
  const {calls,results:[result]}=await verify({fixed:[629,629],access:29});
  assert.ok(!result.plans.some(p=>p.qualified));
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct']);
});

test('a segmented route is rejected if its rounded parts total 21 minutes, even when raw total rounds to 20',async()=>{
  const {results:[result]}=await verify({fixed:[750,150],access:270});
  assert.equal(commute.roundDuration(750+150+270),1200);
  assert.ok(!result.plans.some(p=>p.qualified));
});

test('a qualifying surface route skips metro even if the other surface query fails',async()=>{
  const {calls,results:[result]}=await verify({surface:{innovation:{walking:'error',bicycling:1199}}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling']);
  assert.ok(result.plans.some(p=>p.qualified));
  assert.deepEqual(result.errors,['地图查询失败']);
});

test('direct metro errors remain visible while segmented verification can still succeed',async()=>{
  const {calls,results:[result]}=await verify({direct:{innovation:'error'}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct','access:walking']);
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified));
  assert.deepEqual(result.errors,['完整地铁查询失败']);
});

test('short-circuiting one office does not skip verification for another office',async()=>{
  const {calls,events,results}=await verify({officeIds:['innovation','prince'],
    surface:{innovation:{walking:1000}},direct:{prince:1000}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','prince:walking','prince:bicycling','prince:direct']);
  assert.deepEqual(results.map(r=>[r.officeId,r.checked]),[['innovation',2],['prince',3]]);
  assert.ok(results.every(r=>r.plans.some(p=>p.qualified)));
  assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>[e.officeId,e.stage]),[['innovation','surface'],['prince','surface'],['prince','metro-full']]);
});

test('every local combination is compared before at most three AMap access proofs',async()=>{
  const {calls,events,results:[result]}=await verify({entryCount:40,stationCount:3,access:900});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,3);
  assert.equal(result.localSearch.total,240);
  assert.equal(result.localSearch.source,'model');
  assert.equal(result.complete,false);
  assert.ok(!result.plans.some(p=>p.qualified));
  const localEvent=events.findIndex(e=>e.type==='local-search');
  const segmentedProof=events.findIndex(e=>e.type==='plan'&&e.plan.metroMethod==='segmented');
  assert.ok(localEvent<segmentedProof);
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&!p.qualified));
});

test('a promising model never becomes an AMap-qualified result without a successful proof',async()=>{
  const {results:[result]}=await verify({entryCount:40,access:900,modelAccess:30});
  assert.equal(result.localSearch.withinLimit,80);
  assert.ok(!result.plans.some(p=>p.qualified));
  assert.ok(result.plans.every(p=>p.source==='amap'));
  assert.equal(result.complete,false);
});

test('an access API failure preserves the complete local comparison and earlier results',async()=>{
  const {calls,results:[result]}=await verify({entryCount:40,access:'error'});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,1);
  assert.equal(result.localSearch.total,80);
  assert.equal(result.plans.length,3);
  assert.equal(result.complete,false);
});

test('the five-second deadline stops later APIs while retaining the local comparison',async()=>{
  const controller=new AbortController();
  const {calls,results:[result]}=await verify({entryCount:40,deadlineController:controller,abortAfterSurface:true});
  assert.deepEqual(calls,['innovation:walking']);
  assert.equal(result.localSearch.total,80);
  assert.equal(result.complete,false);
  assert.ok(result.errors.includes('高德核验超时，已有结果已保留。'));
});

test('unavailable local data falls back to AMap proofs without claiming a full local comparison',async()=>{
  const {results:[result]}=await verify({localFailure:true});
  assert.equal(result.localSearch,undefined);
  assert.ok(result.plans.some(p=>p.qualified&&p.source==='amap'));
});

test('changing an office entrance rejects prepared routes that still end at the previous entrance',async()=>{
  const {calls,results:[result]}=await verify({staleOfficeEndpoint:true});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct']);
  assert.ok(!result.plans.some(plan=>plan.metroMethod==='segmented'));
  assert.ok(!result.plans.some(plan=>plan.qualified));
  assert.equal(result.complete,false);
});

test('a POI-based office rejects coordinate-only fixed walks even when their coordinates match',async()=>{
  const {calls,results:[result]}=await verify({staleRoutingIdentity:true});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct']);
  assert.ok(!result.plans.some(plan=>plan.metroMethod==='segmented'));
  assert.ok(!result.plans.some(plan=>plan.qualified));
});
