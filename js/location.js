// Location recovery stays available after a denied request or a phone settings change.
import { LOC_STORAGE_KEY, setGeolocation, clearGeolocation } from './state.js';
import { map } from './map-core.js';

export function initLocation() {
  const toggle = document.getElementById('location-toggle');
  const status = document.getElementById('location-status');
  const retry = document.getElementById('location-retry');
  const help = document.getElementById('location-help');
  const dialog = document.getElementById('location-dialog');
  const dialogTitle = document.getElementById('location-dialog-title');
  const dialogMessage = document.getElementById('location-dialog-message');
  const dialogRetry = document.getElementById('location-dialog-retry');
  const permissionHelp = document.getElementById('location-permission-help');
  let wanted = false;
  try { wanted = localStorage.getItem(LOC_STORAGE_KEY) === '1'; } catch {}
  let watchId = null;
  let marker = null;
  let generation = 0;
  let mode = 'off';
  let permission = null;
  let returnFocus = null;
  let interactiveRequest = false;

  const control = L.control({ position: 'topleft' });
  const mapButton = document.createElement('button');
  mapButton.id = 'location-map-btn';
  mapButton.className = 'location-map-btn';
  mapButton.type = 'button';
  mapButton.innerHTML = '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></svg>';
  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'location-control');
    container.append(mapButton);
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };
  control.addTo(map);

  function remember(enabled) {
    wanted = enabled;
    try {
      if (enabled) localStorage.setItem(LOC_STORAGE_KEY, '1');
      else localStorage.removeItem(LOC_STORAGE_KEY);
    } catch {}
  }

  function render(nextMode, message) {
    mode = nextMode;
    status.textContent = message;
    toggle.checked = mode === 'active' || mode === 'loading';
    const label = mode === 'active' ? 'Center on my location' : mode === 'loading' ? 'Finding your location…' : mode === 'off' ? 'Use my location' : 'Try location again';
    retry.textContent = label;
    retry.disabled = mapButton.disabled = dialogRetry.disabled = mode === 'loading';
    mapButton.dataset.state = mode;
    mapButton.title = label;
    mapButton.setAttribute('aria-label', label);
    mapButton.setAttribute('aria-busy', String(mode === 'loading'));
  }

  function stop() {
    generation++;
    if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
    watchId = null;
    if (marker) map.removeLayer(marker);
    marker = null;
    clearGeolocation();
  }

  function closeHelp() {
    if (!dialog.open) return;
    dialog.close();
    returnFocus?.focus();
  }

  function showHelp(kind = mode === 'blocked' ? 'blocked' : 'help') {
    const showPermissions = kind === 'blocked' || kind === 'help';
    dialogTitle.textContent = showPermissions ? 'Enable your location' : 'Location unavailable';
    dialogMessage.textContent = kind === 'blocked'
      ? 'Location access is blocked. Your browser needs you to allow it in settings before it can show your blue dot. After changing it, return here and try again.'
      : kind === 'help' ? 'Allow location access to show your blue dot. If access is blocked, change your browser permissions, then try again.' : status.textContent;
    permissionHelp.hidden = !showPermissions;
    dialogRetry.hidden = !navigator.geolocation || !window.isSecureContext;
    if (!dialog.open) {
      returnFocus = document.activeElement;
      dialog.showModal();
    }
  }

  function centerOnLocation() {
    if (marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
  }

  function requestLocation({ center = true, interactive = true } = {}) {
    if (mode === 'loading') return;
    remember(true);
    stop();
    if (!navigator.geolocation || !window.isSecureContext) {
      render('unavailable', 'Location is unavailable in this browser. Open the site in Safari or Chrome over HTTPS.');
      if (interactive) showHelp('unavailable');
      return;
    }
    render('loading', 'Finding your location… Allow access if your browser asks.');
    interactiveRequest = interactive;
    const current = generation;
    let shouldCenter = center;
    watchId = navigator.geolocation.watchPosition(position => {
      if (current !== generation || !wanted) return;
      const { latitude, longitude } = position.coords;
      if (marker) marker.setLatLng([latitude, longitude]);
      else {
        const icon = L.divIcon({ className: '',
          html: '<div class="location-dot"><div class="location-dot-pulse"></div><div class="location-dot-inner"></div></div>',
          iconSize: [16, 16], iconAnchor: [8, 8] });
        marker = L.marker([latitude, longitude], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      }
      setGeolocation(marker, watchId);
      render('active', 'Your location is on. The blue dot updates as you move.');
      if (shouldCenter) { centerOnLocation(); shouldCenter = false; }
      closeHelp();
    }, error => {
      if (current !== generation || !wanted) return;
      stop();
      const blocked = error.code === 1;
      render(blocked ? 'blocked' : 'unavailable', blocked
        ? 'Location is blocked. Allow it in browser settings, then try again.'
        : error.code === 3 ? 'Finding your location took too long. Check that your phone’s location is on, then try again.'
          : 'Your position is unavailable. Check that your phone’s location is on, then try again.');
      if (interactive) showHelp(blocked ? 'blocked' : 'unavailable');
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  }

  function locate() {
    if (mode === 'active' && marker) centerOnLocation();
    else requestLocation();
  }
  mapButton.addEventListener('click', locate);
  retry.addEventListener('click', locate);
  dialogRetry.addEventListener('click', () => requestLocation());
  help.addEventListener('click', () => showHelp());
  document.getElementById('location-dialog-close').addEventListener('click', closeHelp);
  dialog.addEventListener('click', event => {
    event.stopPropagation();
    if (event.target === dialog) closeHelp();
  });
  dialog.addEventListener('keydown', event => {
    // Let the native dialog handle Escape without closing the map beneath it.
    if (event.key === 'Escape') event.stopPropagation();
  });
  toggle.addEventListener('change', () => {
    if (toggle.checked) requestLocation({ center: false });
    else {
      remember(false);
      stop();
      render('off', 'Location is off. Tap Use my location to show the blue dot.');
    }
  });

  function permissionChanged() {
    if (!wanted) return;
    if (permission.state === 'granted' && watchId === null) {
      requestLocation({ center: false, interactive: false });
    } else if (permission.state === 'denied') {
      const showExplanation = mode === 'loading' && interactiveRequest;
      stop();
      render('blocked', 'Location is blocked. Allow it in browser settings, then try again.');
      if (showExplanation) showHelp();
    } else if (permission.state === 'prompt' && mode !== 'loading') {
      stop();
      render('off', 'Tap Use my location to allow access and show the blue dot.');
    }
  }
  async function checkPermission() {
    try {
      const next = await navigator.permissions.query({ name: 'geolocation' });
      if (permission) permission.removeEventListener('change', permissionChanged);
      permission = next;
      permission.addEventListener('change', permissionChanged);
      permissionChanged();
    } catch {
      // Safari versions without permission queries still retry through a user tap.
    }
  }
  render('off', 'Tap Use my location to show the blue dot.');
  checkPermission();
  window.addEventListener('focus', checkPermission);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPermission(); });
}
