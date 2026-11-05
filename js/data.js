// Ferry data loading, shuttle filtering, and lookup tables

import { CONFIG } from './config.js';

export let stops, routes, graph, routeStopSequences, services, schedules;
export let stopAliases = {};
export let metadata = null;
export let stopById = {};
export let routeById = {};
export let schedulesByRoute = {};
export let sorted = [];

export async function loadData() {
  const DEBUG_MODE = !!window.FM_CONFIG?.debug;
  const dataUrl = 'data/ferry-data.json' + (DEBUG_MODE ? ('?ts=' + Date.now()) : '');
  const res = await fetch(dataUrl, DEBUG_MODE ? { cache: 'no-store' } : undefined);
  const data = await res.json();

  // Filter out shuttle bus routes (RES/RWS) and their stops
  const shuttleRouteIds = new Set(CONFIG.SHUTTLE_ROUTE_IDS);
  const keepStopName = 'Beach Channel Dr/Beach 108th Street';
  data.routes = data.routes.filter(r => !shuttleRouteIds.has(r.id));
  data.schedules = data.schedules.filter(s => !shuttleRouteIds.has(s.r));
  for (const stopId in data.graph) {
    data.graph[stopId] = data.graph[stopId].filter(e => !shuttleRouteIds.has(e.route));
  }
  data.stops.forEach(s => { s.routes = s.routes.filter(r => !shuttleRouteIds.has(r)); });
  data.stops = data.stops.filter(s => s.routes.length > 0 || s.name === keepStopName);
  for (const stopId in data.graph) {
    if (data.graph[stopId].length === 0) delete data.graph[stopId];
  }

  ({ stops, routes, graph, routeStopSequences, services, schedules } = data);

  stopAliases = data.stopAliases || {};
  metadata = data.metadata || null;
  stopById = {};
  stops.forEach(s => stopById[s.id] = s);
  routeById = {};
  routes.forEach(r => routeById[r.id] = r);
  schedulesByRoute = {};
  for (const trip of schedules) {
    if (!schedulesByRoute[trip.r]) schedulesByRoute[trip.r] = [];
    schedulesByRoute[trip.r].push(trip);
  }
  sorted = [...stops].sort((a, b) => a.name.localeCompare(b.name));
}
