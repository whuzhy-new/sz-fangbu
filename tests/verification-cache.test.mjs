import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createContext,SourceTextModule,SyntheticModule} from 'node:vm';
import ts from 'typescript';

const src=ts.transpileModule(readFileSync(new URL('../lib/verification-cache.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const schema=readFileSync(new URL('../drizzle/0000_heavy_omega_sentinel.sql',import.meta.url),'utf8');
const start=Date.parse('2026-11-10T00:00:00Z');
const point=[113.925797,22.510346];
const result=(duration=1200)=>({officeId:'innovation',complete:true,checked:2,errors:[],measuredAt:new Date(start).toISOString(),plans:[{
  id:'innovation-walking',duration,legs:[{from:'访客自定义地点',origin:point,to:'深圳湾 T2',duration}],
}]});

async function harness(){
  const db=new DatabaseSync(':memory:');db.exec(schema);
  let now=start;
  class Clock extends Date {static now(){return now;}}
  const context=createContext({Date:Clock,TextEncoder,console});
  const env={DB:{prepare(sql){return {bind(...params){return {
    async first(){return db.prepare(sql).get(...params)??null;},
    async run(){return db.prepare(sql).run(...params);},
  };}};}}};
  const modules={'cloudflare:workers':{env},'node:crypto':{createHash}};
  const mod=new SourceTextModule(src,{context});
  await mod.link(name=>new SyntheticModule(Object.keys(modules[name]),function(){
    for(const [key,value] of Object.entries(modules[name]))this.setExport(key,value);
  },{context}));
  await mod.evaluate();
  return {db,cache:mod.namespace,advance(ms){now+=ms;}};
}

test('shared keys isolate office, real entrance, POI routing identity and route version',async()=>{
  const {db,cache}=await harness();
  try {
    const key=cache.verificationCacheKey('innovation',point,'B0HOME0001','v1');
    assert.equal(cache.verificationCacheKey('innovation',[113.92579700001,22.510346],'B0HOME0001','v1'),key);
    assert.notEqual(cache.verificationCacheKey('prince',point,'B0HOME0001','v1'),key);
    assert.notEqual(cache.verificationCacheKey('innovation',[113.925812,22.510346],'B0HOME0001','v1'),key);
    assert.notEqual(cache.verificationCacheKey('innovation',point,undefined,'v1'),key);
    assert.notEqual(cache.verificationCacheKey('innovation',point,'B0HOME0001','v2'),key);
  }finally{db.close();}
});

test('a different visitor reuses the same plans with their own label until expiry',async()=>{
  const {db,cache,advance}=await harness();
  try {
    const key=cache.verificationCacheKey('innovation',point,'B0HOME0001','v1');
    await cache.writeSharedVerification(key,result(),start);
    const stored=db.prepare('SELECT payload FROM api_cache WHERE key=?').get(key).payload;
    assert.ok(!stored.includes('访客自定义地点'));
    const reused=await cache.readSharedVerification(key,'当前地点');
    assert.equal(reused.plans[0].legs[0].from,'当前地点');
    assert.equal(reused.plans[0].legs[0].to,'深圳湾 T2');
    assert.equal(reused.reused,true);
    assert.equal(reused.checked,0);
    advance(7*86400000);
    assert.equal(await cache.readSharedVerification(key,'当前地点'),null);
  }finally{db.close();}
});

test('a newer completed verification replaces the result; older or failed requests cannot overwrite it',async()=>{
  const {db,cache}=await harness();
  try {
    const key=cache.verificationCacheKey('innovation',point,'B0HOME0001','v1');
    await cache.writeSharedVerification(key,result(1200),start);
    await cache.writeSharedVerification(key,result(1140),start+2000);
    await cache.writeSharedVerification(key,result(1080),start+1000);
    await cache.writeSharedVerification(key,{...result(1020),complete:false,errors:['timeout']},start+3000);
    assert.equal((await cache.readSharedVerification(key,'当前地点')).plans[0].duration,1140);
    assert.equal(db.prepare('SELECT count(*) AS count FROM api_cache').get().count,1);
  }finally{db.close();}
});
