"use client";
import {useEffect,useRef} from "react";
import {Building2,Info,TrainFront,X} from "lucide-react";

const noticeVersion="2026-11-11-residences";
const noticeStorageKey="shenzhen-housing-map:feature-notice-version";

export default function FeatureNotice({onTry}:{onTry:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);

  useEffect(()=>{
    const node=dialog.current;
    if(!node||node.open)return;
    try {
      if(localStorage.getItem(noticeStorageKey)===noticeVersion)return;
    } catch {}
    node.showModal();
    try {localStorage.setItem(noticeStorageKey,noticeVersion);}catch {}
  },[]);

  function close(){dialog.current?.close();}

  return <dialog ref={dialog} className="info-modal feature-notice" aria-labelledby="feature-notice-label feature-notice-title"
    onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div className="feature-notice-body">
      <button type="button" className="icon-button modal-close" aria-label="关闭新功能通知" onClick={close}><X size={19} aria-hidden="true"/></button>
      <p className="feature-notice-label" id="feature-notice-label">新功能通知</p>
      <h2 id="feature-notice-title">哪些小区有房补？<span>快试试小区 List</span></h2>
      <ul className="feature-notice-steps">
        <li>
          <span className="feature-notice-icon"><Building2 size={16} aria-hidden="true"/></span>
          <div><h3>浏览小区</h3><p>选好工区，打开「小区」。可以按名称筛选，或用左侧 A–Z 跳转。</p></div>
        </li>
        <li>
          <span className="feature-notice-icon"><TrainFront size={16} aria-hidden="true"/></span>
          <div><h3>按地铁站筛选</h3><p>点搜索框右侧的筛选图标，按站名或线路勾选车站，再选 500 米、1 公里或 2 公里。</p></div>
        </li>
      </ul>
      <p className="feature-notice-note"><Info size={15} aria-hidden="true"/><span>小区列表按通勤范围估算。选中小区并确认地点后，可以核验具体路线。</span></p>
      <div className="feature-notice-actions">
        <button type="button" className="feature-notice-dismiss" onClick={close}>知道了</button>
        <button type="button" className="feature-notice-confirm" autoFocus onClick={()=>{close();onTry();}}>去试试</button>
      </div>
    </div>
  </dialog>;
}
