// Shared mutable application state and localStorage persistence

import { CONFIG } from './config.js';

/**
 * @typedef {Object} RouteOption
 * @property {import('./routing.js').RouteLeg[]} legs - Route legs
 * @property {number} depTime - Departure time
 * @property {number} arrTime - Arrival time
 */

/**
 * @typedef {Object} SearchState
 * @property {string} dateStr - Date string
 * @property {number} startMin - Start time in minutes
 * @property {string} mode - 'depart' or 'arrive'
 * @property {string} fromId - Origin stop ID
 * @property {string} toId - Destination stop ID
 */

// State change listeners for tracing mutations
const stateListeners = new Set();

/**
 * Subscribe to state changes
 * @param {(action: string, payload: any) => void} fn - Listener function
 * @returns {() => void} Unsubscribe function
 */
export function subscribeState(fn) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

/**
 * Notify listeners of state change (debug only)
 * @param {string} action - Action name
 * @param {any} payload - Action payload
 */
function notify(action, payload) {
  if (window.FM_CONFIG?.debug) {
    console.log(`[STATE] ${action}`, payload);
  }
  stateListeners.forEach(fn => fn(action, payload));
}

export const state = {
  // Route search
  lastSearch: null,
  currentOptions: [null, null, null],
  currentActiveIdx: 1,
  shiftCount: 0,

  // Preferences
  use12h: false,
  showLiveBoats: true,
  transferTime: CONFIG.MIN_TRANSFER_TIME_MIN,

  // Map visualization
  highlightLayers: [],
  previewStartMarker: null,
  previewEndMarker: null,

  // Map style
  activeStyleKey: 'positron',
  currentTileLayer: null,

  // Sheet
  currentSnap: 'peek',

  // Geolocation
  geoWatchId: null,
  geoMarker: null,
};

// Storage keys (from config)
export const STORAGE_KEY = CONFIG.STORAGE_KEY;
export const TIME_FMT_KEY = CONFIG.STORAGE_KEY_TIME_FMT;
export const STYLE_STORAGE_KEY = CONFIG.STORAGE_KEY_STYLE;
export const LOC_STORAGE_KEY = CONFIG.STORAGE_KEY_LOCATION;
export const LIVE_BOATS_STORAGE_KEY = CONFIG.STORAGE_KEY_LIVE_BOATS;
export const TRANSFER_TIME_KEY = CONFIG.STORAGE_KEY + '_transferTime';

export function saveState() {
  const s = {
    date: document.getElementById('date-input').value,
    time: document.getElementById('time-input').value,
    mode: document.getElementById('time-mode').value,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

export function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

// === State Actions (traceable mutations) ===

/**
 * Set search results
 * @param {RouteOption[]} options - Route options [earlier, best, later]
 * @param {number} activeIdx - Active option index (default: 1)
 */
export function setSearchResult(options, activeIdx = 1) {
  state.currentOptions = options;
  state.currentActiveIdx = activeIdx;
  notify('SET_SEARCH_RESULT', { options, activeIdx });
}

/**
 * Shift to previous/next route option
 * @param {number} direction - -1 for earlier, +1 for later
 */
export function shiftRoute(direction) {
  state.shiftCount += direction;
  notify('SHIFT_ROUTE', { direction, newCount: state.shiftCount });
}

/**
 * Clear current search results
 */
export function clearSearch() {
  state.lastSearch = null;
  state.currentOptions = [null, null, null];
  state.shiftCount = 0;
  notify('CLEAR_SEARCH', null);
}

/**
 * Set last search parameters
 * @param {SearchState} search - Search parameters
 */
export function setLastSearch(search) {
  state.lastSearch = search;
  notify('SET_LAST_SEARCH', search);
}

/**
 * Set active route option index
 * @param {number} idx - Option index (0=earlier, 1=best, 2=later)
 */
export function setActiveRouteIdx(idx) {
  state.currentActiveIdx = idx;
  notify('SET_ACTIVE_ROUTE_IDX', { idx });
}

/**
 * Set map style
 * @param {string} styleKey - Style key from MAP_STYLES
 */
export function setMapStyle(styleKey) {
  state.activeStyleKey = styleKey;
  notify('SET_MAP_STYLE', { styleKey });
}

export function setShowLiveBoats(visible) {
  state.showLiveBoats = visible;
  notify('SET_SHOW_LIVE_BOATS', { visible });
}

/**
 * Set sheet snap position
 * @param {'collapsed'|'peek'|'full'} snap - Snap position
 */
export function setSheetSnapState(snap) {
  state.currentSnap = snap;
  notify('SET_SHEET_SNAP', { snap });
}

/**
 * Set geolocation marker and watch ID
 * @param {L.Marker|null} marker - Leaflet marker
 * @param {number|null} watchId - Geolocation watch ID
 */
export function setGeolocation(marker, watchId) {
  state.geoMarker = marker;
  state.geoWatchId = watchId;
  notify('SET_GEOLOCATION', { marker, watchId });
}

/**
 * Clear geolocation
 */
export function clearGeolocation() {
  state.geoMarker = null;
  state.geoWatchId = null;
  notify('CLEAR_GEOLOCATION', null);
}

/**
 * Set transfer time
 * @param {number} minutes - Transfer time in minutes
 */
export function setTransferTime(minutes) {
  state.transferTime = minutes;
  notify('SET_TRANSFER_TIME', { minutes });
}

/**
 * Restore default transfer time
 */
export function restoreDefaultTransferTime() {
  state.transferTime = CONFIG.MIN_TRANSFER_TIME_MIN;
  notify('RESTORE_DEFAULT_TRANSFER_TIME', { defaultMinutes: CONFIG.MIN_TRANSFER_TIME_MIN });
}
