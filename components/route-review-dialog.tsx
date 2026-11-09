"use client";
import {useEffect,useRef,useState} from "react";
import {QRCodeSVG} from "qrcode.react";
import {ArrowRight,ExternalLink,QrCode,X} from "lucide-react";
import {formatDuration,type AmapPlatform,type Plan} from "@/lib/commute";
import {reviewRoutes} from "@/lib/route-review";
import {watchAppLaunch} from "@/lib/app-launch";
import ModeIcon from "./mode-icon";
import ScanGuide from "./scan-guide";

export default function RouteReviewDialog({plan,onClose}:{plan:Plan|null;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [platform,setPlatform]=useState<AmapPlatform>("ios");
  const [mobile,setMobile]=useState(false),[attempted,setAttempted]=useState(false),[showQr,setShowQr]=useState(false);
  const cancelLaunch=useRef<()=>void>(()=>{});
  const [lastPlan,setLastPlan]=useState<Plan|null>(null);
  useEffect(()=>{if(/Android/i.test(navigator.userAgent))setPlatform("android");},[]);
  useEffect(()=>{
    const media=window.matchMedia("(max-width: 760px)");
    const mobileDevice=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    const update=()=>setMobile(mobileDevice||media.matches);
    update();media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);
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
      {qrVisible&&<div className="review-platform" role="group" aria-label="扫码手机系统">
        <button aria-pressed={platform==="ios"} onClick={()=>setPlatform("ios")}>iPhone</button>
        <button aria-pressed={platform==="android"} onClick={()=>setPlatform("android")}>Android</button>
      </div>}
      </header>
      {qrVisible&&!mobile&&<><ScanGuide platform={platform}/><p className="review-scan-warning">微信扫码无法打开</p></>}
      <div className="review-qr-grid" key={`${platform}:${displayedPlan?.id??""}`}>
        {routes.map(route=><section className="review-qr-card" aria-label={route.label} key={route.id}>
          <div className="review-qr-heading"><ModeIcon mode={route.leg.mode} size={17}/><h3>{route.label}</h3><span>{formatDuration(route.leg.duration)}</span></div>
          {route.url&&qrVisible&&<a className="review-qr-image" href={route.url} target={mobile?undefined:"_blank"} rel="noreferrer" onClick={mobile?openRoute:undefined} aria-label={`在高德打开${route.label}：${route.leg.from}到${route.leg.to}`}><QRCodeSVG value={route.url} size={216} level="M" marginSize={4} title={`${route.label}：${route.leg.from}到${route.leg.to}`} role="img"/></a>}
          <p className="review-qr-endpoints"><span>{route.leg.from}</span><ArrowRight size={12} aria-hidden="true"/><span>{route.leg.to}</span></p>
          {mobile&&route.url&&<a className="review-open-route" href={route.url} onClick={openRoute} aria-label={`在高德打开${route.label}：${route.leg.from}到${route.leg.to}`}>在高德打开<ExternalLink size={15} aria-hidden="true"/></a>}
          {!route.url&&<p className="review-qr-note">缺少车站信息，请在高德地铁图中选择上方两站。</p>}
          {route.id==="metro"&&route.url&&<p className="review-qr-note">若仍出现两端步行，请在高德地铁图中选择这两站核验。</p>}
          {route.leg.mode==="metro"&&route.url&&<p className="review-qr-note">若耗时与本页不一致，请在高德中将出发时间改为次日早上9:00，再核对路线。</p>}
        </section>)}
      </div>
      {mobile&&attempted&&!showQr&&<div className="review-link-fallback"><button className="text-button" onClick={()=>{cancelLaunch.current();setShowQr(true);}}><QrCode size={15} aria-hidden="true"/>未打开？显示二维码</button></div>}
      {mobile&&showQr&&<div className="review-mobile-scan-help"><p className="review-fallback-note" role="status">未打开高德？请用系统工具或高德 App 扫描二维码。</p><ScanGuide platform={platform}/><p className="review-scan-warning">微信扫码无法打开</p></div>}
    </div>
  </dialog>;
}
