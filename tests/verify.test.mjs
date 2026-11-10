import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,SourceTextModule,SyntheticModule} from 'node:vm';
import ts from 'typescript';
import * as commute from '../lib/commute.ts';
import * as segmentedSearch from '../lib/segmented-search.ts';
import * as metroGates from '../lib/metro-gates.ts';
import * as coverageGeometry from '../lib/coverage.ts';
import {reviewRoutes} from '../lib/route-review.ts';
import {surfaceRouteParams,transitRouteParams} from '../lib/amap-route-params.ts';

// Exercise the real streaming handler with isolated map responses, without
// spending API quota or depending on Cloudflare bindings and live timetable data.
const handlerSource=ts.transpileModule(readFileSync(new URL('../app/api/verify/route.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
}).outputText;
const point=[113.925797,22.510346],measuredAt='2026-11-09T01:00:00.000Z';
const offices=[{id:'innovation',name:'创新工区',poiId:'B0OFFICE01',walkingIdentity:'poi',entrance:[113.947074,22.529024]},
  {id:'prince',name:'太子工区',poiId:'B0OFFICE02',entrance:[113.914019,22.484158]},
  {id:'jinghu',name:'景湖工区',poiId:'B0OFFICE03',entrance:[113.941052,22.511838]}];
const profiles=Object.fromEntries(offices.map(({id})=>[id,JSON.parse(readFileSync(new URL(`../data/office-profiles/${id}-fixed-egress.json`,import.meta.url),'utf8'))]));
const leg=(mode,duration,origin,destination,from,to)=>({mode,duration,origin,destination,from,to,
  label:mode,distance:100,paths:[],source:'amap',measuredAt});

async function verify({surface={},direct={},access=200,fixed=[720,150],officeIds=['innovation'],entryCount=1,stationCount=1,modelAccess=200,deadlineController,abortAfterSurface=false,localFailure=false,localDeadline=false,poiId,staleOfficeEndpoint=false,staleRoutingIdentity=false,unnamedAccess=false,elapsedPerCall=0,recommendedMetro,recommendedTail=150,stationDuration=720,stationLegs,sharedCache,refresh=false,fixedEgressOffices=[],arrival='粤海门',returnRoute,coverage=null}={}){
  const calls=[],work=[],requests=[],stationRequests=[],returnRequests=[];
  let elapsed=0,budget,accessIndex=0;
  const deadline=deadlineController??new AbortController();
  const advance=()=>{elapsed+=elapsedPerCall;if(elapsed>=budget)deadline.abort();};
  class MapApiError extends Error{constructor(message,code){super(message);this.code=code;}}
  const stations=Array.from({length:stationCount},(_,i)=>({id:`nanyou-${i}`,name:i?`南油${i}`:'南油',location:point}));
  const plans=Object.fromEntries(offices.map(office=>[office.id,Object.fromEntries(stations.map(station=>[station.id,{id:`${office.id}-${station.id}`,
    stationId:station.id,stationName:station.name,officeId:office.id,duration:fixed[0]+fixed[1],measuredAt,
    metroApi:{originName:station.name,destinationName:arrival},legs:[
      leg('metro',fixed[0],point,[113.945531,22.532695],station.name+'站',arrival+'站'),
      {...leg('walking',fixed[1],[113.945531,22.532695],staleOfficeEndpoint?[113.947837,22.528476]:office.entrance,arrival+'E口',office.name),routingIdentity:staleRoutingIdentity?undefined:'poi',originPoiId:'B0EXIT0001',destinationPoiId:office.poiId}]}]))]));
  const entries={...Object.fromEntries(stations.map((station,n)=>[station.id,Array.from({length:entryCount},(_,i)=>({id:`B0ENTRY${n}${i}`,name:unnamedAccess?'南油地铁站出入口':`南油地铁站${n}-${i}口`,location:[point[0]+i*.0001,point[1]+n*.0002],source:'amap'}))])),
    yuehaimen:[{id:'B0EXIT0001',name:'粤海门E口',location:[113.945531,22.532695],source:'amap'}]};
  const profileModules=Object.fromEntries(offices.map(office=>{
    const profile=profiles[office.id];
    return [`@/data/office-profiles/${office.id}-fixed-egress.json`,{default:fixedEgressOffices.includes(office.id)
      ?{...profile,officePoiId:office.poiId,officeEntrance:office.entrance}
      :profile}];
  }));
  const boarding=[113.945531,22.532695];
  const returnAccess=Object.fromEntries(offices.map(office=>[office.id,{'粤海门':{
    ...leg('walking',100,office.entrance,boarding,office.name,'粤海门E口'),
    originPoiId:office.poiId,destinationPoiId:'B0EXIT0001',routingIdentity:'poi',
  }}]));
  const returnPlans=Object.fromEntries(offices.map(office=>[office.id,returnRoute?.prepared?{'nanyou-0':{
    id:`${office.id}-nanyou-0-return`,stationId:'nanyou-0',stationName:'南油',officeId:office.id,
    duration:840,measuredAt,legs:[returnAccess[office.id]['粤海门'],leg('metro',720,boarding,point,'粤海门站','南油站')],
  }}:{}]));
  const dependencies={
    '@/public/data/offices.json':{default:offices},
    '@/public/data/coverage-bidirectional.json':{default:coverage},
    '@/lib/coverage':coverageGeometry,
    ...profileModules,
    '@/data/metro-index.json':{default:{complete:true,methodVersion:'amap-station-pair-v3',durationRounding:commute.DURATION_ROUNDING_VERSION,plans,entries}},
    '@/data/metro-return.json':{default:{complete:true,methodVersion:'amap-return-station-pair-v1',
      durationRounding:commute.DURATION_ROUNDING_VERSION,departureDate:'2026-11-09',departureTime:'09:00',
      plans:returnPlans,access:returnAccess,officeEndpoints:Object.fromEntries(offices.map(o=>[o.id,o]))}},
    '@/lib/local-access-server':{async localAccessTimes(origin,targets,url,toHome){work.push(toHome?'return-model':'local-model');if(localDeadline){deadline.abort();return new Promise(()=>{});}if(localFailure)throw new Error('unavailable');return {times:targets.map(()=>({walking:modelAccess,bicycling:modelAccess})),elapsedMs:1,osmDate:'2026-11-07'};}},
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
      MapApiError,METRO_DEPARTURE:{label:'2026-11-09 09:00',date:'2026-11-09',time:'09-00'},
      async surfaceLeg(mode,origin,destination,from,to,options){
        if(to==='测试小区门口'){
          returnRequests.push({mode,origin,destination,from,to,options});
          if(!returnRoute)return null;
          const fromOffice=offices.some(o=>o.name===from);
          const duration=fromOffice?returnRoute.surface?.[mode]:returnRoute.egress;
          if(duration==='error')throw new MapApiError('返程查询超时','REQUEST_TIMEOUT');
          return duration==null?null:{...leg(mode,duration,origin,destination,from,to),...surfaceRouteParams(mode,origin,destination,options).endpoints};
        }
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
        if(to==='测试小区门口'){
          returnRequests.push({mode:'metro-full',origin,destination,from,to,options});
          const duration=returnRoute?.full;
          return duration==null?null:{...leg('metro',duration,origin,destination,from,to),kind:'full-transit',recommendedMetro:returnRoute.recommendation,
            ...transitRouteParams(origin,destination,options).endpoints};
        }
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
  return {calls,work,requests,stationRequests,returnRequests,elapsed,events,results:events.filter(e=>e.type==='office-result').map(e=>e.result)};
}

test('a complete result is reused across requests without spending more AMap calls',async()=>{
  const sharedCache=new Map();
  const returnRoute={surface:{walking:1200}};
  const initial=await verify({sharedCache,surface:{innovation:{walking:1200}},returnRoute});
  const reused=await verify({sharedCache,officeIds:['innovation','prince'],surface:{prince:{walking:1200}},returnRoute});
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
  assert.equal(plan.duration,1080);
  assert.deepEqual(plan.legs.map(l=>l.duration),[180,720,180]);
  assert.equal(requests[2].to,rec.entry.name);
  assert.equal(requests[2].options.destinationPoiId,'B0ENTRY01');
  assert.equal(requests[3].from,rec.exit.name);
  assert.equal(requests[3].options.originPoiId,'B0EXIT0001');
  const rail=new URL(commute.mapLink(plan.legs[1]));
  assert.equal(rail.searchParams.get('sid'),'nanyou-0');
  assert.equal(rail.searchParams.get('did'),'yuehaimen');
  assert.equal(result.plans.find(p=>p.metroMethod==='full').legs[0].recommendedMetro,undefined);
});

test('Shenzhen Bay uses the fixed exit even when the full journey recommends a different exit',async()=>{
  const {calls,stationRequests,results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,poiId:'B0HOME0001',fixedEgressOffices:['innovation']});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct','metro:stations','access:walking']);
  assert.equal(stationRequests[0].destination.name,'粤海门');
  const plan=result.plans.find(p=>p.id==='innovation-metro-recommended');
  assert.deepEqual(plan.legs.at(-1),commute.roundLeg(profiles.innovation.routes['粤海门']));
  assert.equal(plan.duration,1020);
  assert.equal(result.plans.find(p=>p.metroMethod==='full').legs[0].destinationPoiId,offices[0].poiId);
});

test('prepared plans keep the fixed walking tail POIs and invalidate only the Shenzhen Bay cache',async()=>{
  const sharedCache=new Map();
  const args={sharedCache,officeIds:['innovation','prince'],arrival:'科苑',fixed:[720,300]};
  await verify(args);
  const {results:[innovation,prince]}=await verify({...args,fixedEgressOffices:['innovation']});
  assert.equal(innovation.reused,undefined);
  assert.equal(prince.reused,true);
  const plan=innovation.plans.find(p=>p.metroMethod==='segmented');
  assert.deepEqual(plan.legs.at(-1),commute.roundLeg(profiles.innovation.routes['科苑']));
  assert.equal(plan.duration,1080);
  assert.equal(plan.qualified,true);
  const cached=await verify({...args,fixedEgressOffices:['innovation']});
  assert.equal(cached.results[0].reused,true);
  assert.deepEqual(cached.results[0].plans.find(p=>p.id===plan.id),plan);
});

for(const [office,arrival] of [['prince','海上世界'],['jinghu','人才公园']]){
  test(`${office} applies its measured egress to the station-pair fallback`,async()=>{
    const {results:[result]}=await verify({officeIds:[office],arrival,fixedEgressOffices:['prince','jinghu']});
    const plan=result.plans.find(p=>p.metroMethod==='segmented');
    const tail=commute.roundLeg(profiles[office].routes[arrival]);
    assert.deepEqual(plan.legs.at(-1),tail);
    assert.equal(plan.duration,900+tail.duration);
  });
}

test('recommended gates compare mixed walking/cycling at both ends before trying other stations',async()=>{
  const {calls,work,results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,access:[600,200],recommendedTail:{walking:150,bicycling:500}});
  assert.deepEqual(calls.slice(3),['metro:stations','access:walking','tail:walking','access:bicycling','tail:bicycling']);
  assert.ok(!work.includes('local-model'));
  const plan=result.plans.find(p=>p.id==='innovation-metro-recommended');
  assert.ok(plan.qualified);
  assert.deepEqual(plan.legs.map(l=>l.mode),['bicycling','metro','walking']);
  assert.equal(plan.duration,1080);
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
    const {calls,work,events,results:[result]}=await verify({surface:{innovation:{[mode]:duration}},returnRoute:{surface:{[mode]:duration}}});
    assert.deepEqual(calls,['innovation:walking','innovation:bicycling']);
    assert.ok(!work.includes('local-model'));
    assert.equal(result.checked,4);
    assert.ok(result.plans.some(p=>p.mode===mode&&p.qualified));
    assert.ok(events.filter(e=>e.type==='plan').every(e=>e.plan.mode!=='metro'));
    assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>[e.officeId,e.stage]),[['innovation','surface']]);
  });
}

