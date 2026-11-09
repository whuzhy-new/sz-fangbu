import {Bike,Footprints,TrainFront} from "lucide-react";
import type {Mode} from "@/lib/commute";

export default function ModeIcon({mode,size=18}:{mode:Mode;size?:number}) {
  const Icon=mode==="walking"?Footprints:mode==="bicycling"?Bike:TrainFront;
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true"/>;
}
