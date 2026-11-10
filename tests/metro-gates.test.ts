import test from "node:test";
import assert from "node:assert/strict";
import {hasGateNumber,recommendedStreetGates} from "../lib/metro-gates.ts";
import type {Coord} from "../lib/commute.ts";

const entries=[
  {id:"BX09906574",name:"科苑地铁站C口",location:[113.947267,22.527251] as Coord,source:"amap"},
  {id:"BX09913896",name:"科苑地铁站出入口",location:[113.946909,22.527693] as Coord,source:"amap"},
  {id:"BX09906576",name:"科苑地铁站D口",location:[113.945471,22.527671] as Coord,source:"amap"},
  {id:"BX09906573",name:"科苑地铁站B口",location:[113.947109,22.526875] as Coord,source:"amap"},
];

test("numbered exits include letters, sub-exits and numbered channels, excluding generic entrances",()=>{
  for(const name of ["科苑地铁站C口","南油地铁站F2口","地铁站1号口","南油西地铁站C通道口"])assert.equal(hasGateNumber(name),true,name);
  for(const name of ["科苑地铁站出入口","前湾地铁站无障碍出入口","深云地铁站入口","南油(地铁站)"])assert.equal(hasGateNumber(name),false,name);
});

test("a generic gate selects nearby numbered POIs using their real coordinates and IDs",()=>{
  const hint={stationName:"科苑",name:entries[1].name,location:entries[1].location};
  const selected=recommendedStreetGates(hint,entries);
  assert.deepEqual(selected.map(g=>g.id),["BX09906574","BX09906573"]);
  for(const gate of selected){
    const actual=entries.find(e=>e.id===gate.id)!;
    assert.equal(gate.name,actual.name);
    assert.deepEqual(gate.location,actual.location);
    assert.notDeepEqual(gate.location,hint.location);
  }
});

test("an explicit recommended gate keeps its endpoint and never borrows an ID at another location",()=>{
  const exact={stationName:"科苑",name:entries[0].name,location:entries[0].location};
  assert.equal(recommendedStreetGates(exact,entries)[0].id,entries[0].id);
  const other={...exact,location:[113.948,22.528] as Coord};
  assert.deepEqual(recommendedStreetGates(other,entries),[{...other,id:undefined}]);
});

test("a generic gate without a mapped numbered exit never fabricates an endpoint",()=>{
  const hint={stationName:"科苑",name:entries[1].name,location:entries[1].location};
  assert.deepEqual(recommendedStreetGates(hint,[entries[1],{...entries[0],source:"model"}]),[]);
});
