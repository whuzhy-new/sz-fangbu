import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,SourceTextModule,SyntheticModule} from 'node:vm';
import ts from 'typescript';
import * as commute from '../lib/commute.ts';
import * as segmentedSearch from '../lib/segmented-search.ts';
import * as metroGates from '../lib/metro-gates.ts';
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

async function verify({surface={},direct={},access=200,fixed=[750,150],officeIds=['innovation'],entryCount=1,stationCount=1,modelAccess=200,deadlineController,abortAfterSurface=false,localFailure=false,localDeadline=false,poiId,staleOfficeEndpoint=false,staleRoutingIdentity=false,unnamedAccess=false,elapsedPerCall=0,recommendedMetro,recommendedTail=150,stationDuration=750,stationLegs,sharedCache,refresh=false}={}){
  const calls=[],work=[],requests=[],stationRequests=[];
  let elapsed=0,budget,accessIndex=0;
  const deadline=deadlineController??new AbortController();
  const advance=()=>{elapsed+=elapsedPerCall;if(elapsed>=budget)deadline.abort();};
  class MapApiError extends Error{constructor(message,code){super(message);this.code=code;}}
  const stations=Array.from({length:stationCount},(_,i)=>({id:`nanyou-${i}`,name:i?`南油${i}`:'南油',location:point}));
  const plans=Object.fromEntries(offices.map(office=>[office.id,Object.fromEntries(stations.map(station=>[station.id,{id:`${office.id}-${station.id}`,
    stationId:station.id,stationName:station.name,officeId:office.id,duration:fixed[0]+fixed[1],measuredAt,
    metroApi:{originName:station.name,destinationName:'粤海门'},legs:[
      leg('metro',fixed[0],point,[113.945531,22.532695],station.name+'站','粤海门站'),
      {...leg('walking',fixed[1],[113.945531,22.532695],staleOfficeEndpoint?[113.947837,22.528476]:office.entrance,'粤海门E口',office.name),routingIdentity:staleRoutingIdentity?undefined:'poi',originPoiId:'B0EXIT0001',destinationPoiId:office.poiId}]}]))]));
  const entries={...Object.fromEntries(stations.map((station,n)=>[station.id,Array.from({length:entryCount},(_,i)=>({id:`B0ENTRY${n}${i}`,name:unnamedAccess?'南油地铁站出入口':`南油地铁站${n}-${i}口`,location:[point[0]+i*.0001,point[1]+n*.0002],source:'amap'}))])),
    yuehaimen:[{id:'B0EXIT0001',name:'粤海门E口',location:[113.945531,22.532695],source:'amap'}]};
  const dependencies={
    '@/public/data/offices.json':{default:offices},
    '@/data/metro-index.json':{default:{complete:true,methodVersion:'amap-station-pair-v3',durationRounding:commute.DURATION_ROUNDING_VERSION,plans,entries}},
    '@/lib/local-access-server':{async localAccessTimes(origin,targets){work.push('local-model');if(localDeadline){deadline.abort();return new Promise(()=>{});}if(localFailure)throw new Error('unavailable');return {times:targets.map(()=>({walking:modelAccess,bicycling:modelAccess})),elapsedMs:1,osmDate:'2026-11-07'};}},
    '@/lib/segmented-search':segmentedSearch,
    '@/lib/metro-gates':metroGates,
    '@/lib/verification-cache':{
      verificationCacheKey:(...args)=>JSON.stringify(args),
      async readSharedVerification(key){const hit=sharedCache?.get(key);return hit?{...hit,reused:true,checked:0}:null;},
      async writeSharedVerification(key,result){if(result.complete&&result.plans.length)sharedCache?.set(key,result);},
    },
    '@/public/data/stations.json':{default:{stations:[...stations,{id:'yuehaimen',name:'粤海门',location:[113.945531,22.532695]}]}},
    '@/lib/commute':commute,
    '@/lib/amap-server':{
      MapApiError,METRO_DEPARTURE:{label:'2026-11-09 09:00'},
      async surfaceLeg(mode,origin,destination,from,to,options){
        const office=offices.find(o=>o.name===to);
        const tail=office&&from!=='测试小区门口';
        calls.push(`${tail?'tail':office?.id??'access'}:${mode}`);
        requests.push({mode,origin,destination,from,to,options});
        work.push(calls.at(-1));advance();
        const duration=tail?(recommendedTail!==null&&typeof recommendedTail==='object'?recommendedTail[mode]:recommendedTail):office?(surface[office.id]?.[mode]??(mode==='walking'?1830:1230)):(Array.isArray(access)?access[Math.min(accessIndex++,access.length-1)]:access);
        if(office&&abortAfterSurface)deadlineController.abort();
        if(duration==='error')throw new MapApiError('地图查询失败');
        if(duration?.error)throw new MapApiError('接驳查询暂未完成',duration.error);
        return duration===null?null:{...leg(mode,duration,origin,destination,from,to),...surfaceRouteParams(mode,origin,destination,options).endpoints};
      },
      async fullMetro(origin,destination,from,to,options){
        const office=offices.find(o=>o.name===to);
        calls.push(`${office.id}:direct`);
        work.push(calls.at(-1));advance();
        const duration=direct[office.id]??1230;
        if(duration==='error')throw new MapApiError('完整地铁查询失败');
        return {...leg('metro',duration,origin,destination,from,to),kind:'full-transit',recommendedMetro,...transitRouteParams(origin,destination,options).endpoints};
      },
      async stationMetro(origin,destination,options){
        calls.push('metro:stations');work.push(calls.at(-1));advance();
        stationRequests.push({origin,destination,options});
        if(stationDuration?.error)throw new MapApiError('站间查询暂未完成',stationDuration.error);
        if(stationDuration===null)return null;
        return {legs:stationLegs??[leg('metro',stationDuration,origin.location,destination.location,origin.name+'站',destination.name+'站')],originalTotalDuration:stationDuration,measuredAt};
      }
    }
  };
  const signals={any:signals=>AbortSignal.any(signals),timeout:ms=>{budget=ms;return deadline.signal;}};
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
    body:JSON.stringify({location:point,name:'测试小区门口',officeIds,poiId,refresh})
  }));
  assert.equal(response.status,200);
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type,'done');
  assert.ok(!events.some(e=>e.type==='error'));
  return {calls,work,requests,stationRequests,elapsed,events,results:events.filter(e=>e.type==='office-result').map(e=>e.result)};
}

