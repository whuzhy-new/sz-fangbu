import {env} from "cloudflare:workers";
import {allAccessTimes,loadRoadNetwork,reverseRoadGraph,type RoadNetwork} from "./local-road-network";
import type {Coord} from "./commute";

let network:Promise<RoadNetwork>|undefined;
let reversed:RoadNetwork|undefined;
export async function localAccessTimes(origin:Coord,targets:Coord[],requestURL:string,toHome=false) {
  const started=performance.now();
  if(!network) {
    network=loadRoadNetwork(path=>{
      const request=new Request(new URL(path,requestURL));
      return env.ASSETS?env.ASSETS.fetch(request):fetch(request);
    }).catch(error=>{network=undefined;throw error;});
  }
  const forward=await network;
  const data=toHome?(reversed??={...forward,walking:reverseRoadGraph(forward.walking),bicycling:reverseRoadGraph(forward.bicycling)}):forward;
  return {times:allAccessTimes(data,origin,targets),elapsedMs:Math.round(performance.now()-started),osmDate:data.manifest.osmDate};
}
