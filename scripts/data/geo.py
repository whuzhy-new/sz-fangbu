"""Coordinate boundary between OSM (WGS84) and AMap (GCJ02)."""
import math

def wgs_to_gcj(lon, lat):
    if not (72.004 < lon < 137.8347 and 0.8293 < lat < 55.8271): return lon, lat
    x, y = lon - 105, lat - 35
    dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*math.sqrt(abs(x))
    dlat += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
    dlat += (20*math.sin(y*math.pi)+40*math.sin(y*math.pi/3))*2/3
    dlat += (160*math.sin(y*math.pi/12)+320*math.sin(y*math.pi/30))*2/3
    dlon = 300+x+2*y+.1*x*x+.1*x*y+.1*math.sqrt(abs(x))
    dlon += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
    dlon += (20*math.sin(x*math.pi)+40*math.sin(x*math.pi/3))*2/3
    dlon += (150*math.sin(x*math.pi/12)+300*math.sin(x*math.pi/30))*2/3
    rad = lat/180*math.pi
    magic = 1-.00669342162296594323*math.sin(rad)**2
    dlat = dlat*180/((6378245*(1-.00669342162296594323))/(magic*math.sqrt(magic))*math.pi)
    dlon = dlon*180/(6378245/math.sqrt(magic)*math.cos(rad)*math.pi)
    return lon+dlon,lat+dlat

def gcj_to_wgs(lon,lat):
    x,y=lon,lat
    for _ in range(5):
        a,b=wgs_to_gcj(x,y)
        x-=a-lon;y-=b-lat
    return x,y
