"use client";
import {useCallback,useEffect,useRef,useState,type CSSProperties,type FocusEvent} from "react";
import {BookOpenText,Building2,Check,ChevronDown,ChevronRight,Circle,CircleDot,CircleHelp,History,Layers,ListOrdered,LoaderCircle,MapPin,RotateCw,Route,Search,Star,Timer,TrainFront,X} from "lucide-react";
import AtlasMap from "./atlas-map";
import RouteResults from "./route-results";
import AnimatedCollapse from "./animated-collapse";
import SavedPlaces from "./saved-places";
import ModeIcon from "./mode-icon";
import {PREFERENCES_KEY,SAVED_PLACES_KEY,placeKey,readPreferences,readSavedPlaces,rememberPlace,toggleFavorite} from "@/lib/commute-storage";
import {assessMapPick} from "@/lib/coverage";
import {visiblePlans} from "@/lib/plan-results";
import {amapPoiId,placePoiId,LIMITS,MODE_LABEL,QUERY_STAGE_LABEL,ROUND_UP_SECONDS,withinShenzhen,type Coord,type Mode,type Office,type Place,type Plan,type QueryStage,type Verification} from "@/lib/commute";
import type {Coverage,RailData} from "@/lib/map-types";

const modes:Mode[]=["walking","bicycling","metro"];
const officeNames:Record<string,string>={innovation:"深圳湾",jinghu:"景湖",prince:"太子"};
const officeOrder=Object.keys(officeNames);
const OFFICE_SELECTED_KEY="shenzhen-housing-map:office-selected";
const panelTools=[{id:"office",label:"工区",icon:Building2},{id:"layers",label:"图层",icon:Layers},{id:"history",label:"历史",icon:History},{id:"rules",label:"规则",icon:CircleHelp},{id:"guide",label:"指南",icon:BookOpenText}] as const;
type PanelTool=typeof panelTools[number]["id"];

