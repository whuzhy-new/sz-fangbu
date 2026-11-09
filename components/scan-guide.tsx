"use client";
import {useId,useState} from "react";
import {Camera,ChevronDown,LoaderCircle,ScanLine,type LucideIcon} from "lucide-react";
import type {AmapPlatform} from "@/lib/commute";
import AnimatedCollapse from "./animated-collapse";

type Guide={kind:"system"|"amap";path:string;image:string;alt:string};

function ScanMethod({title,description,icon:Icon,guide}:{title:string;description:string;icon:LucideIcon;guide?:Guide}) {
  const [open,setOpen]=useState(false);
  const [imageReady,setImageReady]=useState(false);
  const contentId=useId();
  const heading=<span className="scan-method-heading"><Icon size={18} aria-hidden="true"/><span><strong>{title}</strong><small>{description}</small></span></span>;
  if(!guide)return <div className="review-scan-method">{heading}</div>;
  return <div className={`review-scan-method review-scan-entry ${open?"is-open":""}`}>
    <button type="button" className="scan-method-toggle" aria-expanded={open} aria-controls={contentId} onClick={()=>setOpen(value=>!value)}>{heading}<ChevronDown size={14} aria-hidden="true"/></button>
    <AnimatedCollapse open={open} id={contentId} className="scan-guide-collapse">
      <p className="review-guide-path">{guide.path}</p>
      <div className={`review-guide-example is-${guide.kind} ${imageReady?"is-ready":""}`}>
        {!imageReady&&<LoaderCircle size={18} className="spin" aria-label="正在加载入口图"/>}
        <img src={guide.image} alt={guide.alt} width={1206} height={2622} loading="lazy" decoding="async" onLoad={()=>setImageReady(true)}/>
        {guide.kind==="system"?<span className="scan-entry-highlight is-system" aria-hidden="true"/>:<>
          <span className="scan-entry-highlight is-plus" aria-hidden="true"><b>1</b></span>
          <span className="scan-entry-highlight is-scan" aria-hidden="true"><b>2</b></span>
        </>}
      </div>
    </AnimatedCollapse>
  </div>;
}

export default function ScanGuide({platform}:{platform:AmapPlatform}) {
  return <div className="review-scan-methods" role="group" aria-label="支持的扫码方式">
    <ScanMethod key={platform} title="系统工具" description="相机、二维码扫描器" icon={Camera}
      guide={platform==="ios"?{kind:"system",path:"控制中心 → 二维码扫描器",image:"/images/system-scan-entry.png",alt:"iPhone 控制中心，专注模式下方一行的第三个按钮为二维码扫描器，图中已圈出"}:undefined}/>
    <ScanMethod title="高德 App" description="扫一扫" icon={ScanLine}
      guide={{kind:"amap",path:"右上角 ＋ → 扫一扫",image:"/images/amap-scan-entry.png",alt:"高德首页右上角加号展开菜单，第三项为扫一扫；图中标出了加号和扫一扫"}}/>
  </div>;
}
