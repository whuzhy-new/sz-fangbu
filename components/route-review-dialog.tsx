"use client";
import {useEffect,useRef,useState} from "react";
import {QRCodeSVG} from "qrcode.react";
import {ArrowRight,ExternalLink,Info,QrCode,X} from "lucide-react";
import {formatDuration,type AmapPlatform,type Plan} from "@/lib/commute";
import {detectAmapPlatform,reviewRoutes} from "@/lib/route-review";
import {watchAppLaunch} from "@/lib/app-launch";
import ModeIcon from "./mode-icon";
import ScanGuide from "./scan-guide";

function ReviewTip({children}:{children:string}) {
  return <p className="review-qr-tip"><Info size={13} aria-hidden="true"/><span>{children}</span></p>;
}

export default function RouteReviewDialog({plan,onClose}:{plan:Plan|null;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [qrPlatform,setQrPlatform]=useState<AmapPlatform>("ios");
  const [devicePlatform,setDevicePlatform]=useState<AmapPlatform|null>(null);
  const [attempted,setAttempted]=useState(false),[showQr,setShowQr]=useState(false);
  const cancelLaunch=useRef<()=>void>(()=>{});
  const [lastPlan,setLastPlan]=useState<Plan|null>(null);
  const mobile=devicePlatform!==null;
  const platform=devicePlatform??qrPlatform;
  useEffect(()=>{setDevicePlatform(detectAmapPlatform(navigator));},[]);
  useEffect(()=>{
    cancelLaunch.current();setAttempted(false);setShowQr(false);
    return()=>cancelLaunch.current();
  },[plan]);
  useEffect(()=>{cancelLaunch.current();},[platform,mobile]);
  useEffect(()=>{
    if(plan)setLastPlan(plan);
    const node=dialog.current;
    if(plan&&node&&!node.open){node.showModal();node.scrollTop=0;}
    if(!plan&&node?.open)node.close();
  },[plan]);
  // Preserve the contents while the dialog's closing transition runs.
  const displayedPlan=plan??lastPlan;
  const routes=displayedPlan?reviewRoutes(displayedPlan,platform):[];
  const qrVisible=!mobile||showQr;
  function openRoute(){
    cancelLaunch.current();setAttempted(true);
    cancelLaunch.current=watchAppLaunch(()=>setShowQr(true));
  }
  return <dialog ref={dialog} id="route-review-dialog" className={`info-modal review-modal ${routes.length===1?"is-single":""} ${mobile?"is-mobile-links":""}`} aria-labelledby="review-title"
    onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="review-content">
      <header className="review-header">
      <button className="icon-button modal-close" aria-label="关闭路线弹窗" autoFocus onClick={onClose}><X size={20}/></button>
      <h2 id="review-title">上高德看路线</h2>
      {!mobile&&<div className="review-platform" role="group" aria-label="扫码手机系统">
        <button aria-pressed={platform==="ios"} onClick={()=>setQrPlatform("ios")}>iPhone</button>
        <button aria-pressed={platform==="android"} onClick={()=>setQrPlatform("android")}>Android</button>
      </div>}
      </header>
      {!mobile&&<ScanGuide platform={platform}/>}
      <div className="review-qr-grid" key={`${platform}:${displayedPlan?.id??""}`}>
        {routes.map(route=><section className="review-qr-card" aria-label={route.label} key={route.id}>
          <div className="review-qr-heading"><ModeIcon mode={route.leg.mode} size={17}/><h3>{route.label}</h3><span>{formatDuration(route.leg.duration)}</span></div>
          {route.url&&qrVisible&&<a className="review-qr-image" href={route.url} target={mobile?undefined:"_blank"} rel="noreferrer" onClick={mobile?openRoute:undefined} aria-label={`在高德打开${route.label}：${route.leg.from}到${route.leg.to}`}><QRCodeSVG value={route.url} size={216} level="M" marginSize={4} title={`${route.label}：${route.leg.from}到${route.leg.to}`} role="img"/></a>}
          <p className="review-qr-endpoints"><span>{route.leg.from}</span><ArrowRight size={12} aria-hidden="true"/><span>{route.leg.to}</span></p>
          {mobile&&route.url&&<a className="review-open-route" href={route.url} onClick={openRoute} aria-label={`在高德打开${route.label}：${route.leg.from}到${route.leg.to}`}>在高德打开<ExternalLink size={15} aria-hidden="true"/></a>}
          {!route.url&&<p className="review-qr-note">缺少车站信息，请在高德地铁图中选择上方两站。</p>}
          {route.id==="metro"&&route.url&&<ReviewTip>如果出现步行路线，请在高德地图中重新搜索路线，确保起点和终点均为「站名（地铁站）」。</ReviewTip>}
          {route.leg.mode==="metro"&&route.url&&<ReviewTip>若耗时与本页不一致，请在高德中将出发时间改为次日早上 9:00，再核对路线。</ReviewTip>}
          {route.url&&route.id!=="metro"&&<ReviewTip>{`可在高德切换为${route.leg.mode==="walking"?"自行车":route.leg.mode==="bicycling"?"步行":"步行或自行车"}，比较用时。`}</ReviewTip>}
        </section>)}
      </div>
      {mobile&&attempted&&!showQr&&<div className="review-link-fallback"><button className="text-button" onClick={()=>{cancelLaunch.current();setShowQr(true);}}><QrCode size={15} aria-hidden="true"/>未打开？显示二维码</button></div>}
      {mobile&&showQr&&<div className="review-mobile-scan-help"><p className="review-fallback-note" role="status">未打开高德？请用系统工具或高德 App 扫描二维码。</p><ScanGuide platform={platform}/></div>}
    </div>
  </dialog>;
}