test('a complete result is reused across requests without spending more AMap calls',async()=>{
  const sharedCache=new Map();
  const initial=await verify({sharedCache,surface:{innovation:{walking:1200}}});
  const reused=await verify({sharedCache,officeIds:['innovation','prince'],surface:{prince:{walking:1200}}});
  assert.deepEqual(reused.calls,['prince:walking','prince:bicycling']);
  assert.deepEqual(reused.events.filter(e=>e.type==='stage').map(e=>e.officeId),['prince']);
  assert.equal(reused.results[0].reused,true);
  assert.equal(reused.results[0].checked,0);
  assert.deepEqual(reused.results[0].plans,initial.results[0].plans);
});

test('explicit verification refreshes provider routes and replaces the shared result',async()=>{
  const sharedCache=new Map();
  await verify({sharedCache,surface:{innovation:{walking:1200}}});
  const refreshed=await verify({sharedCache,refresh:true,surface:{innovation:{walking:1800}}});
  assert.equal(refreshed.results[0].reused,undefined);
  assert.ok(refreshed.requests.length&&refreshed.requests.every(r=>r.options.refresh===true));
  const reused=await verify({sharedCache});
  assert.deepEqual(reused.calls,[]);
  assert.equal(reused.results[0].plans.find(p=>p.mode==='walking').duration,1800);
});

test('a failed refresh returns the previous complete result without replacing it',async()=>{
  const sharedCache=new Map();
  const original=await verify({sharedCache,surface:{innovation:{walking:1200}}});
  const failed=await verify({sharedCache,refresh:true,surface:{innovation:{walking:'error',bicycling:'error'}},direct:{innovation:'error'},access:900});
  assert.ok(failed.calls.length);
  assert.equal(failed.results[0].reused,true);
  assert.deepEqual(failed.results[0].plans,original.results[0].plans);
  assert.match(failed.results[0].errors[0],/已保留上次结果/);
  const next=await verify({sharedCache});
  assert.deepEqual(next.results[0].errors,[]);
});

const recommendation=()=>({entry:{stationName:'南油',name:'南油地铁站0-1口',location:[point[0]+.0001,point[1]]},
  exit:{stationName:'粤海门',name:'粤海门E口',location:[113.945531,22.532695]}});

