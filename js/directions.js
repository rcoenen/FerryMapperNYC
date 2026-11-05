// Directions display: timeline HTML, tab bar, swipe handler

import { stopById, routeById } from './data.js';
import { state, shiftRoute, setSearchResult, setActiveRouteIdx } from './state.js';
import { formatTime, formatDuration } from './time-utils.js';
import { getArrival, getDeparture, getTotalTime, getMaxWait, isComplete, findOptions } from './routing.js';
import { showRoute, clearHighlights } from './route-drawing.js';
import { map, isLightColor } from './map-core.js';
import { isMobile, closeMapOverlay, setSheetSnap } from './sheet.js';

const BASE_LABELS = ['Earlier', 'Best', 'Later'];

function renderLegs(resolvedLegs) {
  let html = '<div class="timeline">';
  const lastLegIdx = resolvedLegs.length - 1;

  resolvedLegs.forEach((leg, i) => {
    const route = routeById[leg.route];
    const boardStop = stopById[leg.stops[0]].name;
    const alightStop = stopById[leg.stops[leg.stops.length - 1]].name;
    const numStops = leg.stops.length - 1;
    const isFirst = i === 0;
    const isLast = i === lastLegIdx;

    if (i > 0) {
      let transferText = '\u23F1 Transfer';
      if (leg.waitMin !== null && leg.waitMin >= 0) {
        transferText += ` \u00B7 ${formatDuration(leg.waitMin)} wait`;
      }
      html += `<div class="tl-transfer"><div class="tl-transfer-info">${transferText}</div></div>`;
    }

    const originClass = isFirst ? ' tl-origin' : '';
    const depTimeStr = leg.depTime !== null ? formatTime(leg.depTime) : '';
    const depTimeClass = isFirst ? ' tl-station-time-strong' : '';
    const depDotFill = route.color;
    html += `<div class="tl-station${originClass}">` +
      `<div class="tl-dot" style="border-color:${route.color};background:${depDotFill}"></div>` +
      `<div class="tl-station-name">${boardStop}</div>` +
      (depTimeStr ? `<div class="tl-station-time${depTimeClass}">${depTimeStr}</div>` : '') +
      `</div>`;

    html += `<div class="tl-leg" style="color:${route.color}">`;
    const liveLabel = leg.realtime
      ? (leg.realtimeDeparture && leg.realtimeArrival ? 'Live times' : leg.realtimeDeparture ? 'Live departure' : 'Live arrival')
      : 'Timetable';
    const delayLabel = leg.realtimeDeparture && Math.abs(leg.delayMin) >= 1
      ? ` · ${Math.round(Math.abs(leg.delayMin))} min ${leg.delayMin > 0 ? 'late' : 'early'}` : '';
    html += `<div class="tl-live ${leg.realtime ? 'is-live' : ''}">${liveLabel}${delayLabel}</div>`;
    html += `<div class="tl-route">` +
      `<span class="tl-route-badge" style="background:${route.color};color:${isLightColor(route.color) ? '#243746' : '#fff'}">\u26F4 ${route.name}</span>` +
      (leg.toward && leg.toward !== alightStop ? `<br><span class="tl-route-dir">Direction: ${leg.toward}</span>` : '') +
      `</div>`;
    if (leg.depTime !== null) {
      html += `<div class="tl-stops-row">` +
        `<span class="tl-stops-count">${numStops} stop${numStops !== 1 ? 's' : ''} (${formatDuration(leg.rideMin)})</span>` +
        `</div>`;
    } else {
      html += `<div class="tl-no-trips">No more trips today</div>`;
    }
    html += `</div>`;

    const destClass = isLast ? ' tl-dest' : '';
    const arrTimeStr = leg.arrTime !== null ? formatTime(leg.arrTime) : '';
    const arrTimeClass = isLast ? ' tl-station-time-strong' : '';
    const arrDotFill = route.color;
    html += `<div class="tl-station${destClass}">` +
      `<div class="tl-dot" style="border-color:${route.color};background:${arrDotFill}"></div>` +
      `<div class="tl-station-name">${alightStop}</div>` +
      (arrTimeStr ? `<div class="tl-station-time${arrTimeClass}">${arrTimeStr}</div>` : '') +
      `</div>`;
  });

  html += '</div>';

  const transfers = resolvedLegs.length - 1;
  const totalStops = resolvedLegs.reduce((sum, l) => sum + l.stops.length - 1, 0);
  let summaryParts = [`${totalStops} stops`];
  if (transfers > 0) summaryParts.push(`${transfers} transfer${transfers !== 1 ? 's' : ''}`);
  if (resolvedLegs[0].depTime !== null) {
    const firstDep = resolvedLegs[0].depTime;
    const lastArr = resolvedLegs[lastLegIdx].arrTime;
    if (lastArr !== null) {
      const totalTime = lastArr - firstDep;
      summaryParts.push(`<strong>${formatDuration(totalTime)} total</strong>`);
    }
  }
  if (transfers > 0) html += `<div class="dir-summary">${summaryParts.join(' \u00B7 ')}</div>`;
  return html;
}

