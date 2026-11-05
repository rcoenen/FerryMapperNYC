// Settings drawer, map style switching, time format, geolocation

import { state, subscribeState, TIME_FMT_KEY, STYLE_STORAGE_KEY, TRANSFER_TIME_KEY, LIVE_BOATS_STORAGE_KEY, setMapStyle, setTransferTime, setShowLiveBoats } from './state.js';
import { map, MAP_STYLES, createTileLayer } from './map-core.js';
import { applyDateTimeInputMode, syncLocaleFormatClass, syncDateTimeButton, refreshModalDisplay } from './datetime-input.js';
import { openTransferModal } from './modals.js';
import { initLocation } from './location.js';

export function initSettings({ onTimeFormatChange }) {
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsDrawer = document.getElementById('settings-drawer');
  const mapStyleSelect = document.getElementById('map-style-select');
  const buildNumberEl = document.getElementById('build-number');
  const transferTimeRow = document.getElementById('transfer-time-row');
  const transferTimeDisplay = document.getElementById('transfer-time-display');
  let buildCopyTimer = null;

  // Build number
  function showBuild(value) {
    if (!buildNumberEl) return;
    buildNumberEl.textContent = value;
    buildNumberEl.title = 'Click to copy';
  }

  async function copyBuild() {
    if (!buildNumberEl) return;
    const txt = (buildNumberEl.textContent || '').trim();
    if (!txt || txt === 'unknown') return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      buildNumberEl.classList.add('copied');
      buildNumberEl.title = 'Copied';
      clearTimeout(buildCopyTimer);
      buildCopyTimer = setTimeout(() => {
        buildNumberEl.classList.remove('copied');
        buildNumberEl.title = 'Click to copy';
      }, 1000);
    } catch {}
  }
  buildNumberEl?.addEventListener('click', copyBuild);

  const DEBUG_MODE = !!window.FM_CONFIG?.debug;
  function loadBuild() {
    // Always show build number, but fetch version.json only in debug mode
    const embedded = Number(window.FM_CONFIG?.build || document.querySelector('meta[name="app-build"]')?.content);
    if (Number.isFinite(embedded) && embedded >= 0) {
      showBuild(String(embedded));
      return;
    }
    
    // In debug mode, try to fetch version.json for git commit info
    if (DEBUG_MODE) {
      showBuild('unknown');
    }
  }
  loadBuild();

  // Map style
  mapStyleSelect.value = state.activeStyleKey;

  // Transfer time display
  function updateTransferTimeDisplay() {
    transferTimeDisplay.textContent = state.transferTime + ' min';
  }
  updateTransferTimeDisplay();
  transferTimeRow.addEventListener('click', openTransferModal);
  subscribeState((action) => {
    if (action === 'SET_TRANSFER_TIME' || action === 'RESTORE_DEFAULT_TRANSFER_TIME') {
      updateTransferTimeDisplay();
    }
  });

  // Time format toggle
  function updateTimeFmtButtons() {
    document.getElementById('fmt-24').classList.toggle('active', !state.use12h);
    document.getElementById('fmt-12').classList.toggle('active', state.use12h);
  }
  updateTimeFmtButtons();
  document.querySelectorAll('.time-fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.use12h = btn.dataset.fmt === '12';
      try { localStorage.setItem(TIME_FMT_KEY, btn.dataset.fmt); } catch {}
      syncLocaleFormatClass();
      applyDateTimeInputMode();
      updateTimeFmtButtons();
      syncDateTimeButton();
      refreshModalDisplay();
      onTimeFormatChange();
    });
  });

  // Settings drawer open/close
  function openSettingsDrawer() {
    settingsDrawer.hidden = false;
    settingsToggle.setAttribute('aria-expanded', 'true');
  }

  function closeSettingsDrawer() {
    settingsDrawer.hidden = true;
    settingsToggle.setAttribute('aria-expanded', 'false');
  }

  settingsToggle.addEventListener('click', () => {
    if (settingsDrawer.hidden) openSettingsDrawer();
    else closeSettingsDrawer();
  });

  document.addEventListener('click', (e) => {
    if (!settingsDrawer.hidden && !settingsDrawer.contains(e.target) && !settingsToggle.contains(e.target)) {
      closeSettingsDrawer();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettingsDrawer();
  });

  // Map style switching
  mapStyleSelect.addEventListener('change', () => {
    const key = mapStyleSelect.value;
    const s = MAP_STYLES[key];
    if (!s) return;
    map.removeLayer(state.currentTileLayer);
    state.currentTileLayer = createTileLayer(key).addTo(map);
    state.currentTileLayer.bringToBack?.();
    setMapStyle(key);
    try { localStorage.setItem(STYLE_STORAGE_KEY, key); } catch {}
  });

  initLocation();

  const liveBoatsToggle = document.getElementById('live-boats-toggle');
  try { setShowLiveBoats(localStorage.getItem(LIVE_BOATS_STORAGE_KEY) !== '0'); } catch {}
  liveBoatsToggle.checked = state.showLiveBoats;
  liveBoatsToggle.addEventListener('change', () => {
    setShowLiveBoats(liveBoatsToggle.checked);
    try { localStorage.setItem(LIVE_BOATS_STORAGE_KEY, liveBoatsToggle.checked ? '1' : '0'); } catch {}
  });

  try {
    // Load transfer time from localStorage
    const savedTransferTime = localStorage.getItem(TRANSFER_TIME_KEY);
    if (savedTransferTime !== null) {
      const value = parseInt(savedTransferTime);
      if (!isNaN(value) && value >= 1 && value <= 60) {
        setTransferTime(value);
        updateTransferTimeDisplay();
      }
    }
  } catch {}
}