export default function CommuteApp() {
  const [offices,setOffices]=useState<Office[]>([]);
  const [activeId,setActiveId]=useState("innovation");
  const [layers,setLayers]=useState<Record<Mode,boolean>>({walking:true,bicycling:true,metro:true});
  const [coverage,setCoverage]=useState<Coverage|null>(null);
  const [query,setQuery]=useState(""),[places,setPlaces]=useState<Place[]>([]);
  const [searching,setSearching]=useState(false),[searchOpen,setSearchOpen]=useState(false),[searchError,setSearchError]=useState(""),[option,setOption]=useState(-1);
  const [searchRequest,setSearchRequest]=useState<{query:string}|null>(null);
  const [home,setHome]=useState<Place|null>(null),[results,setResults]=useState<Record<string,Verification>>({});
  const [pendingLocation,setPendingLocation]=useState<Coord|null>(null);
  const [pendingName,setPendingName]=useState("");
  const [pendingPoiId,setPendingPoiId]=useState<string|undefined>();
  const [loading,setLoading]=useState(false),[currentOffice,setCurrentOffice]=useState(""),[queryStopped,setQueryStopped]=useState(false);
  const [queryStage,setQueryStage]=useState<QueryStage>("surface");
  const [selectedPlan,setSelectedPlan]=useState<Plan|null>(null),[error,setError]=useState("");
  const [mobileOpen,setMobileOpen]=useState(true),[mobileHeight,setMobileHeight]=useState(0);
  const [isMobile,setIsMobile]=useState(false);
  const [needsOffice,setNeedsOffice]=useState(false);
  const [storageReady,setStorageReady]=useState(false),[storageError,setStorageError]=useState("");
  const [recentPlaces,setRecentPlaces]=useState<Place[]>([]),[favorites,setFavorites]=useState<Place[]>([]);
  const [activeTool,setActiveTool]=useState<PanelTool|null>(null),[savedView,setSavedView]=useState<"recent"|"favorites">("recent");
  const [lastTool,setLastTool]=useState<PanelTool|null>(null);
  const preferencesInitialized=useRef(false);
  const mobileContent=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null),manualPlan=useRef(false);
  const abort=useRef<AbortController|null>(null),requestId=useRef(0),settled=useRef(new Set<string>());
  const railRef=useRef<RailData|null>(null),activeRef=useRef(activeId);
  activeRef.current=activeId;
  const result=results[activeId],plans=visiblePlans(result?.plans);

  useEffect(()=>{
    if(selectedPlan?.officeId!==activeId||selectedPlan.metroMethod!=="segmented")return;
    const current=visiblePlans(result?.plans);
    const next=current.find(plan=>plan.id===selectedPlan.id)??current.find(plan=>plan.metroMethod==="segmented")??null;
    if(next!==selectedPlan)setSelectedPlan(next);
  },[result,activeId,selectedPlan]);

  useEffect(()=>{
    if(preferencesInitialized.current)return;
    preferencesInitialized.current=true;
    try {
      const preferences=readPreferences(localStorage.getItem(PREFERENCES_KEY));
      setActiveId(preferences.officeId);setLayers(preferences.layers);
      setNeedsOffice(localStorage.getItem(OFFICE_SELECTED_KEY)!=="1");
      const saved=readSavedPlaces(localStorage.getItem(SAVED_PLACES_KEY));
      setRecentPlaces(saved.recent);setFavorites(saved.favorites);
      if(!saved.recent.length&&saved.favorites.length)setSavedView("favorites");
    } catch {setNeedsOffice(true);}
    setStorageReady(true);
  },[]);

  useEffect(()=>{
    if(!storageReady)return;
    try {localStorage.setItem(PREFERENCES_KEY,JSON.stringify({version:1,officeId:activeId,layers}));}
    catch {setStorageError("浏览器未能保存设置或地点。");}
  },[storageReady,activeId,layers]);

  useEffect(()=>{
    if(!storageReady)return;
    try {localStorage.setItem(SAVED_PLACES_KEY,JSON.stringify({version:1,recent:recentPlaces,favorites}));}
    catch {setStorageError("浏览器未能保存设置或地点。");}
  },[storageReady,recentPlaces,favorites]);

  useEffect(()=>{
    const controller=new AbortController();
    Promise.all([
      fetch("/api/config",{signal:controller.signal}).then(response=>response.json()),
      fetch("/data/coverage.json",{signal:controller.signal}).then(response=>response.ok?response.json():null),
      fetch("/data/metro-plans.json",{signal:controller.signal}).then(response=>response.ok?response.json():null)
    ]).then(([config,cov,metro])=>{
      setOffices((config as {offices:Office[]}).offices??[]);
      setCoverage(cov as Coverage|null);railRef.current=metro as RailData|null;
    }).catch(reason=>{if(reason.name!=="AbortError")setError("数据未能加载，请刷新重试。");});
    return()=>{controller.abort();abort.current?.abort();};
  },[]);

  useEffect(()=>{
    if(!isMobile)return;
    const viewport=window.visualViewport;
    const update=()=>setMobileHeight(Math.floor(viewport?.height??window.innerHeight));
    update();viewport?.addEventListener("resize",update);window.addEventListener("resize",update);
    return()=>{viewport?.removeEventListener("resize",update);window.removeEventListener("resize",update);};
  },[isMobile]);

  useEffect(()=>{
    const media=window.matchMedia("(max-width: 700px)");
    const update=()=>setIsMobile(media.matches);
    update();media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);

  const verify=useCallback(async(place:Place,ids:string[],resetResults=false)=>{
    if(!ids.length)return;
    abort.current?.abort();
    const controller=new AbortController();abort.current=controller;const token=++requestId.current;
    if(resetResults)settled.current.clear();
    setResults(previous=>{
      const next=resetResults?{}:{...previous};
      for(const id of ids)next[id]={officeId:id,plans:[],checked:0,complete:false,errors:[],measuredAt:new Date().toISOString()};
      return next;
    });
    if(resetResults||ids.includes(activeRef.current)){manualPlan.current=false;setSelectedPlan(null);}
    setLoading(true);setQueryStage("surface");setQueryStopped(false);setError("");setMobileOpen(true);setCurrentOffice(ids[0]);
    try {
      const response=await fetch("/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:place.location,name:place.name,poiId:placePoiId(place),officeIds:ids}),signal:controller.signal});
      if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error??"路线查询失败，请重试。");}
      if(!response.body)throw new Error("未取得路线结果，请重试。");
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending="",finished=false;
      const handle=(event:any)=>{
        if(token!==requestId.current)return;
        if(event.type==="office-start"){
          settled.current.delete(event.officeId);setCurrentOffice(event.officeId);setQueryStage("surface");
          setResults(previous=>({...previous,[event.officeId]:{officeId:event.officeId,plans:[],checked:0,complete:false,errors:[],measuredAt:new Date().toISOString()}}));
        }
        if(event.type==="stage"&&Object.hasOwn(QUERY_STAGE_LABEL,event.stage))setQueryStage(event.stage as QueryStage);
        if(event.type==="local-search")setResults(previous=>{
          const old=previous[event.officeId];
          return old?{...previous,[event.officeId]:{...old,localSearch:event.localSearch}}:previous;
        });
        if(event.type==="plan"){
          const plan=event.plan as Plan;
          plan.originalReferenceDuration=event.originalTotalDuration;plan.originalReferenceScope=event.originalReferenceScope;
          if(event.preparedPlanId){
            const base=Object.values(railRef.current?.plans[plan.officeId]??{}).find(candidate=>candidate.id===event.preparedPlanId);
            if(base)plan.legs=plan.legs.map((leg,index)=>index>0?{...leg,paths:base.legs[index-1]?.paths??leg.paths}:leg);
          }
          setResults(previous=>{
            const old=previous[plan.officeId]??{officeId:plan.officeId,plans:[],checked:0,complete:false,errors:[],measuredAt:plan.measuredAt};
            return {...previous,[plan.officeId]:{...old,plans:[...old.plans.filter(candidate=>candidate.id!==plan.id),plan]}};
          });
          if(!manualPlan.current&&plan.qualified&&plan.officeId===activeRef.current)setSelectedPlan(old=>old&&old.officeId===plan.officeId&&old.duration<=plan.duration?old:plan);
        }
        if(event.type==="office-result"){
          const next=event.result as Verification;settled.current.add(next.officeId);
          setResults(previous=>({...previous,[next.officeId]:{...next,plans:next.plans.map(plan=>previous[next.officeId]?.plans.find(old=>old.id===plan.id)??plan)}}));
        }
        if(event.type==="error")setError(event.message);
        if(event.type==="done")finished=true;
      };
      while(true){
        const {done,value}=await reader.read();if(done)break;
        pending+=decoder.decode(value,{stream:true});const lines=pending.split("\n");pending=lines.pop()??"";
        for(const line of lines)if(line.trim())handle(JSON.parse(line));
      }
      pending+=decoder.decode();if(pending.trim())handle(JSON.parse(pending));
      if(!finished&&!controller.signal.aborted&&token===requestId.current)setError("查询中断，已有结果已保留，请重试。");
    } catch(reason) {
      if((reason as Error).name!=="AbortError"&&token===requestId.current)setError(reason instanceof Error?reason.message:"查询未完成，请重试。");
    } finally {
      if(token===requestId.current){setLoading(false);setCurrentOffice("");}
    }
  },[]);

  const choose=useCallback((place:Place)=>{
    const point={...place,location:place.entrance??place.location};
    setPendingLocation(null);setPendingName("");setPendingPoiId(undefined);setHome(point);setQuery(place.name);setSearchOpen(false);setActiveTool(null);setSearchRequest(null);setSearching(false);searchInput.current?.blur();
    setRecentPlaces(previous=>rememberPlace(previous,point));
    mobileContent.current?.scrollTo({top:0});
    verify(point,[activeId],true);
  },[verify,activeId]);

  useEffect(()=>{
    if(!searchRequest)return;
    const controller=new AbortController();
    (async()=>{
      try {
        const response=await fetch(`/api/search?q=${encodeURIComponent(searchRequest.query)}`,{signal:controller.signal});
        const data=await response.json() as {error?:string;places?:Place[]};
        if(!response.ok)throw new Error(data.error??"搜索失败，请重试。");
        if(!controller.signal.aborted)setPlaces(data.places??[]);
      } catch(reason) {
        if(!controller.signal.aborted)setSearchError((reason as Error).message);
      } finally {if(!controller.signal.aborted)setSearching(false);}
    })();
    return()=>controller.abort();
  },[searchRequest]);

  function submitSearch(){
    const value=query.trim();if(value.length<2)return;
    mobileContent.current?.scrollTo({top:0});
    setPlaces([]);setOption(-1);setSearching(true);setSearchError("");setActiveTool(null);setSearchOpen(true);setSearchRequest({query:value});
  }

  useEffect(()=>{
    if(option>=0)document.getElementById(`place-option-${option}`)?.scrollIntoView({block:"nearest"});
  },[option]);

  useEffect(()=>{
    if(!pendingLocation)return;
    const cancel=(event:KeyboardEvent)=>{if(event.key==="Escape"){setPendingLocation(null);setPendingName("");setMobileOpen(true);}};
    window.addEventListener("keydown",cancel);
    return()=>window.removeEventListener("keydown",cancel);
  },[pendingLocation]);

  function stopVerification(){
    abort.current?.abort();requestId.current++;setLoading(false);setCurrentOffice("");setQueryStopped(true);
  }
  function switchOffice(id:string){
    try {localStorage.setItem(OFFICE_SELECTED_KEY,"1");}catch {setStorageError("浏览器未能保存设置或地点。");}
    if(isMobile&&needsOffice)setNeedsOffice(false);
    setActiveTool("office");setMobileOpen(true);
    if(id===activeId)return;
    setActiveId(id);activeRef.current=id;manualPlan.current=false;
    setSelectedPlan(visiblePlans(results[id]?.plans).find(plan=>plan.qualified)??null);
    if(home&&!settled.current.has(id))verify(home,[id]);
  }
  function reset(){
    abort.current?.abort();requestId.current++;settled.current.clear();
    setLoading(false);setCurrentOffice("");setQueryStopped(false);setPendingLocation(null);setPendingName("");setHome(null);setResults({});setSelectedPlan(null);
    setQuery("");setPlaces([]);setSearchRequest(null);setSearching(false);setSearchOpen(false);setActiveTool(null);setError("");setSearchError("");searchInput.current?.focus();
  }
  function pick(location:Coord,name?:string,poiId?:string){
    if(isMobile&&needsOffice){setMobileOpen(true);return;}
    if(!withinShenzhen(location)){setError("请选择深圳范围内的位置。");return;}
    if(loading)stopVerification();
    setPendingLocation(location);setPendingName(name?.trim().slice(0,120)||"地图选点");setPendingPoiId(amapPoiId(poiId));setSearchOpen(false);setActiveTool(null);
    if(window.matchMedia("(max-width: 700px)").matches)setMobileOpen(false);
  }
  function confirmPick(){
    if(pendingLocation&&assessMapPick(coverage,activeId,pendingLocation).allowed)choose({id:"map-point",kind:"map",name:pendingName,address:"",location:pendingLocation,poiId:pendingPoiId});
  }
  const showOptions=searchOpen&&searchRequest?.query===query.trim();
  const activeLoading=loading&&(!settled.current.has(activeId)||currentOffice===activeId);
  const homeSaved=!!home&&favorites.some(point=>placeKey(point)===placeKey(home));
  const expandedTool=isMobile&&needsOffice?"office":activeTool;
  const contentTool=expandedTool??lastTool;
  useEffect(()=>{if(expandedTool)setLastTool(expandedTool);},[expandedTool]);
  const showAnalysis=!expandedTool&&!showOptions&&query.trim()===home?.name;
  const closeSearchLists=(event:FocusEvent<HTMLElement>)=>{if(!event.currentTarget.contains(event.relatedTarget))setSearchOpen(false);};
  const officeField=(<fieldset className="office-section"><legend className="field-label">{isMobile&&needsOffice?"选择办公工区":"办公工区"}</legend>
            <div className="office-cards">
              {[...offices].sort((a,b)=>officeOrder.indexOf(a.id)-officeOrder.indexOf(b.id)).map(office=>{
                const checked=!(isMobile&&needsOffice)&&activeId===office.id;
                const Indicator=checked?CircleDot:Circle;
                return <label className="office-choice" key={office.id}>
                  <input type="radio" name="office" aria-label={office.name} checked={checked} onChange={()=>switchOffice(office.id)}/>
                  <Indicator size={14} strokeWidth={1.7} aria-hidden="true"/><span className="office-choice-name">{officeNames[office.id]??office.name}</span>
                </label>;
              })}
              {!offices.length&&<span className="office-placeholder" role="status">加载工区…</span>}
            </div>
          </fieldset>);
  const layerField=(<fieldset className="layer-section"><legend className="field-label">范围图层</legend><div className="layer-chips">
            {modes.map(mode=><label key={mode} className={`layer-chip ${mode}`}>
              <input type="checkbox" aria-label={`${MODE_LABEL[mode]} ${mode==="walking"?"30":"20"}分钟`} checked={layers[mode]} onChange={event=>setLayers(previous=>({...previous,[mode]:event.target.checked}))}/>
              <span className="layer-check" aria-hidden="true"><Check size={12}/></span><span>{mode==="walking"?"步行 30分":mode==="bicycling"?"骑行 20分":"地铁 20分"}</span>
            </label>)}
          </div></fieldset>);
  const searchField=(<div className={`search-input ${searchOpen?"focused":""}`}>
              <Search size={18} aria-hidden="true"/>
              <input ref={searchInput} id="place-query" value={query} disabled={isMobile&&needsOffice} placeholder={isMobile&&needsOffice?"先选择办公工区":"搜索小区或地址"} aria-label="搜索小区或地址" role="combobox" aria-expanded={showOptions} aria-controls="place-options" aria-activedescendant={option>=0&&places[option]?`place-option-${option}`:undefined} aria-autocomplete="list" aria-describedby={searchError?"search-error":undefined} autoComplete="off" enterKeyHint="search"
                onFocus={()=>{setActiveTool(null);if(isMobile)setMobileOpen(true);if(searchRequest?.query===query.trim())setSearchOpen(true);}}
                onChange={event=>{setQuery(event.target.value);setSearchOpen(false);setActiveTool(null);setSearchRequest(null);setSearching(false);setSearchError("");setOption(-1);}}
                onKeyDown={event=>{
                  if(event.key==="Enter"){
                    if(event.nativeEvent.isComposing||event.keyCode===229)return;event.preventDefault();
                    if(showOptions&&option>=0&&places[option])choose(places[option]);else submitSearch();
                  }
                  if(event.key==="ArrowDown"&&searchRequest?.query===query.trim()&&places.length){event.preventDefault();setSearchOpen(true);setOption(index=>(index+1)%places.length);}
                  if(event.key==="ArrowUp"&&searchRequest?.query===query.trim()&&places.length){event.preventDefault();setSearchOpen(true);setOption(index=>(index-1+places.length)%places.length);}
                  if(event.key==="Escape"){setSearchOpen(false);setActiveTool(null);setOption(-1);}
                }}/>
              {searching?<LoaderCircle className="spin" size={17} aria-label="正在搜索"/>:query?<button className="icon-button" aria-label="清除地点" onClick={reset}><X size={17}/></button>:null}
            </div>);
  const searchChoices=(<>
    <AnimatedCollapse open={showOptions} className="search-reveal">
            <div className="search-options" id="place-options" role="listbox" aria-label="搜索结果" aria-busy={searching}>
              {searching?<p className="search-message" role="status">正在搜索…</p>:searchError?<p className="search-message query-error" id="search-error" role="alert">{searchError}</p>:places.length?places.map((place,index)=><button id={`place-option-${index}`} key={place.id} role="option" aria-selected={option===index} className={option===index?"highlighted":""} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(place)}>
                <MapPin size={17} aria-hidden="true"/><span><strong>{place.name}</strong><small>{place.address}</small></span>
              </button>):searchRequest?<p className="search-message">未找到地点</p>:null}
            </div>
            </AnimatedCollapse>
  </>);
  const analysis=(<>
    {showAnalysis&&home&&<div className="selected-home"><span>拖动标记可调整入口</span><div className="selected-home-actions"><button className="icon-button place-save-button" aria-label={homeSaved?"取消收藏地点":"收藏地点"} title={homeSaved?"取消收藏":"收藏地点"} aria-pressed={homeSaved} onClick={()=>setFavorites(previous=>toggleFavorite(previous,home))}><Star size={16} fill={homeSaved?"currentColor":"none"} aria-hidden="true"/></button><button className="text-button" onClick={()=>verify(home,[activeId])} disabled={loading}><RotateCw size={13} aria-hidden="true"/>重新核验</button></div></div>}
          {storageError&&<p className="storage-error" role="status">{storageError}</p>}
          {showAnalysis&&home&&<RouteResults result={result} plans={plans} selectedPlan={selectedPlan} loading={activeLoading} queryStage={queryStage} stopped={queryStopped&&!settled.current.has(activeId)} error={error} onStop={stopVerification} onSelect={plan=>{manualPlan.current=true;setSelectedPlan(selectedPlan?.id===plan.id?null:plan);}}/>}
          {!home&&error&&<p className="query-error" role="alert">{error}</p>}
          {loading&&!activeLoading&&<div className="background-check" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true"/><span>正在查询{QUERY_STAGE_LABEL[queryStage]}方案</span><button className="text-button" onClick={stopVerification}>停止</button></div>}
  </>);
  function toggleTool(tool:PanelTool){
    if(isMobile&&needsOffice&&tool!=="office")return;
    const next=expandedTool===tool&&(!isMobile||mobileOpen)?null:tool;
    setSearchOpen(false);setActiveTool(next);searchInput.current?.blur();
    if(isMobile)setMobileOpen(next!==null||!!home);
    mobileContent.current?.scrollTo({top:0});
  }
  const toolEntries=(<div className="query-tools" role="group" aria-label="地图功能">{panelTools.map(({id,label,icon:Icon})=><button key={id} id={`query-tool-${id}`} className={expandedTool===id?"is-active":""} aria-expanded={expandedTool===id&&(!isMobile||mobileOpen)} aria-controls="query-tool-content" disabled={isMobile&&needsOffice&&id!=="office"} onClick={()=>toggleTool(id)}><Icon size={15} aria-hidden="true"/>{label}</button>)}</div>);
  const toolContent=(<AnimatedCollapse open={!!expandedTool} id="query-tool-content" className="query-tool-reveal"><div key={contentTool} className="query-tool-panel" data-tool={contentTool??undefined} role={contentTool?"region":undefined} aria-labelledby={contentTool?`query-tool-${contentTool}`:undefined}>
    {contentTool==="office"&&officeField}
    {contentTool==="layers"&&layerField}
    {contentTool==="history"&&<SavedPlaces recent={recentPlaces} favorites={favorites} view={savedView} onView={setSavedView} onChoose={choose} onFavorite={point=>setFavorites(previous=>toggleFavorite(previous,point))} onClearRecent={()=>setRecentPlaces([])}/>}
    {contentTool==="rules"&&<div className="tool-rules">
      <div className="tool-limits">{modes.map(mode=><div className={mode} key={mode}><span><ModeIcon mode={mode} size={14}/>{mode==="walking"?"步行":mode==="bicycling"?"自行车":"地铁"}</span><strong>{LIMITS[mode]/60}<small>分内</small></strong></div>)}</div>
      <ul className="tool-rule-list">
        <li><MapPin size={15} aria-hidden="true"/><div><h3>起终点</h3><p>小区门口 → 办公地点</p></div></li>
        <li><ListOrdered size={15} aria-hidden="true"/><div><h3>查询顺序</h3><p>步行／骑行 → 完整地铁 → 分段地铁</p><p>满足时限即停止查询</p></div></li>
        <li><TrainFront size={15} aria-hidden="true"/><div><h3>完整地铁</h3><p>取高德完整路线的总时长</p></div></li>
        <li><Route size={15} aria-hidden="true"/><div><h3>分段地铁</h3><p>进站接驳＋地铁＋出站接驳</p><p>接驳可步行或骑行</p><p>地铁段只计乘车和站内换乘</p></div></li>
        <li><Timer size={15} aria-hidden="true"/><div><h3>时长取整</h3><p>满 {ROUND_UP_SECONDS} 秒进 1 分，不足则舍去</p><p>每段至少 1 分，先取整再相加</p></div></li>
      </ul>
    </div>}
    {contentTool==="guide"&&<div className="tool-guide">
      <ol className="guide-steps" role="list">
        <li><button type="button" className="guide-step guide-step-link" aria-controls="query-tool-content" onClick={()=>{toggleTool("office");document.getElementById("query-tool-office")?.focus({preventScroll:true});}}><span className="guide-step-number" aria-hidden="true">1</span><strong>选择工区</strong><ChevronRight size={15} aria-hidden="true"/></button></li>
        <li className="guide-step"><span className="guide-step-number" aria-hidden="true">2</span><div><h3>查地点</h3><p>输入小区名或地址，按 Enter 搜索。</p><p>也可在地图上选小区门口，再点「确认地点」。</p></div></li>
        <li className="guide-step"><span className="guide-step-number" aria-hidden="true">3</span><div><h3>看方案</h3><p>先看是否符合时限，再看通勤用时。</p><p>展开分段地铁方案，查看各段用时。</p></div></li>
        <li className="guide-step"><span className="guide-step-number" aria-hidden="true">4</span><div><h3>上高德截图</h3><p>点「上高德看路线」。</p><p>手机直接打开高德，电脑用手机扫码。</p><p>核对路线后截图，分段方案每段各截一张。</p></div></li>
      </ol>
      <div className="guide-links"><a href="/guide.html" target="_blank" rel="noopener noreferrer">图文指南</a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors / ODbL</a></div>
    </div>}
  </div></AnimatedCollapse>);
  function toggleMobilePanel(){
    if(mobileOpen){setSearchOpen(false);setActiveTool(null);searchInput.current?.blur();}
    setMobileOpen(open=>!open);
  }
  const hasBody=!!(expandedTool||showOptions||(showAnalysis&&home)||storageError||error||(loading&&!activeLoading));
  const queryHeader=(<div className="query-header">
    <h1 className="search-panel-title"><MapPin size={19} aria-hidden="true"/><span>深圳房补地图</span><span className="brand-signature"><span>for</span><span className="brand-badge">Bytedancers</span></span></h1>
    <div className={isMobile?"mobile-panel-header":"search-section"}>
      <label className="sr-only" htmlFor="place-query">居住地点</label>
      {searchField}
      {isMobile&&!needsOffice&&(expandedTool||home||showOptions)&&<button className="icon-button mobile-panel-toggle" title={mobileOpen?"收起选择与结果":"展开选择与结果"} aria-label={mobileOpen?"收起选择与结果":"展开选择与结果"} aria-expanded={mobileOpen} aria-controls="query-panel-content" onClick={toggleMobilePanel}><ChevronDown size={18} aria-hidden="true"/></button>}
    </div>
    {toolEntries}
  </div>);
  const queryBody=(<div className={`query-content ${hasBody?"has-content":""}`}>
    {toolContent}
    {!(isMobile&&needsOffice)&&searchChoices}
    {!(isMobile&&needsOffice)&&analysis}
  </div>);

  return <main className="atlas-app">
    <div className={`workspace ${mobileOpen?"is-panel-open":""}`} style={isMobile&&mobileHeight?{"--mobile-viewport-height":`${mobileHeight}px`} as CSSProperties:undefined}>
      <div className={`panel-columns ${mobileOpen?"is-open":""}`}>
      <aside id="place-query-panel" className={`side-panel query-stack ${isMobile?"mobile-panel":"search-panel"}`} aria-label="工区、图层与地点查询" onBlur={closeSearchLists}>
        {queryHeader}
        <AnimatedCollapse open={hasBody&&(!isMobile||mobileOpen)} id="query-panel-content" className="query-reveal">
          <div className="query-sheet"><div ref={mobileContent} className={isMobile?"mobile-panel-body":"panel-scroll"}>{queryBody}</div></div>
        </AnimatedCollapse>
      </aside>
      </div>
      <AtlasMap offices={offices} activeId={activeId} showAll={false} layers={layers} coverage={coverage} home={home} plan={selectedPlan} pendingLocation={pendingLocation} pendingName={pendingName} onPick={pick} onConfirmPick={confirmPick} onCancelPick={()=>{setPendingLocation(null);setPendingName("");setMobileOpen(true);}} mobileOpen={mobileOpen}/>
    </div>
  </main>;
}
