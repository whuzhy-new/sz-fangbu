"use client";
import {useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from "react";
import {Check,ChevronDown,TrainFront,X} from "lucide-react";
import {distanceMeters,type Coord} from "@/lib/commute";
import {assessMapPick} from "@/lib/coverage";
import type {Coverage} from "@/lib/map-types";
import {METRO_LINE_COLORS} from "@/lib/metro-line-colors";
import {normalizeResidenceName} from "@/lib/residences";
import stationData from "@/public/data/stations.json";

type ResidenceStation=(typeof stationData.stations)[number];
export type StationFilterValue={stations:ResidenceStation[];radius:number};

const joinedLine=stationData.lines.find(line=>line.name==="2号线")?.stations??[];
const liantang=joinedLine.indexOf(stationData.stations.find(station=>station.name==="莲塘")?.id??"");
// The source stores the through-running lines together. Liantang belongs to both.
const lineEightIds=new Set(liantang<0?[]:joinedLine.slice(liantang+1));
const collator=new Intl.Collator("zh-CN-u-co-pinyin");
const stations=stationData.stations.map(station=>({
  ...station,
  lines:[...new Set(station.lines.flatMap(line=>{
    if(line!=="2号线")return [line];
    if(station.name==="莲塘")return ["2号线","8号线"];
    return [lineEightIds.has(station.id)?"8号线":line];
  }))],
})).sort((a,b)=>collator.compare(a.name,b.name));
const maxRadius=2000;
const radii=[{meters:500,label:"500 米"},{meters:1000,label:"1 公里"},{meters:maxRadius,label:"2 公里"}];

function LineBadges({lines}:{lines:string[]}){
  return <span className="station-line-badges">
    {lines.map(line=><span className="station-line-badge" key={line} style={{"--line-color":METRO_LINE_COLORS[line]??"var(--muted)"} as CSSProperties}>{line}</span>)}
  </span>;
}

export function ResidenceStationSummary({value,onClear}:{
  value:StationFilterValue;onClear:()=>void;
}){
  const firstStations=value.stations.slice(0,2).map(station=>station.name).join("、");
  const remaining=value.stations.length-2;
  return <div className="station-filter-chip">
    <span className="station-filter-caption">
      <TrainFront size={15} aria-hidden="true"/>
      <span title={remaining>0?value.stations.map(station=>station.name).join("、"):undefined}>
        {firstStations}{remaining>0&&` +${remaining}`}
      </span>
      <span className="station-filter-distance">{radii.find(item=>item.meters===value.radius)?.label}</span>
      {value.stations.length===1&&<LineBadges lines={value.stations[0].lines}/>}
    </span>
    <button type="button" className="station-filter-clear" aria-label="清除地铁站筛选" onClick={onClear}><X size={15} aria-hidden="true"/></button>
  </div>;
}

export default function ResidenceStationFilter({id,value,query,coverage,officeId,officeLocation,onApply}:{
  id:string;value:StationFilterValue|null;query:string;coverage:Coverage;officeId:string;officeLocation?:number[];
  onApply:(value:StationFilterValue|null)=>void;
}){
  const [draftStations,setDraftStations]=useState<ResidenceStation[]>(value?.stations??[]);
  const [draftRadius,setDraftRadius]=useState(value?.radius??500);
  const [lineFilter,setLineFilter]=useState("");
  const panelId=useId();
  const optionsList=useRef<HTMLUListElement>(null);
  const nearbyStations=useMemo(()=>{
    const available=stations.filter(item=>{
      const distance=assessMapPick(coverage,officeId,item.location as Coord).distanceMeters;
      return distance!==null&&distance<=maxRadius;
    });
    if(officeLocation)available.sort((a,b)=>distanceMeters(officeLocation,a.location)-distanceMeters(officeLocation,b.location));
    return available;
  },[coverage,officeId,officeLocation]);
  const lines=useMemo(()=>[...new Set(nearbyStations.flatMap(station=>station.lines))]
    .sort((a,b)=>a.localeCompare(b,"zh-CN",{numeric:true})),[nearbyStations]);
  const keyword=normalizeResidenceName(query).replace(/(?:\(地铁站\)|地铁站|站)$/,"");
  const checkedStations=new Set(draftStations.map(station=>station.id));
  const orderedStations=!keyword&&value
    ?[...value.stations,...nearbyStations.filter(item=>!value.stations.some(station=>station.id===item.id))]
    :nearbyStations;
  const options=orderedStations.filter(item=>
    (!lineFilter||item.lines.includes(lineFilter))
    &&(!keyword||item.name.includes(keyword)||item.lines.some(line=>line.startsWith(keyword))),
  );

  useLayoutEffect(()=>{
    if(optionsList.current)optionsList.current.scrollTop=0;
  },[keyword,lineFilter]);

  return <section id={id} className="residence-station-filter" aria-label="地铁站筛选">
    <div className="station-filter-controls">
      <fieldset className="station-radii">
        <legend className="field-label">直线距离</legend>
        {radii.map(({meters,label})=><label className="office-choice" key={meters}>
          <input type="radio" name={`${panelId}-radius`} value={meters} checked={draftRadius===meters} onChange={()=>setDraftRadius(meters)}/>
          <span>{label}</span>
        </label>)}
      </fieldset>
      <label className="station-line-select" data-filtered={lineFilter?true:undefined}
        style={lineFilter?{"--line-color":METRO_LINE_COLORS[lineFilter]??"var(--muted)"} as CSSProperties:undefined}>
        <select aria-label="按线路筛选地铁站" value={lineFilter} onChange={event=>setLineFilter(event.target.value)}>
          <option value="">全部线路</option>
          {lines.map(line=><option key={line} value={line}>{line}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden="true"/>
      </label>
    </div>
    {options.length?<ul ref={optionsList} className="station-picker-options" aria-label="地铁站">
      {options.map(item=><li key={item.id}>
        <label className="station-picker-option">
          <input type="checkbox" name={`${panelId}-station`} checked={checkedStations.has(item.id)} onChange={event=>{
            const checked=event.target.checked;
            setDraftStations(previous=>checked?[...previous,item]:previous.filter(station=>station.id!==item.id));
          }}/>
          <span>{item.name}</span><LineBadges lines={item.lines}/>
          <span className="station-picker-check" aria-hidden="true"><Check size={12}/></span>
        </label>
      </li>)}
    </ul>:<p className="search-message" role="status">未找到地铁站</p>}
    <button type="button" className="station-filter-apply" disabled={!draftStations.length&&!value}
      onClick={()=>onApply(draftStations.length?{stations:draftStations,radius:draftRadius}:null)}>
      查看小区{draftStations.length>1&&`（${draftStations.length} 站）`}
    </button>
  </section>;
}
