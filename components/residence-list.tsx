"use client";
import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from "react";
import {Check,ChevronLeft,ChevronRight,MapPin,Search,SlidersHorizontal,TrainFront} from "lucide-react";
import {distanceMeters,type Coord} from "@/lib/commute";
import {assessCoverageDetails,COVERAGE_EDGE_METERS} from "@/lib/coverage";
import type {Coverage} from "@/lib/map-types";
import {nearbyResidenceStations,normalizeResidenceName,propertyTypeLabel,residences} from "@/lib/residences";
import ModeIcon from "./mode-icon";
import ResidenceStationFilter,{ResidenceStationSummary,type StationFilterValue} from "./residence-station-filter";

const batchSize=24;
const alphabet=Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ#");
const collator=new Intl.Collator("zh-CN-u-co-pinyin");
const sortedResidences=[...residences].sort((a,b)=>
  alphabet.indexOf(a.initial)-alphabet.indexOf(b.initial)||collator.compare(a.name,b.name),
);

function stationDistanceLabel(meters:number){
  const rounded=Math.round(meters);
  return rounded<1000?`${rounded} 米`:`${Math.round(rounded/100)/10} 公里`;
}

export default function ResidenceList({coverage,officeId,officeLocation,onPick}:{
  coverage:Coverage|null;officeId:string;officeLocation?:number[];onPick:(location:Coord,name:string,poiId:string,typeLabel?:string)=>void;
}){
  const [query,setQuery]=useState("");
  const [stationQuery,setStationQuery]=useState("");
  const [stationFilter,setStationFilter]=useState<StationFilterValue|null>(null);
  const [filterOpen,setFilterOpen]=useState(false);
  const [visibleCount,setVisibleCount]=useState(batchSize);
  const [activeInitial,setActiveInitial]=useState<string|null>(null);
  const list=useRef<HTMLDivElement>(null);
  const index=useRef<HTMLDivElement>(null);
  const filterButton=useRef<HTMLButtonElement>(null);
  const filterId=useId();
  const pendingInitial=useRef<string|null>(null);
  const jumpScrollTop=useRef<number|null>(null);
  const qualified=useMemo(()=>coverage?sortedResidences.flatMap(place=>{
    const {status,interiorModes}=assessCoverageDetails(coverage,officeId,(place.entrance??place.location) as Coord,COVERAGE_EDGE_METERS);
    return status==="inside"?[{...place,surfaceModes:interiorModes.filter(mode=>mode!=="metro")}]:[];
  }):[],[coverage,officeId]);
  const stationsByResidence=useMemo(()=>new Map(qualified.filter(place=>!place.surfaceModes.length).map(place=>
    [place.id,nearbyResidenceStations(place.entrance??place.location)],
  )),[qualified]);
  const search=normalizeResidenceName(query);
  const stationFilterKey=stationFilter?`${stationFilter.stations.map(station=>station.id).join(",")}:${stationFilter.radius}`:"all";
  const matches=useMemo(()=>{
    const results=qualified.flatMap(place=>{
      if(search&&!normalizeResidenceName(place.name).includes(search))return [];
      const location=place.entrance??place.location;
      const selectedStations=stationFilter?stationFilter.stations.flatMap(station=>{
        const distance=distanceMeters(location,station.location);
        return distance<=stationFilter.radius?[{id:station.id,name:station.name,distance}]:[];
      }).sort((a,b)=>a.distance-b.distance):[];
      if(stationFilter&&!selectedStations.length)return [];
      return [{...place,selectedStations}];
    });
    if(stationFilter)results.sort((a,b)=>a.selectedStations[0].distance-b.selectedStations[0].distance);
    return results;
  },[qualified,search,stationFilter]);
  const groups=useMemo(()=>{
    const byInitial=new Map<string,{start:number;places:typeof matches}>();
    if(stationFilter)return byInitial;
    matches.forEach((place,index)=>{
      const group=byInitial.get(place.initial);
      if(group)group.places.push(place);
      else byInitial.set(place.initial,{start:index,places:[place]});
    });
    return byInitial;
  },[matches,stationFilter]);

  function scrollToInitial(initial:string){
    const container=list.current;
    const group=container?.querySelector<HTMLElement>(`[data-initial="${initial}"]`);
    if(!container||!group)return false;
    container.scrollTop=group.offsetTop;
    // The browser may clamp a jump near the end of the list.
    jumpScrollTop.current=container.scrollTop;
    group.querySelector("h3")?.focus({preventScroll:true});
    return true;
  }

  useLayoutEffect(()=>{
    if(!pendingInitial.current)return;
    scrollToInitial(pendingInitial.current);
    pendingInitial.current=null;
  },[visibleCount]);

  useLayoutEffect(()=>{
    const rail=index.current;
    const active=rail?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    if(filterOpen||!rail||!active)return;
    const top=active.offsetTop,bottom=top+active.offsetHeight;
    if(top<rail.scrollTop)rail.scrollTop=top;
    else if(bottom>rail.scrollTop+rail.clientHeight)rail.scrollTop=bottom-rail.clientHeight;
  },[activeInitial,filterOpen,groups]);

  useEffect(()=>{
    const container=list.current;
    if(!container||filterOpen||visibleCount>=matches.length)return;
    const observer=new ResizeObserver(()=>{
      if(container.clientHeight>0&&container.scrollHeight<=container.clientHeight+1){
        setVisibleCount(count=>Math.min(matches.length,count+batchSize));
      }
    });
    observer.observe(container);
    return ()=>observer.disconnect();
  },[filterOpen,matches.length,stationFilter,visibleCount]);

  function jumpToInitial(initial:string){
    const group=groups.get(initial);
    if(!group)return;
    setActiveInitial(initial);
    if(scrollToInitial(initial))return;
    pendingInitial.current=initial;
    setVisibleCount(Math.min(matches.length,group.start+batchSize));
  }

  function resetList(){
    pendingInitial.current=null;
    jumpScrollTop.current=null;
    if(list.current)list.current.scrollTop=0;
    setVisibleCount(batchSize);
    setActiveInitial(null);
  }

  function applyStationFilter(next:StationFilterValue|null){
    const nextKey=next?`${next.stations.map(station=>station.id).join(",")}:${next.radius}`:"all";
    if(stationFilterKey!==nextKey){
      setStationFilter(next);
      resetList();
    }
    setFilterOpen(false);
    filterButton.current?.focus({preventScroll:true});
  }

  function renderRows(places:typeof matches){
    return <ul>
      {places.map(place=>{
        const location=place.entrance??place.location;
        const nearby=stationsByResidence.get(place.id)??[];
        const {selectedStations}=place;
        const stations=[...selectedStations,...nearby.filter(station=>!selectedStations.some(match=>match.id===station.id))].slice(0,2);
        return <li key={place.id}>
          <button type="button" onClick={()=>onPick(location as Coord,place.name,place.id,propertyTypeLabel(place.kind))}>
            <MapPin size={15} aria-hidden="true"/>
            <span className="residence-row-copy">
              <span className="residence-row-name">{place.name}</span>
              {place.surfaceModes.length>0?<span className="residence-row-modes">
                {place.surfaceModes.map(mode=><span className={`residence-row-mode ${mode}`} key={mode}>
                  <ModeIcon mode={mode} size={12}/>{mode==="walking"?"步行可达":"自行车可达"}
                </span>)}
              </span>:stations.length>0&&<span className="residence-row-stations">
                <TrainFront size={12} aria-hidden="true"/>
                <span>{stations.map(station=>`${station.name} ${stationDistanceLabel(station.distance)}`).join(" · ")}</span>
              </span>}
            </span>
            <ChevronRight size={14} aria-hidden="true"/>
          </button>
        </li>;
      })}
    </ul>;
  }

  if(!coverage)return <p className="search-message" role="status">暂无通勤范围</p>;

  return <div className="residence-browser">
    <div className="residence-toolbar">
      <label className="residence-filter">
        <Search size={15} aria-hidden="true"/>
        <input type="search" aria-label={filterOpen?"搜索地铁站":"搜索小区"} placeholder={filterOpen?"搜索站名或线路":"搜索"}
          value={filterOpen?stationQuery:query} onChange={event=>{
            const value=event.target.value;
            if(filterOpen)setStationQuery(value);
            else {setQuery(value);resetList();}
          }}/>
      </label>
      <button ref={filterButton} type="button" className="station-filter-toggle" aria-expanded={filterOpen}
        aria-label={filterOpen?"返回小区列表":"按地铁站筛选"}
        aria-controls={filterOpen?filterId:undefined} onClick={()=>{setStationQuery("");setFilterOpen(!filterOpen);}}>
        {filterOpen?<ChevronLeft size={15} aria-hidden="true"/>:<SlidersHorizontal size={15} aria-hidden="true"/>}
      </button>
    </div>
    {filterOpen&&<ResidenceStationFilter id={filterId} value={stationFilter} query={stationQuery} coverage={coverage}
      officeId={officeId} officeLocation={officeLocation} onApply={applyStationFilter}/>}
    <div className="residence-results-view" hidden={filterOpen}>
      {stationFilter&&<ResidenceStationSummary value={stationFilter} onClear={()=>{
        setStationFilter(null);resetList();filterButton.current?.focus({preventScroll:true});
      }}/>}
      {matches.length>0?<>
        <div className="residence-results">
          {groups.size>1&&<div ref={index} className="residence-index" role="group" aria-label="按拼音首字母跳转">
            {[...groups.keys()].map(initial=>
              <button type="button" key={initial} aria-current={(activeInitial??matches[0].initial)===initial?"true":undefined} onClick={()=>jumpToInitial(initial)}>{initial}</button>,
            )}
          </div>}
          <div key={stationFilterKey} ref={list} className="residence-list" role="region" aria-label="小区列表" aria-describedby="residence-status" tabIndex={0} onScroll={event=>{
            const container=event.currentTarget;
            const {scrollHeight,clientHeight,scrollTop}=container;
            const remaining=scrollHeight-clientHeight-scrollTop;
            if(remaining<120&&visibleCount<matches.length){
              setVisibleCount(count=>Math.min(matches.length,count+batchSize));
            }
            if(stationFilter||pendingInitial.current||(jumpScrollTop.current!==null&&Math.abs(jumpScrollTop.current-scrollTop)<1))return;
            jumpScrollTop.current=null;
            const atEnd=remaining<=1&&visibleCount>=matches.length;
            let current=matches[0].initial;
            for(const section of container.querySelectorAll<HTMLElement>("[data-initial]")){
              if(!atEnd&&section.offsetTop>scrollTop+1)break;
              current=section.dataset.initial??current;
            }
            setActiveInitial(current);
          }}>
            {stationFilter?renderRows(matches.slice(0,visibleCount)):[...groups].filter(([,group])=>group.start<visibleCount).map(([initial,group])=>
              <section key={initial} data-initial={initial}>
                <h3 tabIndex={-1}>{initial}</h3>
                {renderRows(group.places.slice(0,visibleCount-group.start))}
              </section>,
            )}
          </div>
        </div>
        <div className="residence-status" id="residence-status"><Check size={14} aria-hidden="true"/>以上小区经估算，符合房补条件</div>
      </>:<p className="search-message" role="status">{search||stationFilter?"未找到符合条件的小区":"暂无符合条件的小区"}</p>}
    </div>
  </div>;
}
