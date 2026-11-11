"use client";
import {Check,CircleHelp} from "lucide-react";
import type {CoverageAssessment} from "@/lib/coverage";

const labels={walking:"步行 ≤30分",bicycling:"自行车 ≤20分",metro:"地铁分段计算<20分"};

export default function CoverageResult({assessment,compact=false,blocked=false}:{assessment:CoverageAssessment;compact?:boolean;blocked?:boolean}) {
  const inside=assessment.status==="inside";
  const edge=assessment.status==="edge";
  const status=blocked?"当前区域大概率不在房补范围内，暂不支持计算路线":edge?"边缘地带，是否满足需核验":inside?"符合房补条件":assessment.status==="outside"?"未落入房补范围":"范围数据暂不可用";
  const Heading=compact?"strong":"h2";
  return <section className={`coverage-result ${compact?"compact":"results-section"}`} aria-label="范围判断结果">
    <div className={`result-status ${inside?"pass":edge?"edge":""}`} role="status" aria-live="polite">
      <div className="coverage-summary">
        {inside?<Check size={16} aria-hidden="true"/>:<CircleHelp size={16} aria-hidden="true"/>}
        <Heading className="coverage-status-label">{status}</Heading>{!edge&&!blocked&&<span className="result-method">范围估算</span>}
      </div>
      {inside&&assessment.modes.length>0&&<div className="coverage-matches">{assessment.modes.map(mode=><span key={mode} className={`coverage-match ${mode}`}>{labels[mode]}</span>)}</div>}
    </div>
  </section>;
}
