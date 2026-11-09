import {MODE_COLOR,type Coord,type Mode} from "./commute";
import type {Coverage} from "./map-types";
import {COVERAGE_FEATHER_METERS} from "./coverage";

type Point={x:number;y:number};
type Polygon=Coord[][];
const modes:Mode[]=["walking","bicycling","metro"];

// Round only the displayed contour. The source coordinates and route checks stay intact.
function traceRing(ctx:CanvasRenderingContext2D,points:Point[],radius:number){
  const count=points.length;
  if(count<3)return;
  for(let i=0;i<count;i++){
    const p=points[i],before=points[(i+count-1)%count],after=points[(i+1)%count];
    const incoming=Math.hypot(before.x-p.x,before.y-p.y),outgoing=Math.hypot(after.x-p.x,after.y-p.y);
    const cut=Math.min(radius,incoming*.45,outgoing*.45);
    const entry={x:p.x+(before.x-p.x)*cut/(incoming||1),y:p.y+(before.y-p.y)*cut/(incoming||1)};
    const exit={x:p.x+(after.x-p.x)*cut/(outgoing||1),y:p.y+(after.y-p.y)*cut/(outgoing||1)};
    if(i===0)ctx.moveTo(entry.x,entry.y);else ctx.lineTo(entry.x,entry.y);
    ctx.quadraticCurveTo(p.x,p.y,exit.x,exit.y);
  }
  ctx.closePath();
}

export function createCoverageLayer(map:any,AMap:any){
  const canvas=document.createElement("canvas"),mask=document.createElement("canvas");
  canvas.className="coverage-layer";
  canvas.style.pointerEvents="none";
  canvas.setAttribute("aria-hidden","true");
  const ctx=canvas.getContext("2d")!,source=mask.getContext("2d")!;
  let groups:{mode:Mode;polygons:Polygon[]}[]=[],showAll=false,previousView="",disposed=false;
  const render=()=>{
    if(disposed)return;
    const size=map.getSize(),center=map.getCenter(),zoom=map.getZoom();
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const view=[size.width,size.height,center.lng,center.lat,zoom,map.getRotation(),map.getPitch(),dpr].join(",");
    if(view===previousView||!size.width||!size.height)return;
    previousView=view;
    const metersPerPixel=156543.03392*Math.cos(center.lat*Math.PI/180)/2**zoom;
    const feather=Math.max(4,Math.min(12,COVERAGE_FEATHER_METERS/metersPerPixel)),pad=Math.ceil(feather*3);
    const width=Math.round(size.width*dpr),height=Math.round(size.height*dpr);
    if(canvas.width!==width||canvas.height!==height){
      canvas.width=width;canvas.height=height;
      canvas.style.width=`${size.width}px`;canvas.style.height=`${size.height}px`;
    }
    const maskWidth=Math.round(width+pad*2*dpr),maskHeight=Math.round(height+pad*2*dpr);
    if(mask.width!==maskWidth||mask.height!==maskHeight){mask.width=maskWidth;mask.height=maskHeight;}
    ctx.clearRect(0,0,width,height);
    for(const {mode,polygons} of groups){
      if(!polygons.length)continue;
      source.setTransform(1,0,0,1,0,0);source.clearRect(0,0,mask.width,mask.height);
      source.setTransform(dpr,0,0,dpr,pad*dpr,pad*dpr);source.fillStyle=MODE_COLOR[mode];
      for(const polygon of polygons){
        source.beginPath();
        for(const ring of polygon){
          // GeoJSON rings repeat their starting vertex; omit it before rounding the closing corner.
          const closed=ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1];
          const points=(closed?ring.slice(0,-1):ring).map(coord=>map.lngLatToContainer(coord) as Point);
          traceRing(source,points,32/metersPerPixel);
        }
        source.fill("evenodd"); // Preserve interior holes and disconnected polygons.
      }
      ctx.globalAlpha=showAll?0.13:0.18;
      ctx.filter=`blur(${feather*dpr}px)`;
      ctx.drawImage(mask,-pad*dpr,-pad*dpr);
    }
    ctx.globalAlpha=1;ctx.filter="none";
  };
  // AMap keeps this canvas aligned while panning/zooming; unchanged views skip repainting.
  const layer=new AMap.CustomLayer(canvas,{zIndex:20,zooms:[10,19],alwaysRender:true,render});
  return {
    layer,
    update(features:Coverage["features"],all:boolean){
      groups=modes.map(mode=>({mode,polygons:features.filter(f=>f.properties.mode===mode).flatMap(f=>
        (f.geometry.type==="MultiPolygon"?f.geometry.coordinates:[f.geometry.coordinates]) as Polygon[])}));
      showAll=all;previousView="";render();
    },
    dispose(){disposed=true;canvas.width=0;mask.width=0;canvas.remove();}
  };
}
