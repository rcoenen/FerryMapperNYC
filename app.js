// FerryMapperNYC — entry point
// Orchestrates module initialization and wires event handlers.

import { loadData, sorted, stopById } from './js/data.js';
import { state, saveState, loadState, TIME_FMT_KEY, setSearchResult, setLastSearch, clearSearch, shiftRoute, setActiveRouteIdx, subscribeState, setTransferTime } from './js/state.js';
import { timeToMin, getNYCDateTime } from './js/time-utils.js';
import { findOptions, isComplete } from './js/routing.js';
import { initMap, map, updatePreviewMarkers } from './js/map-core.js';
import { showRoute, clearHighlights } from './js/route-drawing.js';
import { showDirections, setDirections } from './js/directions.js';
import {
  applyDateTimeInputMode, syncLocaleFormatClass,
  normalizeDateValue, normalizeTimeValue,
  normalizeDateInput, normalizeTimeInput,
  syncDateTimeButton, restoreNativeInputs, refreshModalDisplay, checkPastTime
} from './js/datetime-input.js';
import { initModals, closeAboutModal, closeNerdModal, closeDateModal, closeTransferModal } from './js/modals.js';
import { initSheet, isMobile, setSheetSnap, openMapOverlay, closeMapOverlay } from './js/sheet.js';
import { initSettings } from './js/settings.js';
import { initDOM, getEl, getAll } from './js/dom.js';
import { initErrorHandling, wrapAsync, AppError } from './js/errors.js';

// --- Initialize error handling ---
initErrorHandling();

// --- Load data ---
await wrapAsync(loadData, (err) => {
  throw new AppError('Failed to load ferry data. Please refresh the page.', false);
})();

// --- Initialize modules ---
initDOM();
initMap();
initSheet();
initModals();

// --- Time format ---
try { state.use12h = localStorage.getItem(TIME_FMT_KEY) === '12'; } catch {}

// --- State change listeners ---
// Auto-recalculate route when transfer time changes
subscribeState((action, payload) => {
  if ((action === 'SET_TRANSFER_TIME' || action === 'RESTORE_DEFAULT_TRANSFER_TIME') && state.lastSearch && goBtn) {
    goBtn.click(); // Re-run search with new transfer time
  }
});

// --- DOM refs (from centralized module) ---
const dateInput = getEl('date-input');
const timeInput = getEl('time-input');
const fromSel = getEl('from-select');
const toSel = getEl('to-select');
const goBtn = getEl('go-btn');
const controls = getEl('controlsContainer');
const routeActions = getEl('route-actions');

// --- Date/time input setup ---
applyDateTimeInputMode();
syncLocaleFormatClass();

// Hydrate from saved state or default to now
const saved = loadState();
const now = getNYCDateTime();
const todayStr = now.date;
const nowTime = now.time;

if (saved) {
  const timeMode = getEl('time-mode');
  if (saved.mode && timeMode) timeMode.value = saved.mode;
}
const savedDate = normalizeDateValue(saved?.date || '');
const savedTime = normalizeTimeValue(saved?.time || '');
if (savedDate && savedTime) {
  dateInput.value = savedDate;
  timeInput.value = savedTime;
} else {
  dateInput.value = todayStr;
  timeInput.value = nowTime;
}
syncDateTimeButton();

// Date modal buttons
getEl('date-modal-today').addEventListener('click', () => {
  restoreNativeInputs();
  dateInput.value = getNYCDateTime().date;
  dateInput.dataset.raw = dateInput.value;
  syncDateTimeButton();
  checkPastTime();
  saveState();
  refreshModalDisplay();
});
getEl('date-modal-now').addEventListener('click', () => {
  restoreNativeInputs();
  const n = getNYCDateTime();
  dateInput.value = n.date;
  timeInput.value = n.time;
  dateInput.dataset.raw = dateInput.value;
  timeInput.dataset.raw = timeInput.value;
  syncDateTimeButton();
  saveState();
  closeDateModal();
});
getEl('date-modal-done').addEventListener('click', () => {
  restoreNativeInputs();
  const d = normalizeDateInput({ commit: true });
  const t = normalizeTimeInput({ commit: true });
  if (!d || !t) return;
  checkPastTime();
  saveState();
  closeDateModal();
});

