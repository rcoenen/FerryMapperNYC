import { map } from './map-core.js';
import { routeById, stopById, stopAliases, schedules, metadata } from './data.js';
import { state, subscribeState } from './state.js';
import { getRealtimeSnapshot, subscribeRealtime } from './realtime.js';
import { getVehicles, getAlerts, isFeedFresh, trackVesselHeading, seededVesselHeading } from './realtime-core.js';

const clock = epoch => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(epoch * 1000));
function textElement(tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}
function vesselIcon(vehicle, heading) {
  const color = routeById[vehicle.routeId].color;
  const angle = Number.isFinite(heading) ? heading : 0;
  return L.divIcon({ className: 'live-vessel-marker', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div class="live-vessel" style="--vessel-color:${color}"><svg viewBox="0 0 24 24" width="19" height="19" style="transform:rotate(${angle}deg)" aria-hidden="true"><path d="M12 2L18 8V18L12 22L6 18V8Z" fill="currentColor" stroke="#fff" stroke-width="1.8"/><path d="M9 10H15M9 14H15" stroke="#fff" stroke-width="1.5"/></svg></div>` });
}
export function initRealtimeView() {
  const panel = document.getElementById('live-panel');
  const label = document.getElementById('live-label');
  const content = document.getElementById('live-content');
  const markers = new Map(); // vehicle id -> { marker, routeId }
  const headings = new Map(); // vehicle id -> last position + derived bearing
  const tripsById = Object.fromEntries(schedules.map(t => [t.t, t]));
  function render() {
    const snapshot = getRealtimeSnapshot();
    const selectedRoutes = state.lastSearch ? (state.currentOptions[state.currentActiveIdx] || []).map(l => l.route) : [];
    const allVehicles = getVehicles(snapshot.feeds.vehicles, tripsById, routeById);
    const vehicles = allVehicles.filter(v => !selectedRoutes.length || selectedRoutes.includes(v.routeId));
    const seen = new Set();
    for (const vehicle of vehicles) trackVesselHeading(headings, vehicle, seededVesselHeading(vehicle, tripsById[vehicle.tripId], stopById));
    for (const vehicle of state.showLiveBoats ? vehicles : []) {
      seen.add(vehicle.id);
      const heading = headings.get(vehicle.id)?.bearing;
      let entry = markers.get(vehicle.id);
      if (!entry) {
        entry = { marker: L.marker([vehicle.lat, vehicle.lng], { icon: vesselIcon(vehicle, heading), title: 'Live NYC Ferry', zIndexOffset: 500 }).addTo(map), routeId: vehicle.routeId };
        markers.set(vehicle.id, entry);
      } else {
        entry.marker.setLatLng([vehicle.lat, vehicle.lng]);
        const svg = entry.routeId === vehicle.routeId ? entry.marker.getElement()?.querySelector('.live-vessel svg') : null;
        if (svg) svg.style.transform = `rotate(${Number.isFinite(heading) ? heading : 0}deg)`; // rotate in place so the CSS transition runs
        else entry.marker.setIcon(vesselIcon(vehicle, heading)); // first paint or route change
        entry.routeId = vehicle.routeId;
      }
      const popup = document.createElement('div');
      popup.append(textElement('strong', vehicle.label), textElement('p', routeById[vehicle.routeId].name), textElement('small', `Live position · reported ${clock(vehicle.timestamp)}`));
      if (entry.marker.getPopup()) entry.marker.setPopupContent(popup);
      else entry.marker.bindPopup(popup);
    }
    for (const [id, entry] of markers) if (!seen.has(id)) { map.removeLayer(entry.marker); markers.delete(id); headings.delete(id); }

    const updates = snapshot.feeds.tripUpdates;
    const now = Date.now() / 1000;
    const hasUpdates = isFeedFresh(updates, 'tripUpdates', now) && updates.entities.some(e => {
      const timestamp = e.tripUpdate?.timestamp ?? updates.timestamp;
      return !e.isDeleted && e.tripUpdate && Number.isFinite(timestamp) && timestamp <= now + 30 && now - timestamp <= 90;
    });
    const fresh = ['vehicles', 'tripUpdates'].some(kind => isFeedFresh(snapshot.feeds[kind], kind));
    const live = vehicles.length > 0 || hasUpdates;
    const selectedStops = state.lastSearch ? (state.currentOptions[state.currentActiveIdx] || []).flatMap(l => l.stops) : [];
    const alerts = getAlerts(snapshot.feeds.alerts, selectedRoutes.length ? selectedRoutes : Object.keys(routeById), Date.now() / 1000, selectedStops.length ? selectedStops : Object.keys(stopById), stopAliases);
    panel.dataset.state = alerts.length ? 'alert' : live ? 'live' : fresh ? 'scheduled' : 'unavailable';
    label.textContent = vehicles.length ? `${vehicles.length} live boat${vehicles.length === 1 ? '' : 's'}` : hasUpdates ? 'Live trip updates' : snapshot.status === 'loading' ? 'Checking live service…' : fresh ? 'Timetable · live feed checked' : 'Timetable · live unavailable';
    if (vehicles.length && !state.showLiveBoats) label.textContent += ' · hidden';
    if (alerts.length) label.textContent = `${alerts.length} service alert${alerts.length === 1 ? '' : 's'} · ${label.textContent}`;
    const body = [];
    body.push(textElement('p', hasUpdates ? 'Live predictions update your trip times.'
      : fresh ? 'Trip times currently follow the timetable.' : 'Live reports unavailable. Showing timetable times.'));
    if (!state.showLiveBoats) body.push(textElement('p', 'Boat markers are hidden. Show them in Settings.'));
    if (snapshot.status === 'unavailable' && fresh) body.push(textElement('p', 'Connection interrupted. Recent reports expire automatically.'));
    const meta = document.createElement('div');
    meta.className = 'live-meta';
    if (snapshot.checkedAt) meta.append(textElement('small', `Checked ${clock(snapshot.checkedAt)}`));
    if (metadata?.generatedAt) meta.append(textElement('small', `Timetable ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(metadata.generatedAt))}`));
    body.push(meta);
    for (const alert of alerts) {
      const notice = document.createElement('article');
      notice.className = 'live-alert';
      notice.append(textElement('strong', alert.title));
      if (alert.description && alert.description !== alert.title) notice.append(textElement('p', alert.description));
      body.push(notice);
    }
    const link = textElement('a', 'Service alerts ↗');
    link.href = 'https://www.ferry.nyc/service-alerts/';
    link.target = '_blank'; link.rel = 'noopener';
    body.push(link);
    content.replaceChildren(...body);
  }
  subscribeRealtime(render);
  subscribeState(action => { if (['SET_SEARCH_RESULT', 'SET_ACTIVE_ROUTE_IDX', 'CLEAR_SEARCH', 'SET_SHOW_LIVE_BOATS'].includes(action)) render(); });
  render();
}