test('direct metro runs after both surface routes fail and skips segmented queries at 18 minutes',async()=>{
  const {calls,work,events,results:[result]}=await verify({direct:{innovation:1109},returnRoute:{full:1100}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct']);
  assert.equal(result.checked,6);
  assert.ok(!work.includes('local-model'));
  assert.equal(result.plans.find(p=>p.qualified)?.metroMethod,'full');
  assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>e.stage),['surface','metro-full']);
});

for(const rawDuration of [1110,1229]){
  test(`complete metro at ${commute.roundDuration(rawDuration)/60} minutes stays qualified while segmentation searches for a shorter route`,async()=>{
    const {events,results:[result]}=await verify({direct:{innovation:rawDuration}});
    assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>e.stage),['surface','metro-full','metro-segmented']);
    const full=result.plans.find(p=>p.metroMethod==='full');
    assert.ok(full.qualified);
    assert.equal(full.duration,commute.roundDuration(rawDuration));
    assert.equal(result.plans[0].metroMethod,'segmented');
    assert.equal(result.plans[0].duration,1080);
  });
}

test('recommended segmentation keeps looking after a 19-minute walking combination',async()=>{
  const {events,work,results:[result]}=await verify({recommendedMetro:recommendation(),entryCount:2,stationDuration:750,access:[200,120]});
  const measured=events.filter(e=>e.type==='plan'&&e.plan.id==='innovation-metro-recommended').map(e=>e.plan.duration);
  assert.deepEqual(measured,[1140,1080]);
  assert.ok(!work.includes('local-model'));
  assert.equal(result.plans[0].duration,1080);
});

