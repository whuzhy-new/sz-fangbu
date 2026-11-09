import {amapPoiId,type Coord} from "./commute.ts";

export type RouteEndpoints={originPoiId?:string;destinationPoiId?:string;routingIdentity:"coordinates"|"poi"};
type IdentityInput=Pick<RouteEndpoints,"originPoiId"|"destinationPoiId">;
const coordinate=(point:Coord)=>point.map(value=>value.toFixed(6)).join(",");

/** Keep the API request and mobile QR on the same endpoint identity. */
export function surfaceRouteParams(mode:"walking"|"bicycling",origin:Coord,destination:Coord,ids:IdentityInput={}) {
  const params:Record<string,string>={origin:coordinate(origin),destination:coordinate(destination),show_fields:"cost,polyline,navi"};
  // v5 walking documents POI parameters; v5 ordinary cycling only accepts coordinates.
  const originPoiId=mode==="walking"?amapPoiId(ids.originPoiId):undefined;
  const destinationPoiId=mode==="walking"?amapPoiId(ids.destinationPoiId):undefined;
  if(originPoiId)params.origin_id=originPoiId;
  if(destinationPoiId)params.destination_id=destinationPoiId;
  const endpoints:RouteEndpoints={originPoiId,destinationPoiId,routingIdentity:originPoiId||destinationPoiId?"poi":"coordinates"};
  return {params,endpoints};
}

export function transitRouteParams(origin:Coord,destination:Coord,ids:IdentityInput={}) {
  const params:Record<string,string>={origin:coordinate(origin),destination:coordinate(destination)};
  const a=amapPoiId(ids.originPoiId),b=amapPoiId(ids.destinationPoiId);
  // Transit POIs must be supplied as a pair. Anonymous map picks stay coordinates.
  const originPoiId=a&&b?a:undefined,destinationPoiId=a&&b?b:undefined;
  if(originPoiId&&destinationPoiId){params.originpoi=originPoiId;params.destinationpoi=destinationPoiId;}
  const endpoints:RouteEndpoints={originPoiId,destinationPoiId,routingIdentity:originPoiId?"poi":"coordinates"};
  return {params,endpoints};
}
