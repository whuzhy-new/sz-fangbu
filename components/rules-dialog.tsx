"use client";
import {useEffect,useRef} from "react";
import {ChevronDown,X} from "lucide-react";
import type {Mode} from "@/lib/commute";
import type {Coverage,RailData,Validation} from "@/lib/map-types";
import ModeIcon from "./mode-icon";

export default function RulesDialog({open,onClose,coverage,rail,validation}:{open:boolean;onClose:()=>void;coverage:Coverage|null;rail:RailData|null;validation:Validation|null}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const title=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    if(open&&node&&!node.open){node.showModal();title.current?.focus({preventScroll:true});node.scrollTop=0;}
    if(!open&&node?.open)node.close();
  },[open]);
  const updated=coverage?.metadata.generatedAt?new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"numeric",day:"numeric",timeZone:"Asia/Shanghai"}).format(new Date(coverage.metadata.generatedAt)):"准备中";
  return <dialog ref={dialog} className="info-modal rules-modal" aria-labelledby="info-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <header className="rules-header">
      <button className="icon-button modal-close" aria-label="关闭规则说明" onClick={onClose}><X size={20}/></button>
      <h2 ref={title} tabIndex={-1} id="info-title">规则与数据</h2>
    </header>
    <div className="info-content">
      <div className="rules-limits">{(["walking","bicycling","metro"] as Mode[]).map(mode=><div className={`rules-limit ${mode}`} key={mode}>
        <span className="rule-mode"><ModeIcon mode={mode} size={18}/>{mode==="walking"?"步行":mode==="bicycling"?"自行车":"地铁"}</span>
        <strong>{mode==="walking"?"30":"20"}<span>分钟内</span></strong>
      </div>)}</div>
      <p className="rules-intro">任一方式满足时限，且每月租住至少<strong>16个工作日</strong>。</p>
      <div className="rules-content-grid">
        <section className="rules-section rules-query">
          <h3>查询顺序</h3>
          <p>满足即停止，否则继续下一步。</p>
          <ol className="rules-order"><li>步行／骑行直达</li><li>地铁不分段</li><li>地铁分段</li></ol>
          <p className="rules-range-note">着色范围用于初筛，边缘需核验。确认地点后查询实际路线；未完成查询时，暂不能判断是否符合。</p>
        </section>
        <section className="rules-section rules-calculation">
          <h3>时长计算</h3>
          <dl className="timing-definitions">
            <dt>地铁不分段</dt><dd>使用高德总时长，含两端步行、换乘和候车。</dd>
            <dt>地铁分段</dt><dd>
              <div className="rules-formula" aria-label="进站接驳加地铁及站内换乘加出站接驳"><span>进站接驳</span><b aria-hidden="true">＋</b><span>地铁及换乘</span><b aria-hidden="true">＋</b><span>出站接驳</span></div>
              接驳可步行或骑行。计入站内换乘，不另加首次进站、最终出站的站内步行与候车。
            </dd>
          </dl>
          <div className="rules-rounding"><span>按分钟四舍五入</span><strong>18分31秒 → 19分</strong><p>分段先逐段取整再相加，每段至少计1分钟。</p></div>
        </section>
      </div>
      <section className="rules-section rules-application">
        <h3>申请前核对</h3>
        <ul className="application-notes">
          <li>测距起终点为小区门口与实际办公地点，注意核对入口。</li>
          <li>点击“高德复核”，用手机扫码查看路线并截图；分段需保留各段截图。</li>
        </ul>
        <p>仅限步行、普通自行车和地铁，公交、电瓶车、电动车、摩托车不计入。最终以公司要求的测距页面、截图和租住记录为准。</p>
      </section>
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