test('the complete journey gates are proved before loading or ranking the local road network',async()=>{
  const rec=recommendation();
  const {calls,work,requests,stationRequests,results:[result]}=await verify({recommendedMetro:rec,entryCount:2});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct','metro:stations','access:walking','tail:walking']);
  assert.equal(stationRequests[0].origin.id,'nanyou-0');
  assert.deepEqual(stationRequests[0].origin.location,point);
  assert.notDeepEqual(stationRequests[0].origin.location,rec.entry.location);
  assert.equal(stationRequests[0].destination.id,'yuehaimen');
  assert.ok(!work.includes('local-model'));
  const plan=result.plans.find(p=>p.id==='innovation-metro-recommended');
  assert.ok(plan.qualified);
  assert.equal(plan.duration,1140);
  assert.deepEqual(plan.legs.map(l=>l.duration),[180,780,180]);
  assert.equal(requests[2].to,rec.entry.name);
  assert.equal(requests[2].options.destinationPoiId,'B0ENTRY01');
  assert.equal(requests[3].from,rec.exit.name);
  assert.equal(requests[3].options.originPoiId,'B0EXIT0001');
  const rail=new URL(commute.mapLink(plan.legs[1]));
  assert.equal(rail.searchParams.get('sid'),'nanyou-0');
  assert.equal(rail.searchParams.get('did'),'yuehaimen');
  assert.equal(result.plans.find(p=>p.metroMethod==='full').legs[0].recommendedMetro,undefined);
});

test('recommended gates compare mixed walking/cycling at both ends before trying other stations',async()=>{
  const {calls,work,results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,access:[600,200],recommendedTail:{walking:150,bicycling:500}});
  assert.deepEqual(calls.slice(3),['metro:stations','access:walking','tail:walking','access:bicycling','tail:bicycling']);
  assert.ok(!work.includes('local-model'));
  const plan=result.plans.find(p=>p.id==='innovation-metro-recommended');
  assert.ok(plan.qualified);
  assert.deepEqual(plan.legs.map(l=>l.mode),['bicycling','metro','walking']);
  assert.equal(plan.duration,1140);
});

test('recommended egress uses the exact API gate even when the prepared best tail differs',async()=>{
  const rec=recommendation();
  rec.exit={...rec.exit,name:'粤海门地铁站G口',location:[113.9458,22.5323]};
  const {requests,results:[result]}=await verify({recommendedMetro:rec,entryCount:2});
  const tail=result.plans.find(p=>p.id==='innovation-metro-recommended').legs.at(-1);
  assert.deepEqual(tail.origin,rec.exit.location);
  assert.equal(tail.from,rec.exit.name);
  assert.equal(tail.originPoiId,undefined); // Do not borrow the old E-gate POI.
  assert.equal(requests[3].options.destinationPoiId,'B0OFFICE01');
});

test('generic gate hints are resolved before querying access and egress, retaining station-pair rail',async()=>{
  const rec=recommendation();
  rec.entry={...rec.entry,name:'南油地铁站出入口',location:[point[0]+.00009,point[1]+.00001]};
  rec.exit={...rec.exit,name:'粤海门地铁站出入口',location:[113.9456,22.5328]};
  const {requests,stationRequests,work,results:[result]}=await verify({recommendedMetro:rec,entryCount:3,poiId:'B0HOME0001'});
  assert.ok(!work.includes('local-model'));
  assert.deepEqual(stationRequests.map(r=>[r.origin.name,r.destination.name]),[['南油','粤海门']]);
  const accessRequests=requests.filter(r=>r.from==='测试小区门口'&&!offices.some(o=>o.name===r.to));
  assert.equal(accessRequests.length,2);
  assert.deepEqual(accessRequests.map(r=>r.options.destinationPoiId),['B0ENTRY01','B0ENTRY00']);
  assert.ok(requests.every(r=>!r.from.includes('出入口')&&!r.to.includes('出入口')));
  const plan=result.plans.find(p=>p.id==='innovation-metro-recommended');
  assert.ok(plan.qualified);
  const tail=plan.legs.at(-1);
  assert.equal(tail.from,'粤海门E口');
  assert.equal(tail.originPoiId,'B0EXIT0001');
  assert.deepEqual(tail.origin,[113.945531,22.532695]);
  assert.notDeepEqual(tail.origin,rec.exit.location);
  const qr=new URL(reviewRoutes(plan,'ios').at(-1).url);
  assert.equal(qr.searchParams.get('sname'),'粤海门E口');
  assert.equal(qr.searchParams.get('sid'),'B0EXIT0001');
});

