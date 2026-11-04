// Route highlight rendering using the same lanes as the network map

import { stopById, routeById } from './data.js';
import { state } from './state.js';
import { map, stopMarkers, routeOutlines, routePolylines, BASE_ROUTE_STYLE, BASE_OUTLINE_STYLE, stopRadius, getRouteShape, makePillIcon } from './map-core.js';
import { isMobile } from './sheet.js';

let displayedLegs = null;
let geometryListenerAttached = false;

export function clearHighlights() {
  displayedLegs = null;
  state.highlightLayers.forEach(l => map.removeLayer(l));
  state.highlightLayers = [];
  for (const rid in routeOutlines) routeOutlines[rid].setStyle(BASE_OUTLINE_STYLE);
  for (const rid in routePolylines) routePolylines[rid].setStyle(BASE_ROUTE_STYLE);
  for (const sid in stopMarkers) stopMarkers[sid].setStyle({ radius: stopRadius(sid), color: '#425466', weight: 2, fillColor: '#fff' });
}

function addChevronToSegment(pts, color, lineWeight) {
  const segments = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = map.latLngToLayerPoint(pts[i - 1]), b = map.latLngToLayerPoint(pts[i]);
    const length = a.distanceTo(b);
    if (length < 1) continue;
    segments.push({ a, b, length });
    total += length;
  }
  if (total < 80) return;
  const count = Math.min(8, Math.max(1, Math.floor(total / 140)));
  for (let i = 0; i < count; i++) {
    let remaining = total * (i + 0.5) / count;
    for (const segment of segments) {
      if (remaining > segment.length) { remaining -= segment.length; continue; }
      const dx = (segment.b.x - segment.a.x) / segment.length;
      const dy = (segment.b.y - segment.a.y) / segment.length;
      const offset = lineWeight / 2 + 9;
      const point = L.point(segment.a.x + dx * remaining + dy * offset, segment.a.y + dy * remaining - dx * offset);
      const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
      const path = 'M4 8L8 3L12 8M8 3V14';
      const svg = `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${angle}deg)"><path d="${path}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const marker = L.marker(map.layerPointToLatLng(point), {
        icon: L.divIcon({ className: '', html: svg, iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false,
      }).addTo(map);
      state.highlightLayers.push(marker);
      break;
    }
  }
}

function getShapeSegment(route, fromStop, toStop) {
  const shape = getRouteShape(route.id);
  if (!shape || shape.length < 2) {
    return [[fromStop.lat, fromStop.lng], [toStop.lat, toStop.lng]];
  }
  let fromIdx = nearestPointOnShape(shape, fromStop);
  let toIdx = nearestPointOnShape(shape, toStop);
  if (fromIdx === toIdx) return [[fromStop.lat, fromStop.lng], [toStop.lat, toStop.lng]];
  let pts;
  if (fromIdx < toIdx) {
    pts = shape.slice(fromIdx, toIdx + 1);
  } else {
    pts = shape.slice(toIdx, fromIdx + 1).reverse();
  }
  pts[0] = [fromStop.lat, fromStop.lng];
  pts[pts.length - 1] = [toStop.lat, toStop.lng];
  return pts;
}

function nearestPointOnShape(shape, stop) {
  let minDist = Infinity, minIdx = 0;
  shape.forEach((p, i) => {
    const d = (p[0] - stop.lat) ** 2 + (p[1] - stop.lng) ** 2;
    if (d < minDist) { minDist = d; minIdx = i; }
  });
  return minIdx;
}

export function showRoute(legs, { fitBounds = true } = {}) {
  if (!geometryListenerAttached) {
    map.on('routegeometrychange', () => {
      if (displayedLegs) showRoute(displayedLegs, { fitBounds: false });
    });
    geometryListenerAttached = true;
  }
  if (state.previewStartMarker) { state.previewStartMarker.remove(); state.previewStartMarker = null; }
  if (state.previewEndMarker) { state.previewEndMarker.remove(); state.previewEndMarker = null; }
  clearHighlights();
  displayedLegs = legs;
  for (const rid in routeOutlines) routeOutlines[rid].setStyle({ weight: 4, opacity: 0.15 });
  for (const rid in routePolylines) routePolylines[rid].setStyle({ weight: 2, opacity: 0.15 });

  const bounds = [];

  const originId = legs[0].stops[0];
  const destId = legs[legs.length - 1].stops[legs[legs.length - 1].stops.length - 1];

  legs.forEach(leg => {
    const route = routeById[leg.route];
    const allRaw = [];
    const cachedSegments = [];
    for (let i = 0; i + 1 < leg.stops.length; i++) {
      const fromStop = stopById[leg.stops[i]];
      const toStop = stopById[leg.stops[i + 1]];
      const seg = getShapeSegment(route, fromStop, toStop);
      cachedSegments.push(seg);
      if (i === 0) {
        seg.forEach(p => allRaw.push(p));
      } else {
        for (let j = 1; j < seg.length; j++) allRaw.push(seg[j]);
      }
    }
    const noTrips = leg.depTime === null;
    const outline = L.polyline(allRaw, {
      color: '#fff', weight: 7,
      opacity: 1,
      interactive: false, pane: 'routeLines'
    }).addTo(map);
    state.highlightLayers.push(outline);
    const line = L.polyline(allRaw, {
      color: route.color, weight: 4,
      opacity: noTrips ? 0.5 : 1,
      dashArray: noTrips ? '8 6' : null,
      interactive: false, pane: 'routeLines'
    }).addTo(map);
    state.highlightLayers.push(line);
    allRaw.forEach(p => bounds.push(p));
    for (let i = 0; i < cachedSegments.length; i++) {
      addChevronToSegment(cachedSegments[i], route.color, 4);
    }
    leg.stops.forEach(sid => {
      const isEndpoint = sid === originId || sid === destId;
      if (isEndpoint) {
        stopMarkers[sid].setStyle({ radius: 5.5, color: route.color, weight: 2.5, fillColor: '#fff', fillOpacity: 1 });
      } else {
        stopMarkers[sid].setStyle({ color: route.color, weight: 2, fillColor: '#fff', fillOpacity: 1 });
      }
    });
  });


  const originStop = stopById[originId];
  const destStop = stopById[destId];

  const startMarker = L.marker([originStop.lat, originStop.lng], { icon: makePillIcon('Start'), interactive: false }).addTo(map);
  state.highlightLayers.push(startMarker);

  const endMarker = L.marker([destStop.lat, destStop.lng], { icon: makePillIcon('End'), interactive: false }).addTo(map);
  state.highlightLayers.push(endMarker);

  if (fitBounds && bounds.length) {
    if (isMobile()) {
      const ZOOM = 14;
      setTimeout(() => {
        const sheetHeight = document.getElementById('bottom-sheet').offsetHeight;
        const mapHeight = document.getElementById('map').offsetHeight;
        const visibleHeight = mapHeight - sheetHeight;
        const originPx = map.project([originStop.lat, originStop.lng], ZOOM);
        const centeredPx = L.point(originPx.x, originPx.y + sheetHeight / 2);
        map.setView(map.unproject(centeredPx, ZOOM), ZOOM);
      }, 350);
    } else {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }
}
