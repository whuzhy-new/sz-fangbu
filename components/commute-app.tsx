"use client";
import {useCallback,useEffect,useRef,useState,type CSSProperties} from "react";
import {Check,ChevronDown,CircleHelp,History,LoaderCircle,MapPin,RotateCw,Search,Star,X} from "lucide-react";
import AtlasMap from "./atlas-map";
import RouteResults from "./route-results";
import RulesDialog from "./rules-dialog";
import AnimatedCollapse from "./animated-collapse";
import SavedPlaces from "./saved-places";
import {PREFERENCES_KEY,SAVED_PLACES_KEY,placeKey,readPreferences,readSavedPlaces,rememberPlace,toggleFavorite} from "@/lib/commute-storage";
import {assessMapPick} from "@/lib/coverage";
import {amapPoiId,placePoiId,MODE_LABEL,QUERY_STAGE_LABEL,withinShenzhen,type Coord,type Mode,type Office,type Place,type Plan,type QueryStage,type Verification} from "@/lib/commute";
import type {Coverage,RailData,Validation} from "@/lib/map-types";

const modes:Mode[]=["walking","bicycling","metro"];
const officeNames:Record<string,string>={innovation:"深圳湾",jinghu:"景湖",prince:"太子"};
const officeOrder=Object.keys(officeNames);
const SETTINGS_VISITED_KEY="shenzhen-housing-map:settings-visited";
const validPlans=(plans:Plan[]=[])=>plans.filter(plan=>plan.mode!=="metro"||plan.metroMethod==="full"||plan.legs.find(leg=>leg.mode==="metro")?.from===plan.title.replace(/^经/,"")).sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.duration-b.duration);