function buildTabHtml(option, label) {
  const labelHtml = `<div class="tab-label">${label || '&nbsp;'}</div>`;
  if (!option || !isComplete(option)) {
    return `<div class="option-tab disabled">${labelHtml}<div class="tab-time">-</div></div>`;
  }
  const dep = getDeparture(option);
  const total = getTotalTime(option);
  const maxWait = getMaxWait(option);
  const transferClass = maxWait > 20 ? ' tab-transfer-long' : '';
  const waitInfo = maxWait > 0 ? `<div class="tab-transfer${transferClass}">${formatDuration(maxWait)} transfer</div>` : '';
  return `${labelHtml}<div class="tab-time">${formatTime(dep)}</div><div class="tab-dur">${formatDuration(total)}</div>${waitInfo}`;
}

export function shiftOptions(direction) {
  if (!state.lastSearch) return;
  const { dateStr, mode, fromId, toId } = state.lastSearch;
  const ref = direction === -1 ? state.currentOptions[0] : state.currentOptions[2];
  if (!ref || !isComplete(ref)) return;
  const refTime = mode === 'arrive' ? getArrival(ref) : getDeparture(ref);
  const newStartMin = refTime;
  state.lastSearch.startMin = newStartMin;
  const options = findOptions(fromId, toId, dateStr, newStartMin, mode);
  const activeIdx = 1;
  shiftRoute(direction);
  if (options[activeIdx] && isComplete(options[activeIdx])) {
    showRoute(options[activeIdx]);
  } else {
    const fb = options.findIndex(o => o && isComplete(o));
    if (fb >= 0) showRoute(options[fb]);
  }
  showDirections(options, fromId, toId, activeIdx);
}

export function setDirections(html, hasRoute) {
  const dir = document.getElementById('directions');
  const controls = document.querySelector('.controls');
  const routeActions = document.getElementById('route-actions');
  if (isMobile()) {
    closeMapOverlay();
    setSheetSnap('full');
  }
  controls.style.display = hasRoute ? 'none' : '';
  if (routeActions) routeActions.classList.toggle('visible', !!hasRoute);
  dir.innerHTML = html;
  dir.classList.add('visible');
  map.invalidateSize();
}

