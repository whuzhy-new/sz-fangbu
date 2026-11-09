"use client";
import {useState} from "react";
import {ArrowRight,Check,ChevronDown,CircleHelp,LoaderCircle,QrCode} from "lucide-react";
import {formatDuration,QUERY_STAGE_LABEL,type Plan,type QueryStage,type Verification} from "@/lib/commute";
import ModeIcon from "./mode-icon";
import AnimatedCollapse from "./animated-collapse";
import RouteReviewDialog from "./route-review-dialog";

const date=(value:string)=>new Intl.DateTimeFormat("zh-CN",{month:"numeric",day:"numeric",timeZone:"Asia/Shanghai"}).format(new Date(value));

function RouteSource({plan,onReview}:{plan:Plan;onReview:()=>void}) {
  const [open,setOpen]=useState(false);
  return <div className="route-source">
    <div className="route-detail-actions">
      <button className="route-review-button" aria-haspopup="dialog" aria-controls="route-review-dialog" onClick={onReview}><QrCode size={15} aria-hidden="true"/>高德复核</button>
      <button className="route-source-toggle" aria-expanded={open} aria-controls={`source-${plan.id}`} onClick={()=>setOpen(value=>!value)}>数据与计算口径<ChevronDown size={13} className={open?"rotated":""} aria-hidden="true"/></button>
    </div>
    <AnimatedCollapse open={open} id={`source-${plan.id}`}>
      <div className="route-source-content">
        {plan.note&&<p>{plan.note}</p>}
        {plan.originalReferenceDuration!=null&&<p>高德站间参考总时长：{formatDuration(plan.originalReferenceDuration)}</p>}
        <p>路线数据：{date(plan.measuredAt)}。不足30秒舍去，30秒及以上进一分，每段至少1分钟；各段先取整再相加。</p>
      </div>
    </AnimatedCollapse>
  </div>;
}

export default function RouteResults({result,plans,selectedPlan,loading,queryStage,stopped,error,onSelect,onStop}:{
  result?:Verification;plans:Plan[];selectedPlan:Plan|null;loading:boolean;queryStage:QueryStage;stopped:boolean;error:string;
  onSelect:(plan:Plan)=>void;onStop:()=>void;
}) {
  const [reviewPlan,setReviewPlan]=useState<Plan|null>(null);
  const best=plans.find(p=>p.qualified);
  const status=best?"符合房补条件":loading?`正在查询${QUERY_STAGE_LABEL[queryStage]}方案`:stopped?"核验已停止":error||result?.errors.length||!plans.length?"暂未完成核验":!result?.complete?"暂未确认房补条件":"已查方案超出时限";
  return <section className="results-section" aria-label="地点核验结果">
    <div className={`result-status ${best?"pass":""}`} role="status" aria-live="polite">
      {best?<Check size={21} aria-hidden="true"/>:loading?<LoaderCircle size={20} className="spin" aria-hidden="true"/>:<CircleHelp size={20} aria-hidden="true"/>}
      <h2 key={status} className="status-label">{status}</h2>
      {loading&&<button className="text-button" onClick={onStop}>停止</button>}
    </div>
    {!best&&result?.localSearch&&<p className="local-search-summary">本地已比较 {result.localSearch.total} 个组合{result.localSearch.bestDuration!==null&&<> · 估算最短 {formatDuration(result.localSearch.bestDuration)}</>}</p>}
    {error&&<p className="query-error" role="alert">{error}</p>}
    <div className="route-list">
      {plans.map(plan=>{
        const expandable=plan.mode==="metro";
        const selected=selectedPlan?.id===plan.id;
        const open=expandable&&selected;
        const detailsId=`route-${plan.id}`;
        return <article className={`route-card ${open?"active":""} ${!plan.qualified?"is-over-limit":""}`} key={plan.id}>
          <button className="route-card-main" aria-expanded={expandable?open:undefined} aria-controls={expandable?detailsId:undefined} aria-pressed={!expandable?selected:undefined} onClick={()=>onSelect(plan)}>
            <span className={`mode-badge ${plan.mode}`}><ModeIcon mode={plan.mode}/></span>
            <span className="route-card-title"><strong>{plan.title}</strong>{!plan.qualified&&<small>超出 {formatDuration(plan.duration-plan.limit)}</small>}</span>
            <span className="route-card-time"><strong>{formatDuration(plan.duration)}</strong>{plan.qualified&&<Check size={14} aria-label="符合房补条件"/>}</span>
            {expandable&&<ChevronDown size={16} className={open?"rotated":""} aria-hidden="true"/>}
          </button>
          {expandable&&<AnimatedCollapse open={open} id={detailsId}>
          <div className="route-details">
            <ol className="route-timeline">
              {plan.legs.map((leg,index)=>{
                return <li className="timeline-leg" key={index}>
                  <span className={`timeline-node ${leg.mode}`}><ModeIcon mode={leg.mode} size={15}/></span>
                  <div className="timeline-content">
                    <div className="leg-meta"><span>{leg.label}</span><b>{formatDuration(leg.duration)}</b></div>
                    <p className="leg-endpoints"><span>{leg.from}</span><ArrowRight size={12} aria-hidden="true"/><span>{leg.to}</span></p>
                  </div>
                </li>;
              })}
            </ol>
            {plan.legs.length>1&&<div className="calculation" aria-label="分段时长相加">{plan.legs.map(l=>formatDuration(l.duration)).join(" + ")}<span>= {formatDuration(plan.duration)}</span></div>}
            <RouteSource plan={plan} onReview={()=>setReviewPlan(plan)}/>
          </div>
          </AnimatedCollapse>}
        </article>;
      })}
    </div>
    {result?.errors.map((message,index)=><p className="result-note" key={index}>{message}</p>)}
    {!loading&&result&&!result.complete&&!best&&!result.errors.length&&<p className="result-note">已核验方案超时，其余组合为本地估算，尚不能确认不符合。</p>}
    <RouteReviewDialog plan={reviewPlan} onClose={()=>setReviewPlan(null)}/>
  </section>;
}
