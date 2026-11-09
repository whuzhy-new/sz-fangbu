import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceRouteParams,transitRouteParams} from '../lib/amap-route-params.ts';
import {mapLink,roundLeg,type Coord,type Leg} from '../lib/commute.ts';

const origin:Coord=[113.947267,22.527251],destination:Coord=[113.947074,22.529024];
const ids={originPoiId:'BX09906574',destinationPoiId:'B0H055I82U'};
const base:Leg={mode:'walking',origin,destination,from:'科苑地铁站C口',to:'深圳湾创新科技中心 T2 栋',duration:203,distance:254,paths:[],source:'amap',label:'步行'};

test('T2 walking API and QR use the same POI identities as well as coordinates',()=>{
  const request=surfaceRouteParams('walking',origin,destination,ids);
  assert.equal(request.params.origin_id,ids.originPoiId);
  assert.equal(request.params.destination_id,ids.destinationPoiId);
  const measured=roundLeg({...base,...request.endpoints});
  assert.equal(measured.rawDuration,203);
  assert.equal(measured.duration,180); // 3m23s rounds down at the restored 30-second threshold.
  for(const platform of ['ios','android'] as const){
    const url=new URL(mapLink(measured,platform)!);
    assert.equal(url.searchParams.get('sid'),request.params.origin_id);
    assert.equal(url.searchParams.get('did'),request.params.destination_id);
    assert.equal(Number(url.searchParams.get('dlon')),destination[0]);
    assert.equal(Number(url.searchParams.get('dlat')),destination[1]);
  }
});

test('legacy coordinate-only walking measurements do not acquire POI IDs only in the QR',()=>{
  const url=new URL(mapLink({...base,...ids})!);
  assert.equal(url.searchParams.has('sid'),false);
  assert.equal(url.searchParams.has('did'),false);
});

test('cycling stays coordinate-based in API and QR even when labels have POI IDs',()=>{
  const request=surfaceRouteParams('bicycling',origin,destination,ids);
  assert.equal(request.params.origin_id,undefined);
  assert.equal(request.params.destination_id,undefined);
  const url=new URL(mapLink({...base,mode:'bicycling',...ids,...request.endpoints})!);
  assert.equal(url.searchParams.has('sid'),false);
  assert.equal(url.searchParams.has('did'),false);
});

test('full-transit POI identities are supplied as a pair; anonymous origins keep both coordinates',()=>{
  const full=transitRouteParams(origin,destination,ids);
  assert.equal(full.params.originpoi,ids.originPoiId);
  assert.equal(full.params.destinationpoi,ids.destinationPoiId);
  const anonymous=transitRouteParams(origin,destination,{destinationPoiId:ids.destinationPoiId});
  assert.equal(anonymous.params.originpoi,undefined);
  assert.equal(anonymous.params.destinationpoi,undefined);
  assert.equal(anonymous.endpoints.routingIdentity,'coordinates');
});
