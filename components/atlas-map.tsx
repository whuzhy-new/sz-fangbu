"use client";
import {useEffect,useRef,useState} from "react";
import {CircleHelp,LoaderCircle,LocateFixed,MapPin,Minus,Plus} from "lucide-react";
import {MODE_COLOR,type Coord,type Mode,type Office,type Place,type Plan} from "@/lib/commute";
import type {Coverage} from "@/lib/map-types";
declare global{interface Window{AMap:any;_AMapSecurityConfig:{serviceHost:string};}}
const modes:Mode[]=["walking","bicycling","metro"];
let sdk:Promise<void>|null=null;
function loadSdk(key:string){
  if(window.AMap)return Promise.resolve();
  if(sdk)return sdk;
  sdk=new Promise<void>((resolve,reject)=>{document.getElementById("amap-sdk")?.remove();const script=document.createElement("script");script.id="amap-sdk";script.src=`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;script.onload=()=>resolve();script.onerror=()=>{sdk=null;reject(new Error("地图网络连接失败"));};document.head.appendChild(script);});return sdk;
}
export default function AtlasMap({offices,activeId,showAll,layers,coverage,home,plan,onPick,onInfo,mobileOpen}:{offices:Office[];activeId:string;showAll:boolean;layers:Record<Mode,boolean>;coverage:Coverage|null;home:Place|null;plan:Plan|null;onPick:(c:Coord)=>void;onInfo:()=>void;mobileOpen:boolean}){
  const container=useRef<HTMLDivElement>(null),map=useRef<any>(null),areas=useRef<any[]>([]),markers=useRef<any[]>([]),lines=useRef<any[]>([]),pin=useRef<any>(null),pick=useRef(onPick);
  pick.current=onPick;
  const [ready,setReady]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const active=offices.find(o=>o.id===activeId);
  const padding=()=>window.innerWidth<=700&&mobileOpen?[55,25,Math.round(window.innerHeight*.65),25]:[80,60,80,60];
  useEffect(()=>{
    let alive=true,instance:any;setReady(false);setError("");
    (async()=>{try{const config=await fetch("/api/config").then(r=>r.json()) as {jsKey:string};if(!config.jsKey)throw new Error("地图服务尚未配置");window._AMapSecurityConfig={serviceHost:window.location.origin+"/_AMapService"};await loadSdk(config.jsKey);if(!alive||!container.current)return;
      instance=new window.AMap.Map(container.current,{zoom:13,center:[113.941,22.518],viewMode:"2D",mapStyle:"amap://styles/whitesmoke",resizeEnable:true,showIndoorMap:false,zooms:[10,19]});map.current=instance;
      instance.on("complete",()=>{if(alive)setReady(true);});instance.on("click",(e:any)=>pick.current([e.lnglat.lng,e.lnglat.lat]));
    }catch(e){if(alive)setError(e instanceof Error?e.message:"地图暂时无法加载");}})();
    return()=>{alive=false;instance?.destroy();if(map.current===instance)map.current=null;areas.current=[];markers.current=[];lines.current=[];pin.current=null;};
  },[retry]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;m.remove(areas.current);areas.current=[];
    for(const f of coverage?.features??[]){if((!showAll&&f.properties.officeId!==activeId)||!layers[f.properties.mode])continue;
      const polygons=f.geometry.type==="MultiPolygon"?f.geometry.coordinates:[f.geometry.coordinates];
      for(const path of polygons)areas.current.push(new window.AMap.Polygon({path,fillColor:MODE_COLOR[f.properties.mode],fillOpacity:showAll?0.12:0.17,strokeColor:MODE_COLOR[f.properties.mode],strokeWeight:1.2,strokeOpacity:.65,strokeStyle:f.properties.mode==="metro"?"dashed":"solid",bubble:true,zIndex:20+modes.indexOf(f.properties.mode)}));
    }m.add(areas.current);
  },[ready,coverage,activeId,showAll,layers]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;m.remove(markers.current);markers.current=[];
    for(const office of offices){if(!showAll&&office.id!==activeId)continue;const node=document.createElement("div");node.className="office-map-marker";const dot=document.createElement("span");dot.className="office-map-dot";dot.textContent="⌂";const label=document.createElement("span");label.className="office-map-label";label.textContent=office.name;node.appendChild(dot);node.appendChild(label);markers.current.push(new window.AMap.Marker({position:office.entrance,content:node,anchor:"bottom-center",zIndex:110,title:office.name}));}m.add(markers.current);
    if(!home){if(areas.current.length)m.setFitView([...markers.current,...areas.current],false,padding(),14);else if(showAll)m.setFitView(markers.current,false,padding(),14);else if(active)m.setZoomAndCenter(13,active.entrance);}
  },[ready,offices,activeId,showAll,coverage]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;if(pin.current)m.remove(pin.current);if(!home)return;
    const node=document.createElement("div");node.className="home-map-marker";node.innerHTML="<span></span>";
    const marker=new window.AMap.Marker({position:home.location,content:node,anchor:"bottom-center",draggable:true,zIndex:130,title:"拖动至小区门口"});marker.on("dragend",(e:any)=>pick.current([e.lnglat.lng,e.lnglat.lat]));m.add(marker);pin.current=marker;m.setFitView([marker],false,padding(),15);
  },[ready,home,mobileOpen]);
  useEffect(()=>{
    if(!ready||!map.current)return;const m=map.current;m.remove(lines.current);lines.current=[];if(!plan)return;
    for(const leg of plan.legs)for(const path of leg.paths){if(path.length>1)lines.current.push(new window.AMap.Polyline({path,strokeColor:MODE_COLOR[leg.mode],strokeWeight:leg.mode==="metro"?6:5,showDir:true,isOutline:true,outlineColor:"white",borderWeight:2,zIndex:85}));}m.add(lines.current);if(lines.current.length)m.setFitView(lines.current,false,padding(),16);
  },[ready,plan,mobileOpen]);
  function fit(){if(areas.current.length)map.current?.setFitView([...markers.current,...areas.current],false,padding(),14);else if(showAll)map.current?.setFitView(markers.current,false,padding(),14);else if(active)map.current?.setZoomAndCenter(13,active.entrance);}
  return <section className="map-section" aria-label="深圳通勤范围地图"><div className="map-canvas" ref={container}/>{!ready&&!error&&<div className="map-loading"><LoaderCircle size={25} className="spin"/><span>正在展开深圳地图…</span></div>}{error&&<div className="map-loading map-failure"><MapPin size={29}/><strong>{error}</strong><p>地点与路线查询仍可使用。</p><button onClick={()=>setRetry(n=>n+1)}>重新加载地图</button></div>}
    <div className="map-topbar"><span className="map-area-tag"><span className="status-dot"/>{showAll?"三个工区 · 叠加范围":active?.area??"深圳 · 南山"}</span><button className="map-hint" onClick={onInfo}><span className="small-area-icon"/>范围为校准路网估算<CircleHelp size={13}/></button></div>
    <div className="map-tools"><button aria-label="放大地图" onClick={()=>map.current?.zoomIn()}><Plus size={20}/></button><button aria-label="缩小地图" onClick={()=>map.current?.zoomOut()}><Minus size={20}/></button><span/><button aria-label="回到工区" onClick={fit}><LocateFixed size={19}/></button></div>
    <div className="map-bottom"><div className="map-legend">{modes.filter(m=>layers[m]).map(mode=><span key={mode}><i style={{background:MODE_COLOR[mode]}}/>{mode==="walking"?"步行 30分":mode==="bicycling"?"骑行 20分":"地铁组合 20分"}</span>)}</div><div className="map-note"><span>预估范围 · 选点核验</span></div></div>
  </section>;
}
