// Time parsing, formatting, and GTFS schedule helpers

import { state } from './state.js';
import { services, schedulesByRoute } from './data.js';

export function timeToMin(t) {
  const [h, m, seconds = 0] = t.split(':').map(Number);
  return h * 60 + m + seconds / 60;
}

export function formatTime(mins) {
  const wholeMins = Math.floor(mins);
  const dayOffset = Math.floor(wholeMins / 1440);
  const suffix = dayOffset > 0 ? ` (+${dayOffset} day${dayOffset === 1 ? '' : 's'})` : '';
  const h = Math.floor(wholeMins / 60) % 24;
  const m = wholeMins % 60;
  if (state.use12h) {
    const period = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}${suffix}`;
  }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + suffix;
}

export function formatDuration(mins) {
  if (mins < 1) return 'less than a minute';
  const rounded = Math.round(mins);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return m + ' min';
  if (m === 0) return h + ' hr';
  return h + ' hr ' + m + ' min';
}

export function serviceRunsOn(serviceId, dateStr) {
  const svc = services[serviceId];
  if (!svc) return false;
  const ds = dateStr.replace(/-/g, '');
  if (svc.removed && svc.removed.includes(ds)) return false;
  if (svc.added && svc.added.includes(ds)) return true;
  if (ds < svc.start || ds > svc.end) return false;
  // Date-only strings parse as UTC; use UTC consistently so the browser's
  // timezone cannot turn a Monday into Sunday.
  const d = new Date(dateStr + 'T00:00:00Z');
  const jsDay = d.getUTCDay();
  const gtfsIdx = jsDay === 0 ? 6 : jsDay - 1;
  return svc.days[gtfsIdx] === 1;
}

export function getTripsForRoute(routeId, dateStr) {
  return (schedulesByRoute[routeId] || []).filter(t => serviceRunsOn(t.s, dateStr));
}

// Calendar arithmetic stays stable across DST changes and browser timezones.
export function shiftDate(dateStr, days) {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Ferry times are always New York local time, including for remote visitors.
export function getNYCDateTime(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
