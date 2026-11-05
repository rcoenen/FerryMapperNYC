// Leaflet map initialization, markers, popups, and return-to-NYC overlay

import { stops, routes, stopById, routeById, routeStopSequences } from './data.js';
import { state, STYLE_STORAGE_KEY } from './state.js';
import { CONFIG } from './config.js';
import { buildRouteLanes, layoutRouteLanes } from './route-geometry.js';

export const DEFAULT_VIEW = { lat: 40.6989, lng: -73.9922, zoom: 13 };
const OSM_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxNativeZoom: 19,
  maxZoom: 20,
};
const VECTOR_ATTRIBUTION = '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Keep existing preference IDs while using genuinely simplified vector styles.
export const MAP_STYLES = {
  positron: { style: 'https://tiles.openfreemap.org/styles/liberty' },
  darkMatter: { style: 'https://tiles.openfreemap.org/styles/dark' },
  osm: OSM_TILES,
};

function styleBasemap(gl, styleKey) {
  const dark = styleKey === 'darkMatter';
  const hiddenSources = new Set(['building', 'poi', 'housenumber']);
  const fills = {
    water: dark ? '#18394a' : '#a3d9e9',
    park: dark ? '#203d35' : '#cfefdc',
    landcover_wood: dark ? '#203d35' : '#cfefdc',
    landcover_grass: dark ? '#243d35' : '#d9efdf',
    landuse_residential: dark ? '#242e38' : '#f0f2f4',
  };
  for (const layer of gl.getStyle().layers) {
    const id = layer.id;
    if (hiddenSources.has(layer['source-layer']) ||
        /rail|path_pedestrian|service_track|one_way_arrow|boundary_3/.test(id) ||
        id === 'highway-name-path') {
      gl.setLayoutProperty(id, 'visibility', 'none');
    }
    if (fills[id]) gl.setPaintProperty(id, 'fill-color', fills[id]);
    if (layer.type === 'background') gl.setPaintProperty(id, 'background-color', dark ? '#202932' : '#f7f8f9');
    if (layer.type === 'line' && /^(road|bridge|tunnel)_/.test(id) && !/rail|pier|path/.test(id)) {
      const casing = id.includes('casing');
      const major = /motorway|trunk_primary/.test(id);
      const color = dark
        ? (major ? (casing ? '#35475b' : '#627790') : (casing ? '#273543' : '#354453'))
        : (major ? (casing ? '#758ca9' : '#b5c5dc') : (casing ? '#d7dfe7' : '#fff'));
      gl.setPaintProperty(id, 'line-color', color);
    }
    if (layer.type === 'symbol' && layer['source-layer'] === 'place') {
      gl.setLayoutProperty(id, 'text-font', ['Noto Sans Regular']);
      gl.setPaintProperty(id, 'text-color', dark ? '#dce6ed' : '#353f48');
      gl.setPaintProperty(id, 'text-halo-color', dark ? '#202932' : '#fff');
      gl.setPaintProperty(id, 'text-halo-width', 1.5);
      if (id === 'label_other') {
        gl.setLayoutProperty(id, 'text-size', ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12]);
        gl.setLayoutProperty(id, 'text-letter-spacing', 0.06);
      }
      if (id === 'label_city') gl.setLayoutProperty(id, 'text-size', ['interpolate', ['linear'], ['zoom'], 10, 16, 13, 23, 16, 26]);
    }
    if (layer['source-layer'] === 'water_name' && layer.type === 'symbol') {
      gl.setLayoutProperty(id, 'text-font', ['Noto Sans Regular']);
      gl.setLayoutProperty(id, 'text-letter-spacing', 0.03);
      gl.setPaintProperty(id, 'text-color', dark ? '#81b0c6' : '#4c839a');
      gl.setPaintProperty(id, 'text-halo-color', dark ? '#18394a' : '#d8f0f8');
    }
    if (id === 'highway-name-minor') gl.setLayerZoomRange(id, 16, 24);
    if (id === 'highway-name-major') gl.setLayerZoomRange(id, 13.5, 24);
    if (id === 'park') {
      gl.setFilter(id, ['all', gl.getFilter(id) || ['literal', true], ['!', ['in', ['get', 'class'], ['literal', ['historic', 'historic_district', 'marine']]]]]);
      gl.setPaintProperty(id, 'fill-opacity', 1);
      gl.setPaintProperty(id, 'fill-outline-color', dark ? '#28493b' : '#c5e7d1');
    }
    if (id === 'park_outline') gl.setLayoutProperty(id, 'visibility', 'none');
  }
  if (!gl.getLayer('ferry-park-label')) {
    gl.addLayer({
      id: 'ferry-park-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'park', minzoom: 12,
      filter: ['!', ['in', ['get', 'class'], ['literal', ['historic', 'historic_district', 'marine']]]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 15, 13],
        'text-max-width': 10, 'text-padding': 10,
      },
      paint: { 'text-color': dark ? '#98c9a8' : '#42896d', 'text-halo-color': dark ? '#203d35' : '#fff', 'text-halo-width': 1.5 },
    });
  }
}

