import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessCoverage,assessMapPick,coverageFeatures,COVERAGE_EDGE_METERS} from "../lib/coverage.ts";
import type {Coord,Mode} from "../lib/commute.ts";
import type {Coverage,CoverageGeometry} from "../lib/map-types.ts";

const square=(x:number,y:number,size:number):Coord[]=>[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const polygon:CoverageGeometry={type:"Polygon",coordinates:[square(0,0,10)]};
const modes:Mode[]=["walking","bicycling","metro"];
function fixture(geometry:CoverageGeometry=polygon):Coverage {
  return {type:"FeatureCollection",features:modes.map(mode=>({type:"Feature",geometry,properties:{officeId:"test",mode}})),
    metadata:{methodVersion:"amap-station-pair-v3",generatedAt:"2026-11-09",resolutionMeters:50,complete:true,processedStations:1,stationCount:1,note:""}};
}

test("range checks include the outer boundary and vertices",()=>{
  const coverage=fixture();
  for(const point of [[5,5],[0,5],[0,0],[10,10]] as Coord[])assert.deepEqual(assessCoverage(coverage,"test",point),{status:"inside",modes});
  assert.deepEqual(assessCoverage(coverage,"test",[10.001,5]),{status:"outside",modes:[]});
});

test("interior holes stay outside; their boundary is covered",()=>{
  const coverage=fixture({type:"Polygon",coordinates:[square(0,0,10),square(3,3,4)]});
  assert.equal(assessCoverage(coverage,"test",[5,5]).status,"outside");
  assert.equal(assessCoverage(coverage,"test",[2,5]).status,"inside");
  assert.equal(assessCoverage(coverage,"test",[3,5]).status,"inside");
  assert.equal(assessCoverage(coverage,"test",[3,3]).status,"inside");
});

test("disconnected polygons do not cover the gaps between them",()=>{
  const coverage=fixture({type:"MultiPolygon",coordinates:[[square(0,0,2)],[square(8,8,2)]]});
  assert.equal(assessCoverage(coverage,"test",[1,1]).status,"inside");
  assert.equal(assessCoverage(coverage,"test",[9,9]).status,"inside");
  assert.equal(assessCoverage(coverage,"test",[5,5]).status,"outside");
});

test("only the selected office and matching modes contribute",()=>{
  const coverage=fixture();
  coverage.features[0].geometry={type:"Polygon",coordinates:[square(30,30,2)]};
  coverage.features.push({...coverage.features[0],properties:{officeId:"another",mode:"walking"},geometry:polygon});
  assert.deepEqual(assessCoverage(coverage,"test",[5,5]),{status:"inside",modes:["bicycling","metro"]});
  assert.deepEqual(assessCoverage(coverage,"another",[5,5]),{status:"inside",modes:["walking"]});
});

test("duplicate overlapping features report each mode only once",()=>{
  const coverage=fixture();
  coverage.features.push(coverage.features[0]);
  assert.deepEqual(assessCoverage(coverage,"test",[5,5]).modes,modes);
});

test("missing or incomplete coverage cannot establish an outside result",()=>{
  assert.equal(assessCoverage(null,"test",[5,5]).status,"unavailable");
  assert.equal(assessCoverage(fixture(),"missing",[5,5]).status,"unavailable");
  const coverage=fixture();coverage.metadata.complete=false;
  assert.equal(assessCoverage(coverage,"test",[5,5]).status,"inside");
  assert.equal(assessCoverage(coverage,"test",[20,20]).status,"unavailable");
  coverage.metadata.complete=true;coverage.features.pop();
  assert.equal(assessCoverage(coverage,"test",[20,20]).status,"unavailable");
  assert.equal(assessCoverage(coverage,"test",[NaN,5]).status,"unavailable");
});

test("map drawing and point checks both exclude obsolete metro data",()=>{
  const coverage=fixture();coverage.metadata.methodVersion="old";
  coverage.features[0].geometry={type:"Polygon",coordinates:[square(30,30,2)]};
  coverage.features[1].geometry=coverage.features[0].geometry;
  assert.ok(coverageFeatures(coverage).every(feature=>feature.properties.mode!=="metro"));
  assert.deepEqual(assessCoverage(coverage,"test",[5,5]),{status:"unavailable",modes:[]});
});

test("real coverage contains all office entrances and excludes distant points",()=>{
  const coverage=JSON.parse(readFileSync(new URL("../public/data/coverage.json",import.meta.url),"utf8")) as Coverage;
  const offices=JSON.parse(readFileSync(new URL("../public/data/offices.json",import.meta.url),"utf8")) as {id:string;entrance:Coord}[];
  const before=JSON.stringify(coverage);
  for(const office of offices){
    assert.equal(assessCoverage(coverage,office.id,office.entrance).status,"inside",office.id);
    assert.equal(assessCoverage(coverage,office.id,[114.3,22.7]).status,"outside",office.id);
  }
  assert.equal(JSON.stringify(coverage),before);
});

test("preview marks both sides of the feathered boundary as requiring verification",()=>{
  const coverage=fixture({type:"Polygon",coordinates:[square(113.9,22.5,.02)]});
  for(const point of [[113.9,22.51],[113.9005,22.51],[113.8995,22.51]] as Coord[])
    assert.equal(assessCoverage(coverage,"test",point,COVERAGE_EDGE_METERS).status,"edge");
  assert.equal(assessCoverage(coverage,"test",[113.91,22.51],COVERAGE_EDGE_METERS).status,"inside");
  assert.equal(assessCoverage(coverage,"test",[113.89,22.51],COVERAGE_EDGE_METERS).status,"outside");
});

test("an interior hole's edge is uncertain while its centre stays outside",()=>{
  const coverage=fixture({type:"Polygon",coordinates:[square(113.9,22.5,.04),square(113.91,22.51,.02)]});
  assert.equal(assessCoverage(coverage,"test",[113.9105,22.52],COVERAGE_EDGE_METERS).status,"edge");
  assert.equal(assessCoverage(coverage,"test",[113.92,22.52],COVERAGE_EDGE_METERS).status,"outside");
});

test("a solid interior in another mode prevents a false union-edge warning",()=>{
  const coverage=fixture({type:"Polygon",coordinates:[square(113.9,22.5,.02)]});
  coverage.features[0].geometry={type:"Polygon",coordinates:[square(113.89,22.49,.04)]};
  assert.equal(assessCoverage(coverage,"test",[113.9,22.51],COVERAGE_EDGE_METERS).status,"inside");
});

test("map confirmation allows the layer union and exactly 500 metres outside",()=>{
  const coverage=fixture({type:"Polygon",coordinates:[square(113.9,22.5,.02)]});
  const metresPerDegree=Math.PI/180*6371008.8;
  assert.equal(assessMapPick(coverage,"test",[113.91,22.51]).allowed,true);
  for(const metres of [499,500])assert.equal(assessMapPick(coverage,"test",[113.91,22.5-metres/metresPerDegree]).allowed,true);
  const beyond=assessMapPick(coverage,"test",[113.91,22.5-501/metresPerDegree]);
  assert.equal(beyond.allowed,false);
  assert.equal(beyond.reason,"too-far");
});

test("map confirmation uses every mode in the selected office, including disconnected areas",()=>{
  const coverage=fixture({type:"Polygon",coordinates:[square(113.9,22.5,.02)]});
  coverage.features[2].geometry={type:"MultiPolygon",coordinates:[[square(113.9,22.5,.02)],[square(114.0,22.5,.02)]]};
  assert.equal(assessMapPick(coverage,"test",[114.01,22.51]).allowed,true);
  coverage.features.push({...coverage.features[0],properties:{officeId:"another",mode:"walking"},geometry:{type:"Polygon",coordinates:[square(114.1,22.5,.02)]}});
  assert.equal(assessMapPick(coverage,"test",[114.11,22.51]).reason,"too-far");
});

test("large holes do not allow distant map confirmation and missing data stays unavailable",()=>{
  const coverage=fixture({type:"Polygon",coordinates:[square(113.9,22.5,.08),square(113.91,22.51,.06)]});
  assert.equal(assessMapPick(coverage,"test",[113.94,22.54]).reason,"too-far");
  assert.equal(assessMapPick(null,"test",[113.94,22.54]).reason,"unavailable");
  assert.equal(assessMapPick(coverage,"test",[NaN,22.54]).allowed,false);
});