test('fallback ranking never queries an unnumbered entrance',async()=>{
  const {calls,results:[result]}=await verify({unnamedAccess:true});
  assert.ok(!calls.some(c=>c.startsWith('access:')));
  assert.ok(!result.plans.some(p=>p.metroMethod==='segmented'));
  assert.equal(result.complete,false);
});

test('over-limit recommended gates remain visible and do not prevent trying the other combinations',async()=>{
  const {calls,work,requests,results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,access:[600,600,200]});
  assert.ok(work.indexOf('local-model')>work.indexOf('tail:bicycling'));
  const recommended=result.plans.find(p=>p.id==='innovation-metro-recommended');
  assert.equal(recommended.qualified,false);
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified));
  // The preferred gate is revisited by fallback ranking without another API call.
  assert.equal(requests.filter(r=>r.to==='南油地铁站0-1口'&&r.mode==='walking').length,1);
  assert.ok(calls.filter(c=>c.startsWith('access:')).length>2);
});

test('a failed recommended leg never becomes an estimated qualifying result',async()=>{
  const {work,results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,recommendedTail:null});
  assert.ok(work.includes('local-model'));
  assert.ok(!result.plans.some(p=>p.id==='innovation-metro-recommended'));
  assert.ok(result.plans.some(p=>p.qualified));
});

test('recommended segmentation takes rail time from the separate station query',async()=>{
  const {results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,stationDuration:600});
  const plan=result.plans.find(p=>p.id==='innovation-metro-recommended');
  assert.equal(plan.legs[1].rawDuration,600);
  assert.equal(plan.duration,960);
  assert.equal(plan.originalReferenceScope,'stations');
  for(const platform of ['ios','android']){
    const middle=reviewRoutes(plan,platform).find(r=>r.id==='metro');
    const params=new URL(middle.url).searchParams;
    assert.equal(params.get('sname'),'南油(地铁站)');
    assert.equal(params.get('dname'),'粤海门(地铁站)');
    assert.equal(params.get('sid'),'nanyou-0');
    assert.equal(params.get('did'),'yuehaimen');
    assert.equal(params.get('t'),'1');
    assert.deepEqual(middle.leg.origin,point);
  }
});

test('an unavailable station-pair result never reuses home-to-office rail fields',async()=>{
  const {calls,results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,stationDuration:null});
  assert.ok(calls.includes('metro:stations'));
  assert.ok(!result.plans.some(p=>p.id==='innovation-metro-recommended'));
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified));
});

for(const [mode,duration] of [['walking',1800],['bicycling',1200]]){
  test(`${mode} meets its inclusive threshold: neither metro stage is requested`,async()=>{
    const {calls,work,events,results:[result]}=await verify({surface:{innovation:{[mode]:duration}}});
    assert.deepEqual(calls,['innovation:walking','innovation:bicycling']);
    assert.ok(!work.includes('local-model'));
    assert.equal(result.checked,2);
    assert.ok(result.plans.some(p=>p.mode===mode&&p.qualified));
    assert.ok(events.filter(e=>e.type==='plan').every(e=>e.plan.mode!=='metro'));
    assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>[e.officeId,e.stage]),[['innovation','surface']]);
  });
}

test('direct metro runs after both surface routes fail and skips segmented queries at 20 minutes',async()=>{
  const {calls,work,events,results:[result]}=await verify({direct:{innovation:1200}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct']);
  assert.equal(result.checked,3);
  assert.ok(!work.includes('local-model'));
  assert.equal(result.plans.find(p=>p.qualified)?.metroMethod,'full');
  assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>e.stage),['surface','metro-full']);
});