export default function CommuteApp() {
  const [offices,setOffices]=useState<Office[]>([]);
  const [activeId,setActiveId]=useState("innovation");
  const [layers,setLayers]=useState<Record<Mode,boolean>>({walking:true,bicycling:true,metro:true});
  const [coverage,setCoverage]=useState<Coverage|null>(null),[rail,setRail]=useState<RailData|null>(null),[validation,setValidation]=useState<Validation|null>(null);
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
  const [info,setInfo]=useState(false),[mobileOpen,setMobileOpen]=useState(true),[panelHeight,setPanelHeight]=useState(360);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [storageReady,setStorageReady]=useState(false),[storageError,setStorageError]=useState("");
  const [recentPlaces,setRecentPlaces]=useState<Place[]>([]),[favorites,setFavorites]=useState<Place[]>([]);
  const [savedOpen,setSavedOpen]=useState(false),[savedView,setSavedView]=useState<"recent"|"favorites">("recent");
  const settingsInitialized=useRef(false);
  const panel=useRef<HTMLElement>(null),searchInput=useRef<HTMLInputElement>(null),manualPlan=useRef(false);
  const abort=useRef<AbortController|null>(null),requestId=useRef(0),settled=useRef(new Set<string>());
  const railRef=useRef<RailData|null>(null),activeRef=useRef(activeId);
  activeRef.current=activeId;
  const result=results[activeId],plans=validPlans(result?.plans);

  useEffect(()=>{
    if(settingsInitialized.current)return;
    settingsInitialized.current=true;
    try {
      setSettingsOpen(!window.matchMedia("(max-width: 700px)").matches&&localStorage.getItem(SETTINGS_VISITED_KEY)!=="1");
      localStorage.setItem(SETTINGS_VISITED_KEY,"1");
    } catch {
      setSettingsOpen(!window.matchMedia("(max-width: 700px)").matches);
    }
    try {
      const preferences=readPreferences(localStorage.getItem(PREFERENCES_KEY));
      setActiveId(preferences.officeId);setLayers(preferences.layers);
      const saved=readSavedPlaces(localStorage.getItem(SAVED_PLACES_KEY));
      setRecentPlaces(saved.recent);setFavorites(saved.favorites);setSavedOpen(!!(saved.recent.length||saved.favorites.length));
      if(!saved.recent.length&&saved.favorites.length)setSavedView("favorites");
    } catch {}
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
      fetch("/data/metro-plans.json",{signal:controller.signal}).then(response=>response.ok?response.json():null),
      fetch("/data/validation.json",{signal:controller.signal}).then(response=>response.ok?response.json():null)
    ]).then(([config,cov,metro,val])=>{
      setOffices((config as {offices:Office[]}).offices??[]);
      setCoverage(cov as Coverage|null);setRail(metro as RailData|null);railRef.current=metro as RailData|null;setValidation(val as Validation|null);
    }).catch(reason=>{if(reason.name!=="AbortError")setError("数据未能加载，请刷新重试。");});
    return()=>{controller.abort();abort.current?.abort();};
  },[]);

  useEffect(()=>{
    if(!panel.current)return;
    const observer=new ResizeObserver(entries=>setPanelHeight(Math.ceil(entries[0].contentRect.height)));
    observer.observe(panel.current);
    return()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    const media=window.matchMedia("(max-width: 700px)");
    const update=()=>{if(media.matches)setSettingsOpen(false);setMobileOpen(true);};
    media.addEventListener("change",update);
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
    if(window.matchMedia("(max-width: 700px)").matches)setSettingsOpen(false);
    try {
      const response=await fetch("/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:place.location,name:place.name,poiId:placePoiId(place),officeIds:ids}),signal:controller.signal});
      if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error??"路线查询失败，请重试。");}
      if(!response.body)throw new Error("未取得路线结果，请重试。");
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending="";
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
      };
      while(true){
        const {done,value}=await reader.read();if(done)break;
        pending+=decoder.decode(value,{stream:true});const lines=pending.split("\n");pending=lines.pop()??"";
        for(const line of lines)if(line.trim())handle(JSON.parse(line));
      }
      pending+=decoder.decode();if(pending.trim())handle(JSON.parse(pending));
    } catch(reason) {
      if((reason as Error).name!=="AbortError"&&token===requestId.current)setError(reason instanceof Error?reason.message:"查询未完成，请重试。");
    } finally {
      if(token===requestId.current){setLoading(false);setCurrentOffice("");}
    }
  },[]);

  const choose=useCallback((place:Place)=>{
    const point={...place,location:place.entrance??place.location};
    setPendingLocation(null);setPendingName("");setPendingPoiId(undefined);setHome(point);setQuery(place.name);setSearchOpen(false);setSavedOpen(false);setSearchRequest(null);setSearching(false);searchInput.current?.blur();
    setRecentPlaces(previous=>rememberPlace(previous,point));
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
    setPlaces([]);setOption(-1);setSearching(true);setSearchError("");setSavedOpen(false);setSearchOpen(true);setSearchRequest({query:value});
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
    if(id===activeId)return;
    setActiveId(id);activeRef.current=id;manualPlan.current=false;
    setSelectedPlan(validPlans(results[id]?.plans).find(plan=>plan.qualified)??null);
    if(home&&!settled.current.has(id))verify(home,[id]);
  }
  function reset(){
    abort.current?.abort();requestId.current++;settled.current.clear();
    setLoading(false);setCurrentOffice("");setQueryStopped(false);setPendingLocation(null);setPendingName("");setHome(null);setResults({});setSelectedPlan(null);
    setQuery("");setPlaces([]);setSearchRequest(null);setSearching(false);setSearchOpen(false);setSavedOpen(!!(recentPlaces.length||favorites.length));setError("");setSearchError("");searchInput.current?.focus();
  }
  function pick(location:Coord,name?:string,poiId?:string){
    if(!withinShenzhen(location)){setError("请选择深圳范围内的位置。");return;}
    if(loading)stopVerification();
    setPendingLocation(location);setPendingName(name?.trim().slice(0,120)||"地图选点");setPendingPoiId(amapPoiId(poiId));setSearchOpen(false);
    if(window.matchMedia("(max-width: 700px)").matches){setMobileOpen(false);setSettingsOpen(false);}
  }
  function toggleSettings(){
    const open=!settingsOpen;setSettingsOpen(open);
    if(window.matchMedia("(max-width: 700px)").matches&&!pendingLocation)setMobileOpen(!open);
  }
  function confirmPick(){
    if(pendingLocation&&assessMapPick(coverage,activeId,pendingLocation).allowed)choose({id:"map-point",kind:"map",name:pendingName,address:"",location:pendingLocation,poiId:pendingPoiId});
  }
  const showOptions=searchOpen&&searchRequest?.query===query.trim();
  const activeLoading=loading&&(!settled.current.has(activeId)||currentOffice===activeId);
  const hasSavedPlaces=!!(recentPlaces.length||favorites.length);
  const homeSaved=!!home&&favorites.some(point=>placeKey(point)===placeKey(home));

  return <main className="atlas-app">
    <div className={`workspace ${mobileOpen?"is-panel-open":""}`} style={{"--panel-height":`${panelHeight}px`} as CSSProperties}>
      <div className={`panel-columns ${mobileOpen?"is-open":""}`}>
      <aside className={`side-panel settings-panel ${settingsOpen?"is-expanded":""}`} aria-label="工区与图层">
        <div className="panel-scroll">
          <div className="panel-title"><h1><button className="settings-toggle" title={settingsOpen?"收起工区与图层":"展开工区与图层"} aria-expanded={settingsOpen} aria-controls="office-layer-settings" onClick={toggleSettings}><span>深圳房补地图</span><ChevronDown size={17} aria-hidden="true"/></button></h1><button className="icon-button" aria-label="规则与数据" title="规则与数据" onClick={()=>setInfo(true)}><CircleHelp size={18} aria-hidden="true"/></button></div>
          <AnimatedCollapse open={settingsOpen} id="office-layer-settings">
          <div className="settings-fields">
          <fieldset className="office-section"><legend className="field-label">办公工区</legend>
            <div className="office-cards">
              {[...offices].sort((a,b)=>officeOrder.indexOf(a.id)-officeOrder.indexOf(b.id)).map(office=><label className="office-choice" key={office.id}>
                <input type="radio" name="office" aria-label={office.name} checked={activeId===office.id} onChange={()=>switchOffice(office.id)}/>
                <span className="office-radio" aria-hidden="true"><span/></span><span className="office-choice-name">{officeNames[office.id]??office.name}</span>
              </label>)}
              {!offices.length&&<span className="office-placeholder" role="status">加载工区…</span>}
            </div>
          </fieldset>
          <fieldset className="layer-section"><legend className="field-label">范围图层</legend><div className="layer-chips">
            {modes.map(mode=><label key={mode} className={`layer-chip ${mode}`}>
              <input type="checkbox" aria-label={`${MODE_LABEL[mode]} ${mode==="walking"?"30":"20"}分钟`} checked={layers[mode]} onChange={event=>setLayers(previous=>({...previous,[mode]:event.target.checked}))}/>
              <span className="layer-check" aria-hidden="true"><Check size={12}/></span><span>{mode==="walking"?"步行 30分":mode==="bicycling"?"骑行 20分":"地铁 20分"}</span>
            </label>)}
          </div></fieldset>
          </div>
          </AnimatedCollapse>
        </div>
      </aside>
      <aside ref={panel} id="place-query-panel" className="side-panel search-panel" aria-label="地点查询与分析" inert={!mobileOpen?true:undefined}>
        <button className="mobile-panel-handle" aria-label="收起地点查询" onClick={()=>setMobileOpen(false)}><span/></button>
        <div className="panel-scroll">
          <div className="search-section" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)){setSearchOpen(false);setSavedOpen(false);}}}>
            <label className="field-label" htmlFor="place-query">居住地点</label>
            <div className={`search-input ${searchOpen?"focused":""}`}>
              <Search size={18} aria-hidden="true"/>
              <input ref={searchInput} id="place-query" value={query} placeholder="搜索小区或地址" aria-label="搜索小区或地址" role="combobox" aria-expanded={showOptions} aria-controls="place-options" aria-activedescendant={option>=0&&places[option]?`place-option-${option}`:undefined} aria-autocomplete="list" aria-describedby={searchError?"search-error":undefined} autoComplete="off" enterKeyHint="search"
                onFocus={()=>{if(searchRequest?.query===query.trim())setSearchOpen(true);}}
                onChange={event=>{setQuery(event.target.value);setSearchOpen(false);setSavedOpen(false);setSearchRequest(null);setSearching(false);setSearchError("");setOption(-1);}}
                onKeyDown={event=>{
                  if(event.key==="Enter"){
                    if(event.nativeEvent.isComposing||event.keyCode===229)return;event.preventDefault();
                    if(showOptions&&option>=0&&places[option])choose(places[option]);else submitSearch();
                  }
                  if(event.key==="ArrowDown"&&searchRequest?.query===query.trim()&&places.length){event.preventDefault();setSearchOpen(true);setOption(index=>(index+1)%places.length);}
                  if(event.key==="ArrowUp"&&searchRequest?.query===query.trim()&&places.length){event.preventDefault();setSearchOpen(true);setOption(index=>(index-1+places.length)%places.length);}
                  if(event.key==="Escape"){setSearchOpen(false);setSavedOpen(false);setOption(-1);}
                }}/>
              {(hasSavedPlaces||savedOpen)&&<button className="icon-button saved-places-trigger" aria-label="最近与收藏" title="最近与收藏" aria-expanded={savedOpen} aria-controls="saved-places-panel" onClick={()=>{setSearchOpen(false);setSavedOpen(open=>!open);}}><History size={17} aria-hidden="true"/></button>}
              {searching?<LoaderCircle className="spin" size={17} aria-label="正在搜索"/>:query?<button className="icon-button" aria-label="清除地点" onClick={reset}><X size={17}/></button>:null}
            </div>
            <AnimatedCollapse open={showOptions} className="search-reveal">
            <div className="search-options" id="place-options" role="listbox" aria-label="搜索结果" aria-busy={searching}>
              {searching?<p className="search-message" role="status">正在搜索…</p>:searchError?<p className="search-message query-error" id="search-error" role="alert">{searchError}</p>:places.length?places.map((place,index)=><button id={`place-option-${index}`} key={place.id} role="option" aria-selected={option===index} className={option===index?"highlighted":""} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(place)}>
                <MapPin size={17} aria-hidden="true"/><span><strong>{place.name}</strong><small>{place.address}</small></span>
              </button>):searchRequest?<p className="search-message">未找到地点</p>:null}
            </div>
            </AnimatedCollapse>
            <AnimatedCollapse open={savedOpen&&!showOptions} className="saved-places-reveal"><SavedPlaces recent={recentPlaces} favorites={favorites} view={savedView} onView={setSavedView} onChoose={choose} onFavorite={point=>setFavorites(previous=>toggleFavorite(previous,point))} onClearRecent={()=>setRecentPlaces([])}/></AnimatedCollapse>
          </div>
          {home&&<div className="selected-home"><span>拖动标记可调整入口</span><div className="selected-home-actions"><button className="icon-button place-save-button" aria-label={homeSaved?"取消收藏地点":"收藏地点"} title={homeSaved?"取消收藏":"收藏地点"} aria-pressed={homeSaved} onClick={()=>setFavorites(previous=>toggleFavorite(previous,home))}><Star size={16} fill={homeSaved?"currentColor":"none"} aria-hidden="true"/></button><button className="text-button" onClick={()=>verify(home,[activeId])} disabled={loading}><RotateCw size={13} aria-hidden="true"/>重新核验</button></div></div>}
          {storageError&&<p className="storage-error" role="status">{storageError}</p>}
          {home&&<RouteResults result={result} plans={plans} selectedPlan={selectedPlan} loading={activeLoading} queryStage={queryStage} stopped={queryStopped&&!settled.current.has(activeId)} error={error} onStop={stopVerification} onSelect={plan=>{manualPlan.current=true;setSelectedPlan(selectedPlan?.id===plan.id?null:plan);}}/>}
          {!home&&error&&<p className="query-error" role="alert">{error}</p>}
          {loading&&!activeLoading&&<div className="background-check" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true"/><span>正在查询{QUERY_STAGE_LABEL[queryStage]}方案</span><button className="text-button" onClick={stopVerification}>停止</button></div>}
        </div>
      </aside>
      </div>
      <AtlasMap offices={offices} activeId={activeId} showAll={false} layers={layers} coverage={coverage} home={home} plan={selectedPlan} pendingLocation={pendingLocation} pendingName={pendingName} onPick={pick} onConfirmPick={confirmPick} onCancelPick={()=>{setPendingLocation(null);setPendingName("");setMobileOpen(true);}} mobileOpen={mobileOpen}/>
      {!mobileOpen&&!pendingLocation&&<button className="mobile-toggle" aria-controls="place-query-panel" aria-expanded={false} onClick={()=>{setSettingsOpen(false);setMobileOpen(true);}}><Search size={17} aria-hidden="true"/>查地点</button>}
    </div>
    <RulesDialog open={info} onClose={()=>setInfo(false)} coverage={coverage} rail={rail} validation={validation}/>
  </main>;
}
