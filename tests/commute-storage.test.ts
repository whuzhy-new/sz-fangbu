import test from "node:test";
import assert from "node:assert/strict";
import {placeKey,readPreferences,readSavedPlaces,rememberPlace,toggleFavorite} from "../lib/commute-storage.ts";
import type {Place} from "../lib/commute.ts";

const point=(name:string,index=0):Place=>({id:name,name,address:"南山区",location:[113.94+index*.001,22.53]});

test("preferences keep the office and unchecked layers, while invalid fields use defaults",()=>{
  assert.deepEqual(readPreferences(JSON.stringify({version:1,officeId:"prince",layers:{walking:false,bicycling:false,metro:false}})),{officeId:"prince",layers:{walking:false,bicycling:false,metro:false}});
  assert.deepEqual(readPreferences(JSON.stringify({version:1,officeId:"unknown",layers:{walking:"false",metro:false}})),{officeId:"innovation",layers:{walking:true,bicycling:true,metro:false}});
});

test("missing, corrupt and unsupported storage versions remain usable",()=>{
  for(const value of [null,"{",'[]','{"version":2,"recent":[{}]}']) {
    assert.deepEqual(readSavedPlaces(value),{recent:[],favorites:[]});
    assert.equal(readPreferences(value).officeId,"innovation");
  }
});

test("saved places reject invalid coordinates and never restore route conclusions",()=>{
  const valid={...point("小区"),qualified:true,plans:[{duration:1}],entrance:[200,90]};
  const data=readSavedPlaces(JSON.stringify({version:1,recent:[valid,{...point("外地"),location:[0,0]},{...point("空名"),name:" "}],favorites:[null,valid]}));
  assert.deepEqual(data.recent,[point("小区")]);
  assert.deepEqual(data.favorites,[point("小区")]);
});

test("recent places identify entrances rather than shared POI ids, and keep the eight most recent",()=>{
  let recent:Place[]=[];
  for(let i=0;i<10;i++)recent=rememberPlace(recent,{...point(`地点${i}`,i),id:"map-point"});
  assert.equal(recent.length,8);
  assert.equal(recent[0].name,"地点9");
  const revisited={...point("入口新名称",5),id:"map-point"};
  recent=rememberPlace(recent,revisited);
  assert.equal(recent[0].name,"入口新名称");
  assert.equal(recent.filter(p=>placeKey(p)===placeKey(revisited)).length,1);
});

test("favorites survive recent-history clearing and can be removed using the same entrance",()=>{
  const a=point("甲小区"),b=point("乙小区",1);
  const favorites=toggleFavorite(toggleFavorite([],a),b);
  const restored=readSavedPlaces(JSON.stringify({version:1,recent:[],favorites:[...favorites,a]}));
  assert.equal(restored.favorites.length,2);
  assert.equal(restored.recent.length,0);
  assert.deepEqual(toggleFavorite(restored.favorites,{...a,name:"甲小区南门"}),[b]);
});

test("POI identity survives saved-place restoration without assigning an ID to anonymous map points",()=>{
  const known={...point("地图上的小区"),id:"map-point",kind:"map",poiId:"B0HOME0001"};
  const legacy={...point("之前搜过的小区",1),id:"B0HOME0002"};
  const anonymous={...point("拖动后的地点",2),id:"map-point",kind:"map",poiId:"invalid-id"};
  const data=readSavedPlaces(JSON.stringify({version:1,recent:[known,legacy,anonymous]}));
  assert.equal(data.recent[0].poiId,"B0HOME0001");
  assert.equal(data.recent[1].poiId,"B0HOME0002");
  assert.equal(data.recent[2].poiId,undefined);
});
