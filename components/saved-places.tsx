"use client";
import {useRef} from "react";
import {Star} from "lucide-react";
import {placeKey} from "@/lib/commute-storage";
import type {Place} from "@/lib/commute";

export default function SavedPlaces({recent,favorites,view,onView,onChoose,onFavorite,onClearRecent}:{
  recent:Place[];favorites:Place[];view:"recent"|"favorites";onView:(view:"recent"|"favorites")=>void;
  onChoose:(place:Place)=>void;onFavorite:(place:Place)=>void;onClearRecent:()=>void;
}) {
  const favoriteTab=useRef<HTMLButtonElement>(null);
  const recentTab=useRef<HTMLButtonElement>(null);
  const points=view==="recent"?recent:favorites;
  const favoriteKeys=new Set(favorites.map(placeKey));
  return <div className="saved-places" id="saved-places-panel">
    <div className="saved-places-toolbar">
      <div className="saved-places-views" role="group" aria-label="地点列表">
        <button ref={recentTab} aria-pressed={view==="recent"} onClick={()=>onView("recent")}>最近</button>
        <button ref={favoriteTab} aria-pressed={view==="favorites"} onClick={()=>onView("favorites")}>收藏</button>
      </div>
      {view==="recent"&&recent.length>0&&<button className="text-button" aria-label="清空最近地点" onClick={()=>{recentTab.current?.focus();onClearRecent();}}>清空</button>}
    </div>
    <div className="saved-places-list" aria-label={view==="recent"?"最近地点":"收藏地点"}>
      {points.map(point=>{
        const saved=favoriteKeys.has(placeKey(point));
        return <div className="saved-place-row" key={placeKey(point)}>
          <button className="saved-place-choose" onClick={()=>onChoose(point)}><strong>{point.name}</strong>{point.address&&<span>{point.address}</span>}</button>
          <button className="icon-button place-save-button" aria-label={`${saved?"取消收藏":"收藏"}：${point.name}`} aria-pressed={saved} title={saved?"取消收藏":"收藏地点"} onClick={()=>{if(view==="favorites")favoriteTab.current?.focus();onFavorite(point);}}><Star size={16} fill={saved?"currentColor":"none"} aria-hidden="true"/></button>
        </div>;
      })}
      {!points.length&&<p className="saved-places-empty">{view==="recent"?"暂无最近地点":"暂无收藏"}</p>}
    </div>
  </div>;
}
