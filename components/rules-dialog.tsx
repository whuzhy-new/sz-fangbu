"use client";
import {useEffect,useRef} from "react";
import {X} from "lucide-react";
import type {Mode} from "@/lib/commute";
import type {Coverage,RailData,Validation} from "@/lib/map-types";
import ModeIcon from "./mode-icon";

export default function RulesDialog({open,onClose,coverage,rail,validation}:{open:boolean;onClose:()=>void;coverage:Coverage|null;rail:RailData|null;validation:Validation|null}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    if(open&&!node?.open)node?.showModal();
    if(!open&&node?.open)node.close();
  },[open]);
  const updated=coverage?.metadata.generatedAt?new Intl.DateTimeFormat("zh-CN",{month:"numeric",day:"numeric",timeZone:"Asia/Shanghai"}).format(new Date(coverage.metadata.generatedAt)):"准备中";
  return <dialog ref={dialog} className="info-modal" aria-labelledby="info-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="info-content">
      <button className="icon-button modal-close" aria-label="关闭规则说明" onClick={onClose}><X size={20}/></button>
      <h2 id="info-title">规则与数据</h2>
      <div className="info-rule-grid">{(["walking","bicycling","metro"] as Mode[]).map(mode=><div key={mode}><ModeIcon mode={mode} size={22}/><strong>{mode==="walking"?"30":"20"}<span>分钟</span></strong><span>{mode==="walking"?"全程步行":mode==="bicycling"?"普通自行车":"地铁与接驳"}</span></div>)}</div>
      <h3>核验顺序</h3>
      <ol className="verification-order"><li>先查步行与自行车，任一满足时限即结束。</li><li>再查高德点位到工区的完整地铁方案，20分钟内即结束。</li><li>仍未找到合适方案时，才查询分段组合。</li></ol>
      <p>分段先在本地路网比较全部已准备的站口组合，再用高德核验最多3个接驳，优先步行到附近最近入口及同站另一侧入口。高德请求共用4.5秒等待，超时保留已有结果；本地估算不能确认符合或排除房补资格。</p>
      <p>不足30秒舍去，30秒及以上进一分，每段至少1分钟。分段先逐段取整再相加，显示和时限判断使用同一结果。</p>
      <h3>地铁如何计时</h3>
      <p>完整方案采用高德总时长，含步行、换乘及接口计入的候车。分段方案加总小区到进站口的步行／骑行、站间地铁与站内换乘、出站口到工区的步行／骑行；不另加首次进站和最终出站的站内步行，不另加候车。</p>
      <p>地铁查询时刻为2026年11月9日09:00。复核时请使用同一时刻；实际申请需以公司要求的地图页面和截图为准。</p>
      <h3>范围与误差</h3>
      <p>范围由高德固定地铁段和校准的OSM路网预计算，按50米网格估算。1万平方米以内的内部小洞作显示补全，住宅空白按小区门口核验后修正。选点弹层预览范围估算，确认地点后按坐标查询高德路线。</p>
      {validation&&<p>抽样平均绝对误差：步行约{Math.round((validation.summary.walking?.meanAbsoluteErrorSeconds??0)/6)/10}分钟，骑行约{Math.round((validation.summary.bicycling?.meanAbsoluteErrorSeconds??0)/6)/10}分钟。样本误差不是所有地点的误差上限，临界地点需复核。</p>}
      <h3>申请要求</h3><p>以小区门口和实际办公地点测量；不使用公交、电动车或摩托车。每月最低租住16个工作日需另行满足。</p>
      <footer className="info-sources"><span>{updated} 更新 · {rail?.processedStations.length??0} 个车站</span><span>地图与路线：高德</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors / ODbL</a></footer>
    </div>
  </dialog>;
}
