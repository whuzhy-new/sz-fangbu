"""Round before summing legs, with a one-minute minimum for each leg."""
import math

ROUNDING_VERSION='per-leg-minute-half-up-min-one-v2'

def round_seconds(seconds):
    return max(1,math.floor(seconds/60+0.5))*60 if math.isfinite(seconds) and seconds>=0 else math.inf

def sum_leg_seconds(legs):
    return sum(round_seconds(leg.get('rawDuration',leg['duration'])) for leg in legs)

def plan_seconds(plan):
    return sum_leg_seconds(plan['legs'])
