"use client";
import {useEffect,useRef,useState} from "react";
import {QRCodeSVG} from "qrcode.react";
import {ArrowRight,X} from "lucide-react";
import {formatDuration,type AmapPlatform,type Plan} from "@/lib/commute";
import {reviewRoutes} from "@/lib/route-review";
import ModeIcon from "./mode-icon";
import ScanGuide from "./scan-guide";

export default function RouteReviewDialog({plan,onClose}:{plan:Plan|null;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [platform,setPlatform]=useState<AmapPlatform>("ios");
  const [lastPlan,setLastPlan]=useState<Plan|null>(null);
  useEffect(()=>{if(/Android/i.test(navigator.userAgent))setPlatform("android");},[]);
  useEffect(()=>{
    if(plan)setLastPlan(plan);
    const node=dialog.current;
    if(plan&&node&&!node.open){node.showModal();node.scrollTop=0;}
    if(!plan&&node?.open)node.close();
  },[plan]);
  // Preserve the contents while the dialog's closing transition runs.
  const displayedPlan=plan??lastPlan;
  const routes=displayedPlan?reviewRoutes(displayedPlan,platform):[];
  return <dialog ref={dialog} id="route-review-dialog" className={`info-modal review-modal ${routes.length===1?"is-single":""}`} aria-labelledby="review-title" aria-describedby="review-scan-warning"
    onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="review-content">
      <header className="review-header">
      <button className="icon-button modal-close" aria-label="关闭路线弹窗" autoFocus onClick={onClose}><X size={20}/></button>
      <h2 id="review-title">上高德看路线</h2>
      <div className="review-platform" role="group" aria-label="扫码手机系统">
        <button aria-pressed={platform==="ios"} onClick={()=>setPlatform("ios")}>iPhone</button>
        <button aria-pressed={platform==="android"} onClick={()=>setPlatform("android")}>Android</button>
      </div>
      </header>
      <ScanGuide platform={platform}/>
      <p id="review-scan-warning" className="review-scan-warning">微信扫码无法打开</p>
      <div className="review-qr-grid" key={`${platform}:${displayedPlan?.id??""}`}>
        {routes.map(route=><section className="review-qr-card" aria-label={route.label} key={route.id}>
          <div className="review-qr-heading"><ModeIcon mode={route.leg.mode} size={17}/><h3>{route.label}</h3><span>{formatDuration(route.leg.duration)}</span></div>
          {route.url?<a className="review-qr-image" href={route.url} target="_blank" rel="noreferrer" aria-label={`在高德打开${route.label}：${route.leg.from}到${route.leg.to}`}><QRCodeSVG value={route.url} size={216} level="M" marginSize={4} title={`${route.label}：${route.leg.from}到${route.leg.to}`} role="img"/></a>:<p className="review-qr-note">缺少车站信息，请在高德地铁图中选择下方两站。</p>}
          <p className="review-qr-endpoints"><span>{route.leg.from}</span><ArrowRight size={12} aria-hidden="true"/><span>{route.leg.to}</span></p>
          {route.id==="metro"&&route.url&&<p className="review-qr-note">若仍出现两端步行，请在高德地铁图中选择这两站核验。</p>}
          {route.leg.mode==="metro"&&route.url&&<p className="review-qr-note">若耗时与本页不一致，请在高德中将出发时间改为次日早上9:00，再核对路线。</p>}
        </section>)}
      </div>
    </div>
  </dialog>;
}