// Modal display handlers
timeInput.addEventListener('click', () => { restoreNativeInputs(); });
dateInput.addEventListener('click', () => { restoreNativeInputs(); });
timeInput.addEventListener('change', () => { if (timeInput.type === 'time') { timeInput.dataset.raw = timeInput.value; refreshModalDisplay(); } });
dateInput.addEventListener('change', () => { if (dateInput.type === 'date') { dateInput.dataset.raw = dateInput.value; refreshModalDisplay(); } });

// Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDateModal();
    closeNerdModal();
    closeAboutModal();
    closeTransferModal();
    closeMapOverlay();
  }
});

// --- Populate stop selects ---
function populateSelect(sel, placeholder) {
  sel.innerHTML = `<option value="" disabled hidden>${placeholder}</option>`;
  sorted.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
}
populateSelect(fromSel, 'Start');
populateSelect(toSel, 'End');
fromSel.value = '';
toSel.value = '';

// --- Route state helpers ---
function hasValidRouteSelection() {
  return !!fromSel.value && !!toSel.value && fromSel.value !== toSel.value;
}

function updateGoButtonState() {
  if (!goBtn) return;
  const enabled = hasValidRouteSelection();
  goBtn.disabled = !enabled;
  goBtn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function resetRoute() {
  routeActions?.classList.remove('visible');
  updateGoButtonState();
  if (!state.lastSearch) return;
  clearHighlights();
  const dir = getEl('directions');
  dir.classList.remove('visible');
  dir.innerHTML = '';
  controls.style.display = '';
  clearSearch();
  if (isMobile()) setSheetSnap('peek');
  updatePreviewMarkers();
}

function newRoute() {
  fromSel.value = '';
  toSel.value = '';
  saveState();
  resetRoute();
}

// --- Save on any change ---
const timeMode = getEl('time-mode');
for (const el of [fromSel, toSel, dateInput, timeInput, timeMode]) {
  el.addEventListener('change', saveState);
}
fromSel.addEventListener('change', updateGoButtonState);
toSel.addEventListener('change', updateGoButtonState);
dateInput.addEventListener('change', syncDateTimeButton);
dateInput.addEventListener('input', syncDateTimeButton);
timeInput.addEventListener('change', syncDateTimeButton);
timeInput.addEventListener('input', syncDateTimeButton);
dateInput.addEventListener('change', checkPastTime);
timeInput.addEventListener('change', checkPastTime);
checkPastTime();
updateGoButtonState();

// --- Stop change handlers ---
fromSel.addEventListener('change', resetRoute);
toSel.addEventListener('change', resetRoute);
fromSel.addEventListener('change', updatePreviewMarkers);
toSel.addEventListener('change', updatePreviewMarkers);

// Guard: Start and End cannot be the same stop
fromSel.addEventListener('change', () => {
  if (fromSel.value && fromSel.value === toSel.value) {
    toSel.value = '';
    updateGoButtonState();
    updatePreviewMarkers();
    saveState();
  }
});
toSel.addEventListener('change', () => {
  if (toSel.value && toSel.value === fromSel.value) {
    fromSel.value = '';
    updateGoButtonState();
    updatePreviewMarkers();
    saveState();
  }
});

// --- Route action buttons ---
getEl('clear-route-btn').addEventListener('click', newRoute);
getEl('show-map-btn').addEventListener('click', openMapOverlay);

// --- Share button ---
function buildShareUrl() {
  if (!state.lastSearch) return null;
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('from', state.lastSearch.fromId);
  url.searchParams.set('to', state.lastSearch.toId);
  url.searchParams.set('date', state.lastSearch.dateStr);
  const h = Math.floor(state.lastSearch.startMin / 60) % 24;
  const m = state.lastSearch.startMin % 60;
  url.searchParams.set('time', `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
  url.searchParams.set('mode', state.lastSearch.mode);
  url.searchParams.set('tt', String(state.transferTime));
  return url.toString();
}

const shareBtn = getEl('share-route-btn');
shareBtn.addEventListener('click', async () => {
  const url = buildShareUrl();
  if (!url) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'FerryMapperNYC route', url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    shareBtn.textContent = 'Link copied!';
    setTimeout(() => { shareBtn.textContent = 'Share route'; }, 2500);
  } catch {
    prompt('Copy this link:', url);
  }
});

// Swap button
getEl('swap-btn').addEventListener('click', () => {
  const tmp = fromSel.value;
  fromSel.value = toSel.value;
  toSel.value = tmp;
  resetRoute();
  saveState();
  updateGoButtonState();
});

// --- Popup Start/End button handlers ---
map.on('popupopen', (e) => {
  const container = e.popup.getElement();
  if (!container) return;
  function flashField(sel) {
    const field = sel.closest('.control-field');
    if (!field) return;
    field.classList.remove('field-flash');
    void field.offsetWidth;
    field.classList.add('field-flash');
  }
  container.querySelectorAll('.popup-start').forEach(btn => {
    btn.addEventListener('click', () => {
      fromSel.value = btn.dataset.stop;
      if (state.lastSearch || toSel.value === fromSel.value) toSel.value = '';
      resetRoute();
      updatePreviewMarkers();
      saveState();
      updateGoButtonState();
      map.closePopup();
      flashField(fromSel);
    });
  });
  container.querySelectorAll('.popup-end').forEach(btn => {
    btn.addEventListener('click', () => {
      toSel.value = btn.dataset.stop;
      if (state.lastSearch || fromSel.value === toSel.value) fromSel.value = '';
      resetRoute();
      updatePreviewMarkers();
      saveState();
      updateGoButtonState();
      map.closePopup();
      flashField(toSel);
    });
  });
});

// --- GO button ---
goBtn.addEventListener('click', () => {
  try {
    const fromId = fromSel.value;
    const toId = toSel.value;
    const mode = timeMode.value;

    if (!fromId || !toId) {
      setDirections('<div class="error-msg">Please select both a Start and End stop.</div>');
      return;
    }
    if (fromId === toId) {
      setDirections('<div class="error-msg">Origin and destination are the same stop.</div>');
      return;
    }

    const dateStr = normalizeDateInput({ commit: true });
    const timeStr = normalizeTimeInput({ commit: true });
    if (!dateStr || !timeStr) {
      setDirections('<div class="error-msg">Please enter a valid date/time.</div>');
      return;
    }
    const startMin = timeToMin(timeStr + ':00');
    const options = findOptions(fromId, toId, dateStr, startMin, mode);

    setLastSearch({ dateStr, startMin, mode, fromId, toId });

    const activeIdx = 1;
    if (options[activeIdx] && isComplete(options[activeIdx])) {
      showRoute(options[activeIdx]);
    } else {
      const fb = options.findIndex(o => o && isComplete(o));
      if (fb >= 0) showRoute(options[fb]);
      else clearHighlights();
    }
    setSearchResult(options, activeIdx);
    showDirections(options, fromId, toId, activeIdx);
  } catch (err) {
    console.error('[FerryMapper] Route search error:', err);
    setDirections(`<div class="error-msg">Error finding route: ${err.message}</div>`);
  }
});

// --- Settings ---
initSettings({
  onTimeFormatChange() {
    if (state.currentOptions && state.lastSearch) {
      showDirections(state.currentOptions, state.lastSearch.fromId, state.lastSearch.toId, state.currentActiveIdx);
    }
  }
});

// --- Auto-search from shared URL params ---
(function() {
  const p = new URLSearchParams(window.location.search);
  const fromId = p.get('from');
  const toId = p.get('to');
  const date = p.get('date');
  const time = p.get('time');
  const mode = p.get('mode');
  if (!fromId || !toId || fromId === toId) return;
  if (!stopById[fromId] || !stopById[toId]) return;
  fromSel.value = fromId;
  toSel.value = toId;
  if (date) { dateInput.value = date; dateInput.dataset.raw = date; }
  if (time) { timeInput.value = time; timeInput.dataset.raw = time; }
  if (mode === 'arrive' || mode === 'depart') timeMode.value = mode;
  const tt = parseInt(p.get('tt'));
  if (tt >= 1 && tt <= 60) setTransferTime(tt);
  syncDateTimeButton();
  updateGoButtonState();
  history.replaceState(null, '', window.location.pathname);
  goBtn.click();
})();