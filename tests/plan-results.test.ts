import test from 'node:test';
import assert from 'node:assert/strict';
import {visiblePlans} from '../lib/plan-results.ts';
import type {Plan} from '../lib/commute.ts';

const plan=(id:string,minutes:number,metroMethod?:'full'|'segmented'):Plan=>({id,officeId:'innovation',mode:metroMethod?'metro':'bicycling',metroMethod,
  title:metroMethod==='segmented'?`经${id}站`:id,duration:minutes*60,limit:1200,qualified:minutes<=20,source:'amap',measuredAt:'2026-11-09T01:00:00Z',
  legs:[{mode:metroMethod?'metro':'bicycling',label:id,from:metroMethod==='segmented'?`${id}站`:'小区',to:'工区',origin:[113.94,22.52],destination:[113.95,22.53],duration:minutes*60,distance:1000,paths:[],source:'amap'}]});

test('long segmented detours collapse to the shortest measured alternative',()=>{
  const input=[plan('科苑',49,'segmented'),plan('粤海门',50,'segmented'),plan('深大',53,'segmented'),plan('高新南',55,'segmented'),plan('红树湾南',74,'segmented')];
  assert.deepEqual(visiblePlans(input).map(p=>p.id),['科苑']);
  assert.equal(input.length,5);
});

test('qualified segmented results replace unnecessary over-limit detours',()=>{
  const result=visiblePlans([plan('慢',49,'segmented'),plan('可达',20,'segmented'),plan('更快',18,'segmented')]);
  assert.deepEqual(result.map(p=>p.id),['更快','可达']);
});

test('distinct surface and full metro options remain available and sorted',()=>{
  const surface=plan('骑行',27),direct=plan('完整方案',23,'full'),short=plan('水湾',24,'segmented'),long=plan('湾厦',31,'segmented');
  assert.deepEqual(visiblePlans([surface,long,direct,short]).map(p=>p.id),['完整方案','水湾','骑行']);
});

test('invalid station names are rejected before choosing the shortest segmented result',()=>{
  const invalid=plan('错误',1,'segmented');invalid.legs[0].from='其他站';
  assert.deepEqual(visiblePlans([invalid,plan('正确',22,'segmented')]).map(p=>p.id),['正确']);
  assert.deepEqual(visiblePlans(),[]);
});
