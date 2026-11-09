"use client";
import {useEffect,useRef} from "react";
import {ChevronDown,X} from "lucide-react";
import type {Mode} from "@/lib/commute";
import type {Coverage,RailData,Validation} from "@/lib/map-types";
import ModeIcon from "./mode-icon";

export default function RulesDialog({open,onClose,coverage,rail,validation}:{open:boolean;onClose:()=>void;coverage:Coverage|null;rail:RailData|null;validation:Validation|null}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    if(open&&node&&!node.open){node.showModal();node.scrollTop=0;}
    if(!open&&node?.open)node.close();
  },[open]);
  const updated=coverage?.metadata.generatedAt?new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"numeric",day:"numeric",timeZone:"Asia/Shanghai"}).format(new Date(coverage.metadata.generatedAt)):"准备中";
  return <dialog ref={dialog} className="info-modal rules-modal" aria-labelledby="info-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <header className="rules-header">
      <button className="icon-button modal-close" aria-label="关闭规则说明" autoFocus onClick={onClose}><X size={20}/></button>
      <h2 id="info-title">规则与数据</h2>
    </header>
    <div className="info-content">
      <div className="info-rule-grid">{(["walking","bicycling","metro"] as Mode[]).map(mode=><div key={mode}><ModeIcon mode={mode} size={22}/><strong>≤{mode==="walking"?"30":"20"}<span>分钟</span></strong><span>{mode==="walking"?"全程步行":mode==="bicycling"?"普通自行车":"地铁方案"}</span></div>)}</div>
      <p>满足任一方式的时限，即满足通勤要求。每月还需租住至少16个工作日。</p>
      <h3>查询顺序</h3>
      <p>找到符合时限的方案即停止查询。</p>
      <ol className="verification-order">
        <li>先查步行与自行车直达路线。</li>
        <li>未满足时限，再查高德地铁不分段方案。</li>
        <li>仍未满足，再查地铁分段方案，允许两端步行或骑行。</li>
      </ol>
      <h3>时长怎么算</h3>
      <dl className="timing-definitions">
        <dt>地铁不分段</dt><dd>使用高德完整路线的总时长，包含步行、换乘和候车。</dd>
        <dt>地铁分段</dt><dd>
          <p className="rules-formula">进站前步行／骑行 ＋ 地铁及站内换乘 ＋ 出站后步行／骑行</p>
          计入站内换乘；不另加首次进站、最终出站的站内步行和候车时间。
        </dd>
      </dl>
      <p>时长按分钟四舍五入，如18分31秒计19分。分段先逐段取整，再相加，每段至少计1分钟。</p>
      <h3>范围怎么看</h3>
      <p>着色范围用于初步筛选，边缘地带需核验。确认地点后，会按实际坐标查询路线；查询未完成时，暂不能判断是否符合。</p>
      <h3>申请前做什么</h3>
      <ul className="application-notes">
        <li>用小区门口与实际办公地点测距，核对所选入口。</li>
        <li>点击方案中的“高德复核”，用手机扫码查看路线并截图。分段方案需保留各段截图。</li>
        <li>仅使用步行、普通自行车和地铁；公交、电瓶车、电动车、摩托车不计入。</li>
      </ul>
      <p>最终以公司要求的测距页面、截图和租住记录为准。</p>
      <details className="rules-details">
        <summary>数据来源与范围误差<ChevronDown size={16} aria-hidden="true"/></summary>
        <div>
          <p>地图与路线来自高德。范围结合高德固定地铁段与经校准的 OpenStreetMap 路网，按{coverage?.metadata.resolutionMeters??50}米网格预先计算。</p>
          <p>范围内的小空洞会作显示补全，部分小区按入口核验后修正。边界经过平滑处理，不代表每个地点都已通过路线核验。</p>
          {validation&&<p>抽样平均误差：步行约{Math.round((validation.summary.walking?.meanAbsoluteErrorSeconds??0)/6)/10}分钟，骑行约{Math.round((validation.summary.bicycling?.meanAbsoluteErrorSeconds??0)/6)/10}分钟。这是样本平均值，不是所有地点的最大误差。</p>}
          <p>分段会比较已准备的站口组合，再用高德复核部分候选；本地估算不作为符合条件的依据，也无法穷举所有可行路线。</p>
          <p>地铁参考出发时间为2026年11月9日09:00。复核时请设置同一时间。</p>
        </div>
      </details>
      <footer className="info-sources"><span>范围更新：{updated}{rail?` · ${rail.processedStations.length}个车站`:""}</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors / ODbL</a></footer>
    </div>
  </dialog>;
}
