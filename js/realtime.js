import { CONFIG } from './config.js';
import { stopAliases } from './data.js';
import { getNYCDateTime } from './time-utils.js';
import { applyTripUpdates, applyServiceAlerts, isFeedFresh } from './realtime-core.js';

let snapshot = { feeds: {}, checkedAt: null, status: 'loading' };
let revision = 0;
const listeners = new Set();
let inflight = false;
let started = false;
const emit = () => listeners.forEach(fn => fn(snapshot));
export function subscribeRealtime(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getRealtimeSnapshot() { return snapshot; }
export function getRealtimeVersion() {
  const feed = snapshot.feeds.tripUpdates;
  const now = Date.now() / 1000;
  const active = isFeedFresh(feed, 'tripUpdates') ? 'live:' + feed.entities.map(e => {
    const timestamp = e.tripUpdate?.timestamp ?? feed.timestamp;
    return Number.isFinite(timestamp) && timestamp <= now + 30 && now - timestamp <= 90 ? '1' : '0';
  }).join('') : 'scheduled';
  return `${revision}:${getNYCDateTime().date}:${active}:${isFeedFresh(snapshot.feeds.alerts, 'alerts')}`;
}
export function getRealtimeTrip(trip, date) {
  const resolved = applyTripUpdates(trip, date, snapshot.feeds.tripUpdates, stopAliases);
  return applyServiceAlerts(resolved, date, snapshot.feeds.alerts, stopAliases);
}
// Also used by deterministic integration checks; no network or timer required.
export function setRealtimeSnapshot(next) { snapshot = next; revision++; emit(); }

export async function refreshRealtime() {
  if (inflight || !CONFIG.REALTIME_URL) return;
  inflight = true;
  try {
    const response = await fetch(CONFIG.REALTIME_URL, { credentials: 'omit', signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('Live service unavailable');
    const next = await response.json();
    if (!next.feeds || !['vehicles', 'tripUpdates', 'alerts'].every(k => next.feeds[k] && Array.isArray(next.feeds[k].entities))) throw new Error('Invalid live snapshot');
    setRealtimeSnapshot({ feeds: next.feeds, checkedAt: Date.now() / 1000, status: 'ok' });
  } catch {
    // Keep the last reports only until their source timestamps expire.
    snapshot = { ...snapshot, status: 'unavailable' };
    emit();
  } finally { inflight = false; }
}
export function startRealtime() {
  if (started) return;
  started = true;
  if (!CONFIG.REALTIME_URL) { snapshot.status = 'unavailable'; emit(); return; }
  refreshRealtime();
  setInterval(() => { if (!document.hidden) refreshRealtime(); }, 30000);
  // Expire markers/predictions even when a request fails or a feed stops moving.
  setInterval(() => { if (!document.hidden) emit(); }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { emit(); refreshRealtime(); }
  });
}
