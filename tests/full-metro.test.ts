import test from 'node:test';
import assert from 'node:assert/strict';
import {fullMetroLeg} from '../lib/full-metro.ts';
import {sumLegDurations} from '../lib/commute.ts';

const station=(name:string,location:string)=>({name,location});
const fixture=()=>({cost:{duration:'1376'},distance:'5000',segments:[
  {walking:{cost:{duration:'225'},distance:'196'},bus:{buslines:[{
    type:'地铁线路',name:'地铁2号线(8号线)(赤湾--溪涌)',cost:{duration:'990'},distance:'4700',
    departure_stop:{...station('水湾','113.919686,22.488389'),entrance:{name:'C口',location:'113.920238,22.488635'}},
    arrival_stop:{...station('科苑','113.946195,22.527019'),exit:{name:'出入口',location:'113.946909,22.527693'}},
  }]}},
  {walking:{cost:{duration:'161'},distance:'149'}},
]});
const parse=(transit:unknown)=>fullMetroLeg({route:{transits:[transit]}} as Parameters<typeof fullMetroLeg>[0],[113.920468,22.488173],[113.947074,22.529024],'水湾商贸大厦','深圳湾 T2');

test('the full API route retains its actual gates while the original total remains intact',()=>{
  const full=parse(fixture())!;
  assert.equal(full.duration,1376);
  const rec=full.recommendedMetro!;
  assert.deepEqual(rec.entry,{stationName:'水湾',name:'水湾地铁站C口',location:[113.920238,22.488635]});
  assert.deepEqual(rec.exit,{stationName:'科苑',name:'科苑地铁站出入口',location:[113.946909,22.527693]});
  assert.deepEqual(rec.legs.map(l=>[l.mode,l.from,l.to,l.duration]),[['metro','水湾站','科苑站',990]]);
  assert.equal(sumLegDurations(rec.legs),1020); // No initial/final station walking or invented waiting.
});

test('intermediate transfer walks are kept and rounded as separate legs',()=>{
  const transit=fixture();
  const first=transit.segments[0].bus!.buslines[0];
  first.arrival_stop={...station('海上世界','113.914,22.486'),exit:{name:'A口',location:'113.9141,22.4861'}};
  first.cost.duration='300';
  transit.segments.splice(1,0,{
    walking:{cost:{duration:'91'},distance:'120'},
    bus:{buslines:[{...first,name:'地铁12号线(海上田园东--左炮台东)',cost:{duration:'600'},
      departure_stop:{...station('海上世界','113.914,22.486'),entrance:{name:'A口',location:'113.9141,22.4861'}},
      arrival_stop:{...station('科苑','113.946195,22.527019'),exit:{name:'出入口',location:'113.946909,22.527693'}},
    }]},
  });
  const rec=parse(transit)!.recommendedMetro!;
  assert.deepEqual(rec.legs.map(l=>[l.mode,l.kind,l.duration]),[['metro',undefined,300],['walking','transfer',91],['metro',undefined,600]]);
  assert.equal(sumLegDurations(rec.legs),1020);
});

test('missing gates or rail duration disable the shortcut without discarding the full route',()=>{
  for(const change of [
    (t:ReturnType<typeof fixture>)=>{t.segments[0].bus!.buslines[0].departure_stop.entrance.location='';},
    (t:ReturnType<typeof fixture>)=>{t.segments[0].bus!.buslines[0].arrival_stop.exit.location='bad';},
    (t:ReturnType<typeof fixture>)=>{t.segments[0].bus!.buslines[0].cost.duration='';},
  ]){
    const t=fixture();change(t);
    const full=parse(t)!;
    assert.equal(full.duration,1376);
    assert.equal(full.recommendedMetro,undefined);
  }
});

test('gate metadata follows the chosen fastest pure-metro journey',()=>{
  const slow=fixture(),fast=fixture();
  slow.cost.duration='1500';
  slow.segments[0].bus!.buslines[0].departure_stop.entrance.name='D口';
  const full=fullMetroLeg({route:{transits:[slow,fast]}},[113.92,22.48],[113.94,22.52],'小区','工区')!;
  assert.equal(full.duration,1376);
  assert.equal(full.recommendedMetro!.entry.name,'水湾地铁站C口');
});
