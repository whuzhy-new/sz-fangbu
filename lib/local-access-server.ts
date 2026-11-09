import {env} from "cloudflare:workers";
import {allAccessTimes,loadRoadNetwork,type RoadNetwork} from "./local-road-network";
import type {Coord} from "./commute";

let network:Promise<RoadNetwork>|undefined;
export async function localAccessTimes(origin:Coord,targets:Coord[],requestURL:string) {
  const started=performance.now();
  if(!network) {
    network=loadRoadNetwork(path=>{
      const request=new Request(new URL(path,requestURL));
      return env.ASSETS?env.ASSETS.fetch(request):fetch(request);
    }).catch(error=>{network=undefined;throw error;});
  }
  const data=await network;
  return {times:allAccessTimes(data,origin,targets),elapsedMs:Math.round(performance.now()-started),osmDate:data.manifest.osmDate};
}
