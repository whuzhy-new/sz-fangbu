import type {Mode,Plan} from "./commute";
export type Coverage={type:"FeatureCollection";features:{type:"Feature";geometry:{type:string;coordinates:any};properties:{officeId:string;mode:Mode;areaKm2?:number}}[];metadata:{generatedAt:string;resolutionMeters:number;complete:boolean;processedStations:number;stationCount:number;note:string}};
export type RailData={complete:boolean;generatedAt:string;processedStations:string[];stationCount:number;plans:Record<string,Record<string,{id:string;legs:Plan["legs"]}>>};
export type Validation={summary:Record<string,{sampleCount:number;meanAbsoluteErrorSeconds:number;maxAbsoluteErrorSeconds:number}>;note:string};
