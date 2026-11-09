import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createContext,SourceTextModule,SyntheticModule} from 'node:vm';
import ts from 'typescript';
import * as commute from '../lib/commute.ts';
import * as routeParams from '../lib/amap-route-params.ts';

const source=ts.transpileModule(readFileSync(new URL('../lib/amap-server.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
}).outputText;
const schema=readFileSync(new URL('../drizzle/0000_heavy_omega_sentinel.sql',import.meta.url),'utf8');

// Run the production SQL against SQLite, with virtual time and no paid API calls.
async function harness({limit='100',upstream,onWait}={}){
  const db=new DatabaseSync(':memory:');db.exec(schema);
  let now=Date.parse('2026-11-09T01:00:00Z');
  const deadlines=[],requests=[],queries=[],logs=[];
  const advance=ms=>{
    now+=ms;
    for(const timer of deadlines)if(timer.at<=now)timer.controller.abort();
  };
  class ClockDate extends Date {
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return now;}
  }
  const signals={
    any:signals=>AbortSignal.any(signals),
    timeout(ms){const controller=new AbortController();deadlines.push({at:now+ms,controller});return controller.signal;}
  };
  const env={AMAP_WEB_KEY:'test-secret',AMAP_APP_MONTHLY_LIMIT:limit,DB:{
    prepare(sql){return {bind(...values){return {
      async first(){queries.push(sql);return db.prepare(sql).get(...values)??null;},
      async run(){queries.push(sql);return db.prepare(sql).run(...values);}
    };}};}
  }};
  const context=createContext({Date:ClockDate,URLSearchParams,AbortSignal:signals,
    console:{warn:(...args)=>logs.push(args),info:(...args)=>logs.push(args)},
    setTimeout(fn,ms){const timer={cancelled:false};queueMicrotask(()=>{if(!timer.cancelled){onWait?.();advance(ms);fn();}});return timer;},
    clearTimeout(timer){timer.cancelled=true;},
    async fetch(url,options){
      requests.push({url,signal:options.signal,at:now});
      if(upstream)return upstream({advance,options,number:requests.length});
      return Response.json({status:'1',route:{paths:[]}});
    }
  });
  const dependencies={'cloudflare:workers':{env},'node:crypto':{createHash},'./commute':commute,
    './full-metro':{fullMetroLeg:()=>null},'./amap-route-params':routeParams};
  const module=new SourceTextModule(source,{context});
  await module.link(specifier=>{
    const exports=dependencies[specifier];assert.ok(exports);
    return new SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value);},{context});
  });
  await module.evaluate();
  return {api:module.namespace,db,requests,queries,logs,advance,signals};
}

test('cached routes return without a second upstream call or spending more quota',async()=>{
  const h=await harness();
  try{
    const first=await h.api.amap('v5/direction/walking',{origin:'test',destination:'office'});
    const cached=await h.api.amap('v5/direction/walking',{destination:'office',origin:'test'});
    assert.equal(first.cached,false);assert.equal(cached.cached,true);
    assert.equal(h.requests.length,1);
    assert.equal(h.db.prepare("SELECT count FROM api_usage WHERE bucket='2026-11:routes'").get().count,1);
    assert.deepEqual(JSON.parse(JSON.stringify(cached.data)),JSON.parse(JSON.stringify(first.data)));
  }finally{h.db.close();}
});

test('atomic budget reservation never exceeds the configured cap across simultaneous misses',async()=>{
  const h=await harness({limit:'2'});
  try{
    const results=await Promise.allSettled(Array.from({length:6},(_,i)=>h.api.amap('v5/direction/walking',{origin:i})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
    assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='BUDGET_LIMIT'));
    assert.equal(h.requests.length,2);
    assert.equal(h.db.prepare("SELECT count FROM api_usage WHERE bucket='2026-11:routes'").get().count,2);
  }finally{h.db.close();}
});

test('request slots preserve spacing and an idle queue starts from current time',async()=>{
  const h=await harness();
  try{
    await h.api.amap('test',{origin:1});
    await h.api.amap('test',{origin:2});
    assert.ok(h.requests[1].at-h.requests[0].at>=650);
    h.advance(5000);
    await h.api.amap('test',{origin:3});
    assert.ok(h.requests[2].at-h.requests[1].at>=5650);
  }finally{h.db.close();}
});

test('a timed-out individual route does not cancel subsequent route queries',async()=>{
  const h=await harness({upstream({advance,options,number}){
    if(number===1){advance(8100);if(options.signal.aborted)throw new Error('aborted');}
    return Response.json({status:'1'});
  }});
  try{
    const overall=h.signals.timeout(25000);
    await assert.rejects(h.api.amap('test',{origin:1},'routes',{signal:overall}),{code:'REQUEST_TIMEOUT'});
    assert.equal(overall.aborted,false);
    const next=await h.api.amap('test',{origin:2},'routes',{signal:overall});
    assert.equal(next.data.status,'1');
    assert.equal(h.requests.length,2);
  }finally{h.db.close();}
});

test('cancelling the overall query stops queued work before contacting AMap',async()=>{
  const overall=new AbortController();
  const h=await harness({onWait:()=>overall.abort()});
  try{
    await assert.rejects(h.api.amap('test',{origin:1},'routes',{signal:overall.signal}),{code:'TIME_BUDGET'});
    assert.equal(h.requests.length,0);
    assert.ok(h.queries.some(sql=>sql.includes('request-slot')));
  }finally{h.db.close();}
});