export function showDirections(options, fromId, toId, activeIdx) {
  const dir = document.getElementById('directions');
  setSearchResult(options, activeIdx);

  if (!options[0] && !options[1] && !options[2]) {
    clearHighlights();
    setDirections('<div class="error-msg">No trips available between these stops for this date.</div>');
    return;
  }

  if (!options[activeIdx] || !isComplete(options[activeIdx])) {
    activeIdx = options.findIndex(o => o && isComplete(o));
    if (activeIdx === -1) {
      setDirections('<div class="error-msg">No trips available for this date.</div>');
      return;
    }
  }

  setActiveRouteIdx(activeIdx);
  let html = '';
  if (!isComplete(options[1])) {
    const search = state.lastSearch;
    const message = search?.mode === 'arrive'
      ? `No trip arrives by ${formatTime(search.startMin)}. A later trip is shown below.`
      : `No trip departs at or after ${formatTime(search?.startMin ?? 0)} on this date. An earlier trip is shown below.`;
    html += `<div class="error-msg" role="status">${message}</div>`;
  }

  const labels = BASE_LABELS;
  const canGoEarlier = options[0] && isComplete(options[0]);
  const canGoLater = options[2] && isComplete(options[2]);

  html += '<div class="option-tabs">';
  html += `<button class="nav-btn" id="nav-earlier" ${canGoEarlier ? '' : 'disabled'}>&lsaquo;</button>`;
  for (let i = 0; i < 3; i++) {
    const opt = options[i];
    const isActive = i === activeIdx;
    const isDisabled = !opt || !isComplete(opt);
    const cls = isDisabled ? 'option-tab disabled' : (isActive ? 'option-tab active' : 'option-tab');
    html += `<div class="${cls}" data-tab="${i}">${buildTabHtml(opt, labels[i])}</div>`;
  }
  html += `<button class="nav-btn" id="nav-later" ${canGoLater ? '' : 'disabled'}>&rsaquo;</button>`;
  html += '</div>';

  html += `<div id="option-detail">${renderLegs(options[activeIdx])}</div>`;

  setDirections(html, true);
  const tabsEl = dir.querySelector('.option-tabs');
  const tabs = tabsEl ? tabsEl.querySelectorAll('.option-tab') : [];
  let tabShiftAnimating = false;
  const animateTabShift = (direction) => {
    if (tabShiftAnimating) return;
    if (!tabs.length) {
      shiftOptions(direction);
      return;
    }
    tabShiftAnimating = true;
    const tabWidth = tabs[1]?.offsetWidth || tabs[0]?.offsetWidth || 0;
    const snapTarget = direction > 0 ? -tabWidth : tabWidth;
    tabs.forEach((t) => {
      t.style.transition = 'transform 140ms ease-out';
      t.style.transform = `translateX(${snapTarget}px)`;
    });
    setTimeout(() => {
      tabs.forEach((t) => {
        t.style.transition = '';
        t.style.transform = '';
      });
      tabShiftAnimating = false;
      shiftOptions(direction);
    }, 150);
  };

  document.getElementById('nav-earlier')?.addEventListener('click', () => animateTabShift(-1));
  document.getElementById('nav-later')?.addEventListener('click', () => animateTabShift(1));

  // Horizontal swipe/drag on option tabs
  if (tabsEl) {
    let startX = 0;
    let currentX = 0;
    let swiping = false;
    let pointerId = null;
    let dragged = false;
    let didSwipe = false;
    let pointerDownTarget = null;

    tabsEl.addEventListener('pointerdown', e => {
      if (e.target.closest('.nav-btn')) return;
      pointerDownTarget = e.target;
      pointerId = e.pointerId;
      tabsEl.setPointerCapture?.(pointerId);
      startX = e.clientX;
      currentX = startX;
      swiping = true;
      dragged = false;
      didSwipe = false;
    });

    tabsEl.addEventListener('pointermove', e => {
      if (!swiping || (pointerId !== null && e.pointerId !== pointerId)) return;
      currentX = e.clientX;
      const dx = currentX - startX;
      if (Math.abs(dx) > 6) dragged = true;
      tabs.forEach(t => t.style.transform = `translateX(${dx}px)`);
    });

    const finishSwipe = (e) => {
      if (!swiping || (pointerId !== null && e.pointerId !== pointerId)) return;
      swiping = false;
      pointerId = null;
      if (!dragged) {
        didSwipe = false;
        return;
      }
      const dx = currentX - startX;
      const shouldShift = Math.abs(dx) > 50;
      didSwipe = shouldShift;
      const shiftDir = dx < 0 ? 1 : -1;
      const tabWidth = tabs[1]?.offsetWidth || tabs[0]?.offsetWidth || 0;
      const snapTarget = shouldShift ? (dx < 0 ? -tabWidth : tabWidth) : 0;

      tabs.forEach((t) => {
        t.style.transition = 'transform 140ms ease-out';
        t.style.transform = `translateX(${snapTarget}px)`;
      });

      setTimeout(() => {
        tabs.forEach((t) => { t.style.transition = ''; });
        if (shouldShift) {
          shiftOptions(shiftDir);
        } else {
          tabs.forEach((t) => { t.style.transform = ''; });
        }
      }, 150);
    };

    tabsEl.addEventListener('pointerup', finishSwipe);
    tabsEl.addEventListener('pointercancel', finishSwipe);

    // Handle tab clicks here (not on individual tabs) because
    // setPointerCapture redirects click targets to tabsEl on desktop
    tabsEl.addEventListener('click', (e) => {
      if (didSwipe) {
        didSwipe = false;
        dragged = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = pointerDownTarget || e.target;
      pointerDownTarget = null;
      const tab = target.closest('.option-tab:not(.disabled)');
      if (!tab) return;
      const idx = parseInt(tab.dataset.tab);
      if (idx === 0) { animateTabShift(-1); return; }
      if (idx === 2) { animateTabShift(1); return; }
      showRoute(state.currentOptions[idx]);
      setActiveRouteIdx(idx);
      showDirections(state.currentOptions, fromId, toId, idx);
    }, true);
  }
}
