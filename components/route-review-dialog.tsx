"use client";
import {useEffect,useRef} from "react";
import {QRCodeSVG} from "qrcode.react";
import {ArrowRight,X} from "lucide-react";
import {formatDuration,type Plan} from "@/lib/commute";
import {reviewRoutes} from "@/lib/route-review";
import ModeIcon from "./mode-icon";

export default function RouteReviewDialog({plan,onClose}:{plan:Plan|null;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    if(plan&&node&&!node.open){node.showModal();node.scrollTop=0;}
    if(!plan&&node?.open)node.close();
  },[plan]);
  const routes=plan?reviewRoutes(plan):[];
  return <dialog ref={dialog} id="route-review-dialog" className={`info-modal review-modal ${routes.length===1?"is-single":""}`} aria-labelledby="review-title" aria-describedby="review-instructions"
    onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="review-content">
      <header className="review-header">
      <button className="icon-button modal-close" aria-label="关闭高德复核" autoFocus onClick={onClose}><X size={20}/></button>
      <h2 id="review-title">高德复核</h2>
      <p id="review-instructions">请用手机扫码，在高德地图中查看路线并截图。网页版部分功能缺失。</p>
      </header>
      <div className="review-qr-grid">
        {routes.map(route=><section className="review-qr-card" aria-label={route.label} key={route.id}>
          <div className="review-qr-heading"><ModeIcon mode={route.leg.mode} size={17}/><h3>{route.label}</h3><span>{formatDuration(route.leg.duration)}</span></div>
          <a className="review-qr-image" href={route.url} target="_blank" rel="noreferrer" aria-label={`在高德打开${route.label}：${route.leg.from}到${route.leg.to}`}><QRCodeSVG value={route.url} size={216} level="M" marginSize={4} title={`${route.label}：${route.leg.from}到${route.leg.to}`} role="img"/></a>
          <p className="review-qr-endpoints"><span>{route.leg.from}</span><ArrowRight size={12} aria-hidden="true"/><span>{route.leg.to}</span></p>
        </section>)}
      </div>
    </div>
  </dialog>;
}
