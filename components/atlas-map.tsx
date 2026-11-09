"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {ArrowRight,LoaderCircle,LocateFixed,MapPin,Minus,Plus,X} from "lucide-react";
import {distanceMeters,MODE_COLOR,type Coord,type Mode,type Office,type Place,type Plan} from "@/lib/commute";
import type {Coverage} from "@/lib/map-types";
import {createCoverageLayer} from "@/lib/coverage-layer";
import {assessCoverage,assessMapPick,coverageFeatures,COVERAGE_EDGE_METERS} from "@/lib/coverage";
import CoverageResult from "./coverage-result";
declare global{interface Window{AMap:any;_AMapSecurityConfig:{serviceHost:string};}}
let sdk:Promise<void>|null=null;
function loadSdk(key:string){
  if(window.AMap)return Promise.resolve();
  if(sdk)return sdk;
  sdk=new Promise<void>((resolve,reject)=>{document.getElementById("amap-sdk")?.remove();const script=document.createElement("script");script.id="amap-sdk";script.src=`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;script.onload=()=>resolve();script.onerror=()=>{sdk=null;reject(new Error("地图网络连接失败"));};document.head.appendChild(script);});return sdk;
}
export default function AtlasMap({offices,activeId,showAll,layers,coverage,home,plan,pendingLocation,pendingName,onPick,onConfirmPick,onCancelPick,mobileOpen}:{offices:Office[];activeId:string;showAll:boolean;layers:Record<Mode,boolean>;coverage:Coverage|null;home:Place|null;plan:Plan|null;pendingLocation:Coord|null;pendingName:string;onPick:(c:Coord,name?:string,poiId?:string)=>void;onConfirmPick:()=>void;onCancelPick:()=>void;mobileOpen:boolean}){
  const container=useRef<HTMLDivElement>(null),map=useRef<any>(null),areas=useRef<any[]>([]),markers=useRef<any[]>([]),lines=useRef<any[]>([]),pin=useRef<any>(null),pick=useRef(onPick);
  const coverageLayer=useRef<ReturnType<typeof createCoverageLayer>|null>(null);
  pick.current=onPick;
  const [ready,setReady]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [pickPosition,setPickPosition]=useState<{x:number;y:number}|null>(null);
  const active=offices.find(o=>o.id===activeId);
  const pendingAssessment=useMemo(()=>pendingLocation?assessCoverage(coverage,activeId,pendingLocation,COVERAGE_EDGE_METERS):null,[coverage,activeId,pendingLocation]);
  const pendingPermission=useMemo(()=>pendingLocation?assessMapPick(coverage,activeId,pendingLocation):null,[coverage,activeId,pendingLocation]);
  const padding=()=>{
    const panels=document.querySelector(".panel-columns")?.getBoundingClientRect(),canvas=container.current?.getBoundingClientRect();
    // AMap's order is top, bottom, left, right (not CSS shorthand).
    const left=window.innerWidth<=700?24:(panels?.right??696)-(canvas?.left??0)+32;
    if(pendingLocation)return [Math.min(320,(canvas?.height??600)-80),56,left,window.innerWidth<=700?24:64];
    if(window.innerWidth<=700){
      const header=document.querySelector(".mobile-panel-header")?.getBoundingClientRect().height??60;
      const body=mobileOpen?(document.querySelector(".mobile-panel-body")?.getBoundingClientRect().height??0):0;
      return [Math.min((panels?.top??12)-(canvas?.top??0)+header+body+24,Math.max(80,(canvas?.height??600)-160)),56,24,24];
    }
    return [96,56,left,64];
  };
  useEffect(()=>{
    let alive=true,instance:any,clickTimer:ReturnType<typeof setTimeout>|undefined,lastHotspotAt=-Infinity;setReady(false);setError("");
    (async()=>{try{const config=await fetch("/api/config").then(r=>r.json()) as {jsKey:string};if(!config.jsKey)throw new Error("地图服务尚未配置");window._AMapSecurityConfig={serviceHost:window.location.origin+"/_AMapService"};await loadSdk(config.jsKey);if(!alive||!container.current)return;
      instance=new window.AMap.Map(container.current,{zoom:13,center:[113.941,22.518],viewMode:"2D",mapStyle:"amap://styles/whitesmoke",resizeEnable:true,showIndoorMap:false,isHotspot:true,zooms:[10,19]});map.current=instance;
      instance.on("complete",()=>{if(alive)setReady(true);});
      instance.on("click",(event:any)=>{
        if(performance.now()-lastHotspotAt<250)return;
        clearTimeout(clickTimer);
        const location:Coord=[event.lnglat.lng,event.lnglat.lat];
        // Named hotspot events take priority over the same background click.
        clickTimer=setTimeout(()=>{if(alive)pick.current(location);},100);
      });
      instance.on("hotspotclick",(event:any)=>{
        clearTimeout(clickTimer);lastHotspotAt=performance.now();
        pick.current([event.lnglat.lng,event.lnglat.lat],event.name,event.id);
      });
    }catch(e){if(alive)setError(e instanceof Error?e.message:"地图暂时无法加载");}})();
    return()=>{alive=false;clearTimeout(clickTimer);instance?.destroy();if(map.current===instance)map.current=null;areas.current=[];markers.current=[];lines.current=[];pin.current=null;};
  },[retry]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;
    const controller=createCoverageLayer(m,window.AMap);coverageLayer.current=controller;m.addLayer(controller.layer);
    return()=>{
      if(map.current===m)m.removeLayer(controller.layer);
      controller.dispose();if(coverageLayer.current===controller)coverageLayer.current=null;
    };
  },[ready]);
  useEffect(()=>{
    if(!ready||!map.current)return;areas.current=[];
    const features=coverageFeatures(coverage).filter(f=>(showAll||f.properties.officeId===activeId)&&layers[f.properties.mode]);
    for(const f of features){
      const polygons=f.geometry.type==="MultiPolygon"?f.geometry.coordinates:[f.geometry.coordinates];
      // Retain native bounds for fitView without drawing a second, hard-edged overlay.
      for(const path of polygons)areas.current.push(new window.AMap.Polygon({path}));
    }
    coverageLayer.current?.update(features,showAll);
  },[ready,coverage,activeId,showAll,layers]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;m.remove(markers.current);markers.current=[];
    for(const office of offices){if(!showAll&&office.id!==activeId)continue;const node=document.createElement("div");node.className="office-map-marker";const dot=document.createElement("span");dot.className="office-map-dot";dot.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M10 21v-6h4v6"/></svg>';const label=document.createElement("span");label.className="office-map-label";label.textContent=office.name;node.appendChild(dot);node.appendChild(label);const marker=new window.AMap.Marker({position:office.entrance,content:node,anchor:"bottom-center",bubble:false,zIndex:110,title:office.name});marker.on("click",()=>pick.current(office.entrance as Coord,office.name,office.poiId));markers.current.push(marker);}m.add(markers.current);
    if(!home){if(areas.current.length)m.setFitView([...markers.current,...areas.current],false,padding(),14);else if(showAll)m.setFitView(markers.current,false,padding(),14);else if(active)m.setZoomAndCenter(13,active.entrance);}
  },[ready,offices,activeId,showAll,coverage,home]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;if(pin.current)m.remove(pin.current);pin.current=null;const location=pendingLocation??home?.location;if(!location)return;
    const node=document.createElement("div");node.className="home-map-marker";node.innerHTML="<span></span>";
    const marker=new window.AMap.Marker({position:location,content:node,anchor:"bottom-center",draggable:true,zIndex:130,title:"拖动至小区门口"});marker.on("dragend",(e:any)=>{const next:Coord=[e.lnglat.lng,e.lnglat.lat];pick.current(next,distanceMeters(location,next)<=250?(pendingName||home?.name):undefined);});marker.on("dragging",(e:any)=>{if(pendingLocation){const p=m.lngLatToContainer(e.lnglat);setPickPosition({x:p.x,y:p.y});}});m.add(marker);pin.current=marker;m.setFitView([marker],!!pendingLocation,padding(),pendingLocation?Math.max(m.getZoom(),15):15);
  },[ready,home,mobileOpen,pendingLocation,pendingName]);
  useEffect(()=>{
    if(!ready||!map.current||!pendingLocation){setPickPosition(null);return;}
    const m=map.current;
    const update=()=>{const point=m.lngLatToContainer(pendingLocation);setPickPosition({x:point.x,y:point.y});};
    m.on("mapmove",update);m.on("zoomchange",update);m.on("resize",update);update();
    return()=>{m.off("mapmove",update);m.off("zoomchange",update);m.off("resize",update);};
  },[ready,pendingLocation]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;m.remove(lines.current);lines.current=[];if(!plan||pendingLocation)return;
    for(const leg of plan.legs)for(const path of leg.paths){if(path.length>1)lines.current.push(new window.AMap.Polyline({path,strokeColor:MODE_COLOR[leg.mode],strokeWeight:leg.mode==="metro"?6:5,showDir:true,isOutline:true,outlineColor:"white",borderWeight:2,zIndex:85}));}m.add(lines.current);if(lines.current.length)m.setFitView(lines.current,false,padding(),16);
  },[ready,plan,mobileOpen,pendingLocation]);
  function fit(){if(areas.current.length)map.current?.setFitView([...markers.current,...areas.current],false,padding(),14);else if(showAll)map.current?.setFitView(markers.current,false,padding(),14);else if(active)map.current?.setZoomAndCenter(13,active.entrance);}
  return <section className="map-section" aria-label="深圳通勤范围地图"><div className="map-canvas" ref={container}/>{!ready&&!error&&<div className="map-loading"><LoaderCircle size={22} className="spin"/><span>正在加载地图</span></div>}{error&&<div className="map-loading map-failure"><MapPin size={26}/><strong>{error}</strong><p>仍可搜索地点并核验路线。</p><button onClick={()=>setRetry(n=>n+1)}>重新加载</button></div>}
    <div className="map-tools"><button aria-label="放大地图" onClick={()=>map.current?.zoomIn()}><Plus size={20}/></button><button aria-label="缩小地图" onClick={()=>map.current?.zoomOut()}><Minus size={20}/></button><span/><button aria-label="回到工区" onClick={fit}><LocateFixed size={19}/></button></div>
    {pendingLocation&&pickPosition&&<div className="map-pick-confirm" style={{left:pickPosition.x,top:pickPosition.y-38}} role="region" aria-label="确认地图选点"><div className="pick-confirm-heading"><MapPin size={18} aria-hidden="true"/><strong>{pendingName}</strong><button className="icon-button" aria-label="取消选点" onClick={onCancelPick}><X size={18}/></button></div><p>可拖动标记调整到小区门口</p>{pendingAssessment&&<CoverageResult assessment={pendingAssessment} blocked={pendingPermission?.reason==="too-far"} compact/>}<button className="confirm-pick-button" disabled={!pendingPermission?.allowed} autoFocus={!!pendingPermission?.allowed} onClick={onConfirmPick}>确认地点<ArrowRight size={16} aria-hidden="true"/></button></div>}
  </section>;
}