let vectorSupported;
function supportsVectorMap() {
  if (vectorSupported === undefined) {
    const context = document.createElement('canvas').getContext('webgl2');
    vectorSupported = !!context;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return vectorSupported;
}

export function createTileLayer(styleKey) {
  const style = MAP_STYLES[styleKey];
  // Classic is also a usable fallback on devices without WebGL support.
  if (!style.style || !window.maplibregl || !L.maplibreGL || !supportsVectorMap()) {
    const { url, ...options } = OSM_TILES;
    return L.tileLayer(url, options);
  }
  const layer = L.maplibreGL({
    style: style.style,
    attributionControl: { customAttribution: VECTOR_ATTRIBUTION },
    interactive: false,
  });
  layer.once('add', () => {
    const gl = layer.getMaplibreMap();
    gl.on('style.load', () => styleBasemap(gl, styleKey));
  });
  return layer;
}

export const LANDING_SIZE = 5;
export const BASE_ROUTE_STYLE = { weight: 4, opacity: 0.85 };
export const BASE_OUTLINE_STYLE = { weight: 7, opacity: 0.95 };
let routeShapes = new Map();
export function getRouteShape(routeId) { return routeShapes.get(routeId) || []; }
export function stopRadius(stopId) { return stopById[stopId].routes.length > 1 ? 6 : LANDING_SIZE; }
export let map;
export let stopMarkers = {};
export let routeOutlines = {};
export let routePolylines = {};

export function isLightColor(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

export function makePillIcon(label) {
  const isStart = label === 'Start';
  const w = isStart ? 78 : 70;
  return L.divIcon({
    className: '',
    html: `<div class="trip-endpoint"><span class="trip-endpoint-key">${isStart ? 'A' : 'B'}</span><span>${label}</span></div>`,
    iconSize: [w, 28],
    iconAnchor: [w / 2, 40]
  });
}

export function updatePreviewMarkers() {
  if (state.previewStartMarker) { state.previewStartMarker.remove(); state.previewStartMarker = null; }
  if (state.previewEndMarker) { state.previewEndMarker.remove(); state.previewEndMarker = null; }
  if (!state.lastSearch) {
    const fromId = document.getElementById('from-select').value;
    const toId = document.getElementById('to-select').value;
    const from = stopById[fromId];
    const to = stopById[toId];
    if (from) state.previewStartMarker = L.marker([from.lat, from.lng], { icon: makePillIcon('Start'), interactive: false }).addTo(map);
    if (to) state.previewEndMarker = L.marker([to.lat, to.lng], { icon: makePillIcon('End'), interactive: false }).addTo(map);
  }
}

export function initMap() {
  try { state.activeStyleKey = localStorage.getItem(STYLE_STORAGE_KEY) || 'positron'; } catch {}
  if (!MAP_STYLES[state.activeStyleKey]) state.activeStyleKey = 'positron';

  map = L.map('map', { minZoom: 11, maxZoom: 20 }).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);
  state.currentTileLayer = createTileLayer(state.activeStyleKey).addTo(map);

  // Custom pane for route lines — below overlayPane (400) so stop markers always appear on top
  map.createPane('routeOutlines');
  map.getPane('routeOutlines').style.zIndex = 340;
  map.getPane('routeOutlines').style.pointerEvents = 'none';
  map.createPane('routeLines');
  map.getPane('routeLines').style.zIndex = 350;
  map.getPane('routeLines').style.pointerEvents = 'none';
  // Trails and live boats stay below the marker pane (600), where DOM landing markers win clicks over boats
  map.createPane('trailLines');
  map.getPane('trailLines').style.zIndex = 355;
  map.getPane('trailLines').style.pointerEvents = 'none';
  map.createPane('liveBoats');
  map.getPane('liveBoats').style.zIndex = 450;

  // Route outlines and lines
  routeOutlines = {};
  routePolylines = {};
  const paths = [];
  routes.forEach(r => {
    if (r.shape.length > 0) {
      let shape = r.shape.map(p => [p[0], p[1]]);
      const seq = routeStopSequences[r.id];
      if (seq) {
        // Insert stop coordinates into the shape so lines pass through each stop.
        // Process in reverse order so splice indices stay valid.
        const inserts = [];
        for (const sid of seq) {
          const s = stopById[sid];
          if (!s) continue;
          let minDist = Infinity, bestIdx = 0;
          for (let i = 0; i < shape.length - 1; i++) {
            const [ax, ay] = shape[i], [bx, by] = shape[i + 1];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            let t = len2 > 0 ? ((s.lat - ax) * dx + (s.lng - ay) * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = ax + t * dx, py = ay + t * dy;
            const d = (px - s.lat) ** 2 + (py - s.lng) ** 2;
            if (d < minDist) { minDist = d; bestIdx = i; }
          }
          inserts.push({ idx: bestIdx + 1, coord: [s.lat, s.lng] });
        }
        inserts.sort((a, b) => b.idx - a.idx);
        for (const ins of inserts) {
          shape.splice(ins.idx, 0, ins.coord);
        }
      }
      const landingPoints = new Set((seq || []).map(id => stopById[id]).filter(Boolean).map(s => `${s.lat},${s.lng}`));
      paths.push({ id: r.id, points: shape.map(coord => ({ ...map.project(coord, 16), pin: landingPoints.has(coord.join(',')) })) });
      routeOutlines[r.id] = L.polyline(shape, {
        color: '#fff', ...BASE_OUTLINE_STYLE, interactive: false, pane: 'routeOutlines'
      }).addTo(map);
      routePolylines[r.id] = L.polyline(shape, {
        color: r.color, ...BASE_ROUTE_STYLE, interactive: false, pane: 'routeLines'
      }).addTo(map);
    }
  });

  const laneModel = buildRouteLanes(paths);
  function updateRouteGeometry() {
    const scale = map.getZoomScale(map.getZoom(), 16);
    routeShapes = new Map([...layoutRouteLanes(laneModel, scale)].map(([id, points]) => [
      id, points.map(p => { const ll = map.unproject([p.x, p.y], map.getZoom()); return [ll.lat, ll.lng]; })
    ]));
    for (const [id, shape] of routeShapes) {
      routeOutlines[id].setLatLngs(shape);
      routePolylines[id].setLatLngs(shape);
    }
    map.fire('routegeometrychange');
  }
  updateRouteGeometry();
  map.on('zoomend', updateRouteGeometry);

  // Easter egg
  L.marker([40.6892, -74.0445], {
    icon: L.divIcon({ html: '<div style="font-size:24px;line-height:1">\uD83D\uDDFD</div>', className: '', iconAnchor: [12, 24] }),
    zIndexOffset: -1
  }).addTo(map).bindPopup('Regular ferry to the Statue?<br>Not happening. That\'s <a href="https://www.cityexperiences.com/new-york/city-cruises/statue/" target="_blank" rel="noopener">Statue City Cruises</a>.<br><br>\u26A0\uFE0F Skip the scammers \u2014 buy tickets at the official desk only.');

  // Stop markers with popups.
  // DOM markers (not a shared canvas) so landings always stack above live boats and win clicks;
  // the 26px transparent wrapper keeps a generous tap target like the old canvas tolerance did.
  stopMarkers = {};
  stops.forEach(s => {
    let radius = stopRadius(s.id), color = '#425466', weight = 2;
    const marker = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: 'landing-dot', iconSize: [26, 26], iconAnchor: [13, 13], html: '<i></i>' }),
      title: s.name, zIndexOffset: 500,
    }).addTo(map);
    const paint = () => {
      const dot = marker.getElement()?.querySelector('.landing-dot i');
      if (!dot) return;
      dot.style.width = dot.style.height = `${(radius + weight) * 2}px`;
      dot.style.borderColor = color;
      dot.style.borderWidth = `${weight}px`;
    };
    // Keep circleMarker's setStyle contract for route highlighting.
    marker.setStyle = ({ radius: r = radius, color: c = color, weight: w = weight, fillColor, fillOpacity }) => {
      radius = r; color = c; weight = w;
      paint();
      const dot = marker.getElement()?.querySelector('.landing-dot i');
      if (dot && fillColor) dot.style.background = fillColor;
      if (dot && fillOpacity !== undefined) dot.style.opacity = fillOpacity;
    };
    paint();

    const routeTags = s.routes.map(rid => {
      const r = routeById[rid];
      const textColor = isLightColor(r.color) ? '#333' : '#fff';
      return `<span style="background:${r.color};color:${textColor}">${r.name}</span>`;
    }).join('');

    marker.bindPopup(`<strong>${s.name}</strong><div class="stop-popup-routes">${routeTags}</div><div class="popup-actions"><button class="popup-start" data-stop="${s.id}">Start</button><button class="popup-end" data-stop="${s.id}">End</button></div>`, { maxWidth: 280, minWidth: 240 });
    stopMarkers[s.id] = marker;
  });

  updatePreviewMarkers();

  // Popup drag handler: allow map panning by dragging the popup
  let popupDragCleanup = null;
  map.on('popupopen', () => {
    const wrapper = document.querySelector('.leaflet-popup-content-wrapper');
    if (wrapper) {
      let startX, startY, startCenter;
      const onStart = e => {
        if (e.target.closest('button')) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startCenter = map.getCenter();
      };
      const onMove = e => {
        if (startX === undefined) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        const origin = map.latLngToContainerPoint(startCenter);
        map.panTo(map.containerPointToLatLng(L.point(origin.x - dx, origin.y - dy)), { animate: false });
      };
      const onEnd = () => { startX = undefined; };
      wrapper.addEventListener('touchstart', onStart, { passive: true });
      wrapper.addEventListener('touchmove', onMove, { passive: true });
      wrapper.addEventListener('touchend', onEnd, { passive: true });
      popupDragCleanup = () => {
        wrapper.removeEventListener('touchstart', onStart);
        wrapper.removeEventListener('touchmove', onMove);
        wrapper.removeEventListener('touchend', onEnd);
      };
    }
  });
  map.on('popupclose', () => { if (popupDragCleanup) { popupDragCleanup(); popupDragCleanup = null; } });

  // Return to NYC overlay
  const allLatLngs = stops.map(s => [s.lat, s.lng]);
  const stopsBounds = allLatLngs.length ? L.latLngBounds(allLatLngs) : null;

  const returnOverlay = document.createElement('div');
  returnOverlay.className = 'return-nyc-overlay';
  returnOverlay.innerHTML = '<div class="nyc-icon">\uD83D\uDDFD</div>' +
    '<div class="nyc-msg">Oy vey, you\'re outside NYC!</div>' +
    '<button class="nyc-back-btn" type="button">Take me back</button>';
  document.getElementById('map-overlay').appendChild(returnOverlay);

  const nycBounds = stopsBounds ? stopsBounds.pad(0.5) : null;

  function checkReturnOverlay() {
    if (!nycBounds) return;
    const visible = map.getBounds().intersects(nycBounds);
    returnOverlay.classList.toggle('visible', !visible);
  }

  map.on('moveend', checkReturnOverlay);

  returnOverlay.querySelector('.nyc-back-btn').addEventListener('click', () => {
    map.flyTo([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);
  });
}
