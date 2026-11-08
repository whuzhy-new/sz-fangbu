import { amap, MapApiError } from "@/lib/amap-server";
import { withinShenzhen, type Coord } from "@/lib/commute";
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 80) return Response.json({places:[]});
  try {
    const {data} = await amap("v3/place/text", { keywords:q, city:"440300", citylimit:"true", offset:12, extensions:"all" }, "search");
    const places = (data.pois ?? []).map((p:Record<string,any>) => {
      const location = String(p.location).split(",").map(Number) as Coord;
      const entrance = typeof p.entr_location === "string" && p.entr_location.includes(",") ? p.entr_location.split(",").map(Number) as Coord : undefined;
      return {id:String(p.id),name:String(p.name),address:`${p.adname ?? ""} ${typeof p.address === "string" ? p.address : ""}`.trim(),location,entrance,kind:String(p.typecode ?? "")};
    }).filter((p:{location:Coord}) => withinShenzhen(p.location));
    places.sort((a:{kind:string;name:string},b:{kind:string;name:string}) => Number(b.kind.startsWith("12"))-Number(a.kind.startsWith("12")) || Number(b.name===q)-Number(a.name===q));
    if(!places.length){
      const {data:geo}=await amap("v3/geocode/geo",{address:q,city:"深圳市"},"search");
      for(const [i,g] of (geo.geocodes??[]).entries()){
        const point=String(g.location).split(",").map(Number) as Coord;
        if(withinShenzhen(point)&&g.city==="深圳市")places.push({id:`address-${i}`,name:String(g.formatted_address??q),address:"",location:point,kind:"address"});
      }
    }
    return Response.json({places:places.slice(0,8)});
  } catch(error) {
    return Response.json({error:error instanceof MapApiError ? error.message : "地点查询暂时失败，请重试。"}, {status:503});
  }
}
