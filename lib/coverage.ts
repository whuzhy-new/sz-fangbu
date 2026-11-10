import type {Coord,Mode} from "./commute";
import {DURATION_ROUNDING_VERSION} from "./commute.ts";
import type {Coverage,CoverageGeometry} from "./map-types";

export type CoverageAssessment={status:"inside"|"edge"|"outside"|"unavailable";modes:Mode[]};
export const COVERAGE_FEATHER_METERS=40;
export const COVERAGE_EDGE_METERS=COVERAGE_FEATHER_METERS*3;
export const MAP_PICK_MAX_DISTANCE_METERS=500;
const SURFACE_SEARCH_BUFFER_METERS=500;
export type MapPickAssessment={allowed:boolean;reason:"within-range"|"too-far"|"unavailable";distanceMeters:number|null};
const modes:Mode[]=["walking","bicycling","metro"];

// Use the same source features for drawing and point checks. Layer visibility
// and visual feathering do not change the underlying eligibility estimate.
export function coverageFeatures(coverage:Coverage|null):Coverage["features"] {
  if(coverage?.metadata.durationRounding!==DURATION_ROUNDING_VERSION)return [];
  return (coverage?.features??[]).filter(feature=>modes.includes(feature.properties.mode)&&
    (feature.geometry.type==="Polygon"||feature.geometry.type==="MultiPolygon")&&
    (feature.properties.mode!=="metro"||coverage?.metadata.methodVersion==="amap-station-pair-v3"));
}

// -1 outside, 0 on the boundary, 1 inside. Boundaries count as covered.
function ringLocation(point:Coord,ring:Coord[]):-1|0|1 {
  if(ring.length<3)return -1;
  let inside=false;
  const [x,y]=point,epsilon=1e-10;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [ax,ay]=ring[j],[bx,by]=ring[i],dx=bx-ax,dy=by-ay;
    const lengthSquared=dx*dx+dy*dy;
    const t=lengthSquared?((x-ax)*dx+(y-ay)*dy)/lengthSquared:0;
    if(t>=0&&t<=1&&Math.hypot(x-(ax+t*dx),y-(ay+t*dy))<=epsilon)return 0;
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }
  return inside?1:-1;
}

function polygonCovers(point:Coord,rings:Coord[][]):boolean {
  if(!rings.length)return false;
  const outer=ringLocation(point,rings[0]);
  if(outer<0)return false;
  for(const hole of rings.slice(1))if(ringLocation(point,hole)>0)return false;
  return true;
}

function geometryCovers(point:Coord,geometry:CoverageGeometry):boolean {
  return geometry.type==="Polygon"?polygonCovers(point,geometry.coordinates):geometry.coordinates.some(polygon=>polygonCovers(point,polygon));
}

function boundaryDistanceMeters(point:Coord,geometry:CoverageGeometry):number {
  const scale=Math.PI/180*6371008.8,longitudeScale=scale*Math.cos(point[1]*Math.PI/180);
  const polygons=geometry.type==="Polygon"?[geometry.coordinates]:geometry.coordinates;
  let closest=Infinity;
  for(const polygon of polygons)for(const ring of polygon)for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const ax=(ring[j][0]-point[0])*longitudeScale,ay=(ring[j][1]-point[1])*scale;
    const bx=(ring[i][0]-point[0])*longitudeScale,by=(ring[i][1]-point[1])*scale;
    const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/length)):0;
    closest=Math.min(closest,Math.hypot(ax+t*dx,ay+t*dy));
  }
  return closest;
}

export function firstQueryStage(coverage:Coverage|null,officeId:string,point:Coord):"surface"|"metro-full" {
  if(!coverage?.metadata.complete||point.length!==2||!point.every(Number.isFinite))return "surface";
  const features=coverageFeatures(coverage).filter(feature=>feature.properties.officeId===officeId);
  const farFromSurface=(["walking","bicycling"] as const).every(mode=>{
    const layers=features.filter(feature=>feature.properties.mode===mode);
    return layers.length>0&&layers.every(({geometry})=>{
      if(geometryCovers(point,geometry))return false;
      const distance=boundaryDistanceMeters(point,geometry);
      return Number.isFinite(distance)&&distance>SURFACE_SEARCH_BUFFER_METERS+1e-6;
    });
  });
  return farFromSurface?"metro-full":"surface";
}

/** Distance to the union of all three source layers for the selected office. */
export function assessMapPick(coverage:Coverage|null,officeId:string,point:Coord):MapPickAssessment {
  if(point.length!==2||!point.every(Number.isFinite))return {allowed:false,reason:"unavailable",distanceMeters:null};
  const features=coverageFeatures(coverage).filter(feature=>feature.properties.officeId===officeId);
  let distance=Infinity;
  for(const feature of features) {
    if(geometryCovers(point,feature.geometry))return {allowed:true,reason:"within-range",distanceMeters:0};
    distance=Math.min(distance,boundaryDistanceMeters(point,feature.geometry));
  }
  if(distance<=MAP_PICK_MAX_DISTANCE_METERS+1e-6)return {allowed:true,reason:"within-range",distanceMeters:distance};
  if(!coverage?.metadata.complete||modes.some(mode=>!features.some(feature=>feature.properties.mode===mode)))return {allowed:false,reason:"unavailable",distanceMeters:null};
  return {allowed:false,reason:"too-far",distanceMeters:distance};
}

export function assessCoverage(coverage:Coverage|null,officeId:string,point:Coord,edgeMeters=0):CoverageAssessment {
  if(!point.every(Number.isFinite))return {status:"unavailable",modes:[]};
  const features=coverageFeatures(coverage).filter(feature=>feature.properties.officeId===officeId);
  const matched=modes.filter(mode=>features.some(feature=>feature.properties.mode===mode&&geometryCovers(point,feature.geometry)));
  if(Number.isFinite(edgeMeters)&&edgeMeters>0) {
    let nearBoundary=false,safelyInside=false;
    for(const feature of features) {
      const distance=boundaryDistanceMeters(point,feature.geometry);
      if(distance<=edgeMeters)nearBoundary=true;
      else if(geometryCovers(point,feature.geometry))safelyInside=true;
    }
    // A secure interior in any mode is enough. Otherwise, both sides of the
    // feathered contour (including hole boundaries) need route verification.
    if(nearBoundary&&!safelyInside)return {status:"edge",modes:matched};
  }
  if(matched.length)return {status:"inside",modes:matched};
  if(!coverage?.metadata.complete||modes.some(mode=>!features.some(feature=>feature.properties.mode===mode)))return {status:"unavailable",modes:[]};
  return {status:"outside",modes:[]};
}
