// Route highlight rendering using the same lanes as the network map

import { stopById, routeById } from './data.js';
import { state } from './state.js';
import { map, stopMarkers, routeOutlines, routePolylines, BASE_ROUTE_STYLE, BASE_OUTLINE_STYLE, stopRadius, getRouteShape, makePillIcon, isLightColor } from './map-core.js';
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
  const segs = [];
  let totalLen = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = L.latLng(pts[i]), b = L.latLng(pts[i + 1]);
    const len = a.distanceTo(b);
    segs.push({ a, b, len });
    totalLen += len;
  }
  const straightLine = L.latLng(pts[0]).distanceTo(L.latLng(pts[pts.length - 1]));
  if (straightLine < 200 || totalLen > straightLine * 1.8) return;
  let target = totalLen / 2;
  for (const seg of segs) {
    if (target <= seg.len) {
      const t = target / seg.len;
      const lat = seg.a.lat + t * (seg.b.lat - seg.a.lat);
      const lng = seg.a.lng + t * (seg.b.lng - seg.a.lng);
      const angle = Math.atan2(seg.b.lng - seg.a.lng, seg.b.lat - seg.a.lat) * 180 / Math.PI;
      const s = Math.round(lineWeight * 1.8);
      const sw = Math.max(2, Math.round(lineWeight * 0.45));
      const half = Math.round(s / 2);
      const svg = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" style="transform:rotate(${angle}deg)"><path d="M${s * 0.2} ${s * 0.75}L${half} ${s * 0.2}L${s * 0.8} ${s * 0.75}" fill="none" stroke="${isLightColor(color) ? '#243746' : '#fff'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const m = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: svg, iconSize: [s, s], iconAnchor: [half, half] }),
        interactive: false
      }).addTo(map);
      state.highlightLayers.push(m);
      return;
    }
    target -= seg.len;
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
      color: '#fff', weight: noTrips ? 8 : 10,
      opacity: 1,
      interactive: false, pane: 'routeLines'
    }).addTo(map);
    state.highlightLayers.push(outline);
    const line = L.polyline(allRaw, {
      color: route.color, weight: noTrips ? 4 : 6,
      opacity: noTrips ? 0.5 : 0.9,
      dashArray: noTrips ? '8 6' : null,
      interactive: false, pane: 'routeLines'
    }).addTo(map);
    state.highlightLayers.push(line);
    allRaw.forEach(p => bounds.push(p));
    for (let i = 0; i < cachedSegments.length; i++) {
      addChevronToSegment(cachedSegments[i], route.color, noTrips ? 4 : 6);
    }
    leg.stops.forEach(sid => {
      const isEndpoint = sid === originId || sid === destId;
      if (isEndpoint) {
        stopMarkers[sid].setStyle({ radius: 6, color: route.color, weight: 2.5, fillColor: route.color, fillOpacity: 1 });
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
