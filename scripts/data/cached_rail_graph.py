"""Discover station-pair candidates from cached metro legs and known transfers.

Graph paths are never eligibility proofs. Combining provider segment costs can
change its waiting-time estimate, so each candidate still needs an exact
station-to-station request before it can enter the precomputed range.
"""
import hashlib
import json
import re

import networkx as nx

from prepare_rail_plans import metro_options
from duration_policy import round_seconds,plan_seconds


class CachedRailGraph:
    def __init__(self, stations):
        self.by_name = {s['name']: s for s in stations}
        self.graph = nx.DiGraph()
        self.seen = set()
        self.option_count = 0

    @staticmethod
    def state(leg, endpoint):
        match = re.search(r'地铁(\d+)号线', leg['label'])
        line = match.group(1) if match else leg['label']
        return leg[endpoint][:-1], line

    def edge(self, origin, destination, duration):
        if origin[0] not in self.by_name or destination[0] not in self.by_name:
            return
        duration=round_seconds(duration)
        if not self.graph.has_edge(origin, destination) or duration < self.graph[origin][destination]['weight']:
            self.graph.add_edge(origin, destination, weight=duration)

    def add_response(self, data):
        if not data:
            return []
        options = metro_options(data, {})
        digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        if digest in self.seen:
            return options
        self.seen.add(digest)
        for option in options:
            self.option_count += 1
            previous = None
            transfer = 0
            for leg in option['journeyLegs']:
                if leg['mode'] != 'metro':
                    transfer += round_seconds(leg['duration'])
                    continue
                origin, destination = self.state(leg, 'from'), self.state(leg, 'to')
                self.edge(origin, destination, round_seconds(leg['duration']))
                # A transfer edge exists only when a provider route includes it.
                # Shared station names alone must not create a free transfer.
                if previous is not None:
                    self.edge(previous, origin, transfer)
                previous, transfer = destination, 0
        return options

    def candidates(self, office_id, tails, current_plans):
        best = {}
        for station_name, tail in tails.items():
            graph = self.graph.copy()
            sink = ('__office__', office_id)
            for node in self.graph.nodes:
                if node[0] == station_name:
                    graph.add_edge(node, sink, weight=round_seconds(tail['duration']))
            if sink not in graph:
                continue
            distances, paths = nx.single_source_dijkstra(graph.reverse(copy=False), sink, cutoff=1200)
            for node, duration in distances.items():
                if node == sink or node[0] not in self.by_name:
                    continue
                path = list(reversed(paths[node]))[:-1]
                if len(path) < 2 or path[0][0] == path[-1][0]:
                    continue
                station = self.by_name[node[0]]
                old = current_plans.get(station['id'])
                if old and plan_seconds(old) <= duration:
                    continue
                candidate = {'officeId': office_id, 'originId': station['id'], 'originName': node[0],
                             'destinationId': self.by_name[station_name]['id'], 'destinationName': station_name,
                             'graphFixedDuration': duration, 'oldFixedDuration': old['duration'] if old else None,
                             'graphPath': path}
                # Keep each arrival station. A provider may reject the apparently
                # fastest candidate while accepting another arrival/transfer.
                key = station['id'], candidate['destinationId']
                if key not in best or duration < best[key]['graphFixedDuration']:
                    best[key] = candidate
        return list(best.values())
