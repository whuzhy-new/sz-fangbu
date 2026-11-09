"""Complete small display holes and apply entrance-verified residential patches."""
import math
from shapely.geometry import Polygon
from shapely.ops import unary_union
from duration_policy import sum_leg_seconds

SMALL_HOLE_M2=10000

def polygon_parts(geometry):
    if geometry.is_empty:return []
    if geometry.geom_type=='Polygon':return [geometry]
    return [p for g in getattr(geometry,'geoms',[]) for p in polygon_parts(g)]

def enclosed_holes(geometry):
    return [Polygon(ring) for p in polygon_parts(geometry) for ring in p.interiors]

def fill_small_holes(geometry,max_area=SMALL_HOLE_M2,area_measure=None):
    measure=area_measure or (lambda g:g.area)
    return unary_union([Polygon(p.exterior,[r for r in p.interiors if measure(Polygon(r))>max_area]) for p in polygon_parts(geometry)])

def complete_small_holes(layers,max_area=SMALL_HOLE_M2,area_measure=None):
    measure=area_measure or (lambda g:g.area)
    before=unary_union(list(layers.values()))
    result={mode:fill_small_holes(g,max_area,measure) for mode,g in layers.items()}
    # Some holes exist only after several modes are combined. Assign these to
    # the adjacent mode sharing the longest boundary; never close exterior bays.
    for hole in enclosed_holes(unary_union(list(result.values()))):
        if measure(hole)<=max_area:
            owner=max(result,key=lambda mode:result[mode].boundary.intersection(hole.boundary).length)
            result[owner]=result[owner].union(hole)
    after=unary_union(list(result.values()))
    assert all(measure(h)>max_area for h in enclosed_holes(after))
    return result,{'maxAreaM2':max_area,'holesBefore':len(enclosed_holes(before)),
        'holesAfter':len(enclosed_holes(after)),'addedAreaM2':round(measure(after.difference(before)),1)}

def apply_verified_communities(layers,corrections):
    result=dict(layers);before=unary_union(list(layers.values()))
    outlines=unary_union([Polygon(p.exterior) for p in polygon_parts(before)])
    gaps=outlines.difference(before);applied=[];skipped=[]
    for feature in corrections:
        props=feature['properties'];proof=props.get('proof',{});legs=proof.get('legs',[]);mode=props['mode']
        if mode not in result or props.get('source')!='amap' or props.get('measurementPoint')!='community-entrance':continue
        raw=props.get('durationSeconds',math.inf)
        if not legs or any(not math.isfinite(l['duration']) or l['duration']<0 for l in legs):continue
        if abs(sum(l['duration'] for l in legs)-raw)>.01 or abs(proof.get('duration',math.inf)-raw)>.01:continue
        duration=sum_leg_seconds(legs)
        if duration>(1800 if mode=='walking' else 1200):
            skipped.append({'name':props['name'],'durationSeconds':duration});continue
        if mode=='metro':
            rail=[l for l in legs if l['mode']=='metro'];api=proof.get('metroApi',{})
            if not rail or rail[0]['from']!=api.get('originName','')+'站' or rail[-1]['to']!=api.get('destinationName','')+'站':continue
        patch=unary_union(polygon_parts(feature['geometry'].intersection(gaps)))
        if patch.is_empty:continue
        result[mode]=result[mode].union(patch)
        applied.append({'name':props['name'],'mode':mode,'durationSeconds':duration,'rawDurationSeconds':raw,'areaM2':round(patch.area,1)})
    return result,{'communities':applied,'skippedAfterRounding':skipped,
        'addedAreaM2':round(unary_union(list(result.values())).difference(before).area,1)}