test('segmented metro runs only after the direct total exceeds 20 minutes',async()=>{
  const {calls,work,events,results:[result]}=await verify({direct:{innovation:1230}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct','access:walking']);
  assert.deepEqual(work,['innovation:walking','innovation:bicycling','innovation:direct','local-model','access:walking']);
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
  assert.equal(result.complete,true);
  assert.deepEqual(result.errors,[]);
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

test('local combinations are ranked before continuing beyond three AMap access proofs',async()=>{
  const {calls,events,results:[result]}=await verify({entryCount:40,stationCount:3,access:900});
  assert.ok(calls.filter(call=>call.startsWith('access:')).length>3);
  assert.equal(result.localSearch.total,240);
  assert.equal(result.localSearch.source,'model');
  assert.equal(result.complete,true);
  assert.deepEqual(result.errors,[]);
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
  assert.equal(result.complete,true);
  assert.deepEqual(result.errors,[]);
});

test('finishing all selected candidate queries reports completion even when every API route exceeds the limit',async()=>{
  const {results:[result]}=await verify({access:900,entryCount:4});
  assert.equal(result.complete,true);
  assert.ok(result.plans.length>0);
  assert.ok(result.plans.every(p=>!p.qualified));
  assert.deepEqual(result.errors,[]);
});

test('screening out long model estimates does not pretend that the completed query failed',async()=>{
  const {calls,results:[result]}=await verify({access:900,entryCount:4,modelAccess:2400});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,1); // Protected nearest walking gate.
  assert.equal(result.complete,true);
  assert.ok(result.plans.every(p=>!p.qualified));
  assert.deepEqual(result.errors,[]);
});

test('an access API failure preserves the complete local comparison and earlier results',async()=>{
  const {calls,results:[result]}=await verify({entryCount:40,access:'error'});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,1);
  assert.equal(result.localSearch.total,80);
  assert.equal(result.plans.length,3);
  assert.equal(result.complete,false);
});

test('the total deadline stops later APIs and avoids loading the model after cancellation',async()=>{
  const controller=new AbortController();
  const {calls,work,results:[result]}=await verify({entryCount:40,deadlineController:controller,abortAfterSurface:true});
  assert.deepEqual(calls,['innovation:walking']);
  assert.equal(result.localSearch,undefined);
  assert.ok(!work.includes('local-model'));
  assert.equal(result.complete,false);
  assert.ok(result.errors.includes('高德核验超时，已有结果已保留。'));
});

test('sequential hosted API calls can finish beyond 25 seconds while streaming earlier results',async()=>{
  const {elapsed,events,results:[result]}=await verify({elapsedPerCall:7000});
  assert.ok(elapsed>25000&&elapsed<60000);
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified));
  assert.deepEqual(result.errors,[]);
  assert.equal(result.complete,true);
  assert.ok(events.findIndex(e=>e.type==='plan')<events.findIndex(e=>e.type==='stage'&&e.stage==='metro-full'));
});

test('the overall deadline still bounds slow verification and retains completed plans',async()=>{
  const {elapsed,calls,results:[result]}=await verify({elapsedPerCall:9000,access:900,entryCount:40});
  assert.equal(elapsed,63000);
  assert.equal(calls.length,7);
  assert.equal(result.complete,false);
  assert.ok(result.plans.some(p=>p.mode==='walking'));
  assert.ok(result.errors.includes('高德核验超时，已有结果已保留。'));
});

test('the deadline also closes the stream when the local network has not finished loading',{timeout:1000},async()=>{
  const {calls,results:[result]}=await verify({localDeadline:true});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,0);
  assert.ok(result.errors.includes('高德核验超时，已有结果已保留。'));
  assert.ok(!result.errors.includes('本地路网暂不可用，已保留高德结果。'));
  assert.ok(result.plans.length>0);
});

test('a qualifying fourth access proof is not discarded by a fixed query cap',async()=>{
  const {calls,results:[result]}=await verify({entryCount:4,stationCount:3,access:[900,900,900,200]});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,4);
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified));
});

test('a transient access timeout does not prevent checking the next candidate',async()=>{
  const {calls,results:[result]}=await verify({entryCount:4,access:[{error:'REQUEST_TIMEOUT'},200]});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,2);
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified));
});

test('a quota error stops access queries rather than consuming the remaining minute',async()=>{
  const {calls,results:[result]}=await verify({entryCount:4,access:[{error:'BUDGET_LIMIT'},200]});
  assert.equal(calls.filter(call=>call.startsWith('access:')).length,1);
  assert.ok(!result.plans.some(p=>p.qualified));
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
  assert.ok(result.errors.includes('当前工区的地铁分段数据未就绪，已保留其他路线结果。'));
});

test('a POI-based office rejects coordinate-only fixed walks even when their coordinates match',async()=>{
  const {calls,results:[result]}=await verify({staleRoutingIdentity:true});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct']);
  assert.ok(!result.plans.some(plan=>plan.metroMethod==='segmented'));
  assert.ok(!result.plans.some(plan=>plan.qualified));
});