test('ranked segmentation continues after a 19-minute proof and stops at 18 minutes',async()=>{
  const {calls,results:[result]}=await verify({fixed:[750,150],entryCount:3,access:[200,120]});
  assert.equal(calls.filter(c=>c.startsWith('access:')).length,2);
  assert.equal(result.plans[0].duration,1080);
  assert.equal(result.plans[0].metroMethod,'segmented');
});

test('a timed-out comparison retains the qualifying metro plan without caching an unfinished comparison',async()=>{
  const sharedCache=new Map();
  const {results:[result]}=await verify({direct:{innovation:1200},localDeadline:true,sharedCache});
  assert.ok(result.plans.some(p=>p.metroMethod==='full'&&p.qualified));
  assert.equal(result.complete,false);
  assert.match(result.errors.join(' '),/分段比较已到时限，已保留达标方案/);
  assert.equal(sharedCache.size,0);
});

test('segmented metro also runs when the complete metro route exceeds 20 minutes',async()=>{
  const {calls,work,events,results:[result]}=await verify({direct:{innovation:1230}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','innovation:direct','access:walking']);
  assert.deepEqual(work,['innovation:walking','innovation:bicycling','innovation:direct','local-model','access:walking']);
  assert.ok(result.plans.some(p=>p.metroMethod==='full'&&!p.qualified));
  assert.ok(result.plans.some(p=>p.metroMethod==='segmented'&&p.qualified&&p.duration===1080));
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

test('20 minutes 29 seconds rounds down and keeps the bicycling short-circuit',async()=>{
  const surface=await verify({surface:{innovation:{bicycling:1229}}});
  assert.deepEqual(surface.calls,['innovation:walking','innovation:bicycling']);
  const bike=surface.results[0].plans.find(p=>p.mode==='bicycling');
  assert.equal(bike.duration,1200);assert.equal(bike.legs[0].rawDuration,1229);
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
    surface:{innovation:{walking:1000}},direct:{prince:1000},returnRoute:{surface:{walking:1700}}});
  assert.deepEqual(calls,['innovation:walking','innovation:bicycling','prince:walking','prince:bicycling','prince:direct']);
  assert.deepEqual(results.map(r=>[r.officeId,r.checked]),[['innovation',4],['prince',5]]);
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

test('return-only cycling skips return metro and lets outbound continue',async()=>{
  const sharedCache=new Map(),poiId='B0HOME0001';
  const {calls,returnRequests,results:[result]}=await verify({sharedCache,poiId,access:1000,returnRoute:{surface:{bicycling:1180}}});
  assert.ok(calls.includes('innovation:direct'));
  assert.ok(calls.includes('access:walking'));
  assert.deepEqual(returnRequests.map(r=>r.mode),['walking','bicycling']);
  const plan=result.plans.find(p=>p.qualified);
  assert.equal(plan.direction,'to-home');
  assert.equal(plan.legs[0].from,offices[0].name);
  assert.equal(plan.legs[0].to,'测试小区门口');
  assert.equal(result.complete,true);
  assert.equal(sharedCache.size,2);
  const cached=await verify({sharedCache,poiId});
  assert.equal(cached.results[0].reused,true);
  assert.equal(cached.results[0].plans.find(p=>p.qualified).direction,'to-home');
  assert.equal(cached.returnRequests.length,0);
});

test('a return surface timeout and an over-limit outbound trip leave eligibility unresolved',async()=>{
  const {results:[result]}=await verify({access:1000,returnRoute:{surface:{walking:'error'}}});
  assert.equal(result.complete,false);
  assert.ok(result.errors.includes('返程查询超时'));
  assert.ok(!result.plans.some(p=>p.qualified));
});

test('a cached outbound failure still allows a fresh return result without replacing the outbound cache',async()=>{
  const sharedCache=new Map();
  await verify({sharedCache,access:1000});
  assert.equal(sharedCache.size,1);
  const [key,saved]=[...sharedCache.entries()][0];
  const {calls,results:[result]}=await verify({sharedCache,returnRoute:{surface:{bicycling:1190}}});
  assert.deepEqual(calls,[]);
  assert.equal(sharedCache.get(key),saved);
  assert.equal(sharedCache.size,2);
  assert.ok(result.plans.some(p=>p.qualified&&p.direction==='to-home'));
});

test('a qualifying cached outbound trip does not skip a fresh return segmented search',async()=>{
  const sharedCache=new Map();
  await verify({sharedCache,surface:{innovation:{walking:1200}}});
  const {calls,results:[result]}=await verify({sharedCache,returnRoute:{full:1160,prepared:true,egress:130}});
  assert.deepEqual(calls,[]);
  assert.ok(result.plans.some(p=>p.qualified&&p.direction!=='to-home'));
  assert.ok(result.plans.some(p=>p.qualified&&p.direction==='to-home'&&p.metroMethod==='segmented'));
  assert.equal(result.complete,true);
});

test('outside the surface buffers both directions start at metro without reusing surface cache entries',async()=>{
  const sharedCache=new Map();
  const surface={innovation:{walking:1200}};
  await verify({sharedCache,surface,returnRoute:{surface:{walking:1200}}});
  const geometry={type:'Polygon',coordinates:[[[114,22.5],[114.01,22.5],[114.01,22.51],[114,22.51],[114,22.5]]]};
  const coverage={metadata:{complete:true,durationRounding:commute.DURATION_ROUNDING_VERSION},
    features:['walking','bicycling'].map(mode=>({geometry,properties:{officeId:'innovation',mode}}))};
  const {calls,returnRequests,events,results:[result]}=await verify({
    sharedCache,surface,coverage,direct:{innovation:1080},returnRoute:{full:1080},
  });
  assert.deepEqual(calls,['innovation:direct']);
  assert.deepEqual(returnRequests.map(r=>r.mode),['metro-full']);
  assert.deepEqual(events.filter(e=>e.type==='stage').map(e=>e.stage),['metro-full']);
  assert.equal(events.find(e=>e.type==='office-start').stage,'metro-full');
  assert.ok(result.plans.every(p=>p.metroMethod==='full'&&p.qualified));
});

test('a borderline return full trip drills down using ordered rail and home-side egress',async()=>{
  const {work,stationRequests,returnRequests,results:[result]}=await verify({access:900,poiId:'B0HOME0001',
    returnRoute:{full:1160,egress:130,recommendation:{entry:recommendation().exit,exit:{...recommendation().entry,name:'南油地铁站0-0口',location:point}}}});
  const plan=result.plans.find(p=>p.metroMethod==='segmented'&&p.qualified);
  assert.equal(plan.direction,'to-home');
  assert.equal(plan.duration,960);
  assert.deepEqual(plan.legs.map(l=>[l.from,l.to]),[
    ['创新工区','粤海门E口'],['粤海门站','南油站'],['南油地铁站0-0口','测试小区门口'],
  ]);
  assert.equal(stationRequests[0].origin.name,'粤海门');
  assert.equal(stationRequests[0].destination.name,'南油');
  const egress=returnRequests.find(r=>r.from==='南油地铁站0-0口');
  assert.equal(egress.options.destinationPoiId,'B0HOME0001');
  assert.ok(work.filter(call=>call==='access:walking').length<2);
});

test('return fallback ranks gate-to-home and keeps its independent station proof',async()=>{
  const {work,returnRequests,results:[result]}=await verify({access:900,returnRoute:{prepared:true,egress:130}});
  assert.ok(work.includes('return-model'));
  assert.ok(returnRequests.some(r=>r.from.startsWith('南油地铁站')&&r.to==='测试小区门口'));
  const plan=result.plans.find(p=>p.qualified);
  assert.equal(plan.direction,'to-home');
  assert.equal(plan.legs[1].from,'粤海门站');
  assert.equal(plan.legs[1].to,'南油站');
});
