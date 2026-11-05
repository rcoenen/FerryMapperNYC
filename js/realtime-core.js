// GTFS-Realtime rules shared by the planner, map, and tests. Never mutate GTFS.
import { timeToMin } from './time-utils.js';

export const FEED_MAX_AGE = { vehicles: 90, tripUpdates: 90, alerts: 600 };
const nyTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function partsAt(epoch) {
  return Object.fromEntries(nyTime.formatToParts(new Date(epoch * 1000)).map(p => [p.type, p.value]));
}
export function epochToServiceMinutes(epoch, serviceDate) {
  const p = partsAt(epoch);
  const day = Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  return (day - Date.parse(serviceDate + 'T00:00:00Z')) / 86400000 * 1440 + Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
}
export function isFeedFresh(feed, kind, now = Date.now() / 1000) {
  return feed?.status === 'ok' && Number.isFinite(feed.timestamp) &&
    feed.timestamp <= now + 30 && now - feed.timestamp <= FEED_MAX_AGE[kind];
}
function scheduled(trip) {
  return { ...trip, times: trip.stops.map(s => ({ arr: timeToMin(s.arr), dep: timeToMin(s.dep), realtimeArrival: false, realtimeDeparture: false })) };
}
function eventTime(event, scheduledTime, delay, serviceDate) {
  if (Number.isFinite(event?.time)) {
    const time = epochToServiceMinutes(event.time, serviceDate);
    return { time, delay: time - scheduledTime, live: true };
  }
  if (Number.isFinite(event?.delay)) delay = event.delay / 60;
  return { time: scheduledTime + (delay ?? 0), delay, live: delay !== null };
}

export function applyTripUpdates(trip, serviceDate, feed, stopAliases = {}, now = Date.now() / 1000) {
  if (!isFeedFresh(feed, 'tripUpdates', now)) return scheduled(trip);
  const today = partsAt(now);
  const currentDate = `${today.year}${today.month}${today.day}`;
  const date = serviceDate.replaceAll('-', '');
  const entity = (feed.entities || []).find(e => {
    const t = e.tripUpdate?.trip;
    const timestamp = e.tripUpdate?.timestamp ?? feed.timestamp;
    return !e.isDeleted && t?.tripId === trip.t && (!t.routeId || t.routeId === trip.r) &&
      (t.startDate ? t.startDate === date : date === currentDate) && timestamp <= now + 30 && now - timestamp <= 90;
  });
  if (!entity) return scheduled(trip);
  const update = entity.tripUpdate;
  if (['CANCELED', 'DELETED'].includes(update.trip.scheduleRelationship)) return null;
  if (update.trip.scheduleRelationship && update.trip.scheduleRelationship !== 'SCHEDULED') return scheduled(trip);
  let delay = Number.isFinite(update.delay) ? update.delay / 60 : null;
  const stops = [], times = [];
  for (const stop of trip.stops) {
    let prediction = (update.stopTimeUpdate || []).find(s =>
      s.stopSequence !== undefined && stop.sequence !== undefined
        ? s.stopSequence === stop.sequence
        : !!s.stopId && (stopAliases[s.stopId] || s.stopId) === stop.id);
    if (prediction?.scheduleRelationship === 'SKIPPED') continue;
    if (prediction?.scheduleRelationship === 'NO_DATA') { delay = null; prediction = null; }
    const arr = eventTime(prediction?.arrival, timeToMin(stop.arr), delay, serviceDate);
    const dep = eventTime(prediction?.departure, timeToMin(stop.dep), arr.delay, serviceDate);
    delay = dep.delay;
    stops.push(stop);
    times.push({ arr: arr.time, dep: dep.time, realtimeArrival: arr.live, realtimeDeparture: dep.live });
  }
  // Bad/partial predictions must never create a time-travelling itinerary.
  if (times.some((t, i) => t.dep < t.arr || (i > 0 && t.arr < times[i - 1].dep))) {
    return scheduled({ ...trip, stops });
  }
  return { ...trip, stops, times };
}

export function getVehicles(feed, tripsById, routes, now = Date.now() / 1000) {
  if (!isFeedFresh(feed, 'vehicles', now)) return [];
  return (feed.entities || []).flatMap(entity => {
    const v = entity.vehicle, p = v?.position;
    const timestamp = v?.timestamp ?? feed.timestamp;
    const routeId = v?.trip?.routeId || tripsById[v?.trip?.tripId]?.r;
    if (entity.isDeleted || !routes[routeId] || !p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) ||
        p.latitude < 40 || p.latitude > 42 || p.longitude < -75 || p.longitude > -72 ||
        !Number.isFinite(timestamp) || now - timestamp > 90 || timestamp > now + 30) return [];
    return [{ id: v.vehicle?.id || entity.id, label: v.vehicle?.label || 'NYC Ferry', routeId,
      tripId: v.trip?.tripId || '', lat: p.latitude, lng: p.longitude, bearing: p.bearing, timestamp }];
  });
}
const translated = value => value?.translation?.find(t => !t.language || t.language.startsWith('en'))?.text || value?.translation?.[0]?.text || '';
export function getAlerts(feed, routeIds = [], now = Date.now() / 1000, stopIds = [], aliases = {}) {
  if (!isFeedFresh(feed, 'alerts', now)) return [];
  return (feed.entities || []).flatMap(entity => {
    const a = entity.alert;
    if (entity.isDeleted || !a) return [];
    if (a.activePeriod?.length && !a.activePeriod.some(p => (!p.start || now >= p.start) && (!p.end || now < p.end))) return [];
    const affectedRoutes = [...new Set((a.informedEntity || []).map(e => e.routeId || e.trip?.routeId).filter(Boolean))];
    const matches = !a.informedEntity?.length || a.informedEntity.some(e => {
      const route = e.routeId || e.trip?.routeId;
      const stop = aliases[e.stopId] || e.stopId;
      return (!routeIds.length || !route || routeIds.includes(route)) && (!stopIds.length || !stop || stopIds.includes(stop));
    });
    if (!matches) return [];
    return [{ id: entity.id, title: translated(a.headerText) || 'Service notice', description: translated(a.descriptionText), routes: affectedRoutes }];
  });
}

// Only explicit NO_SERVICE effects change routing. Free-text notices remain warnings.
export function applyServiceAlerts(trip, serviceDate, feed, aliases = {}, now = Date.now() / 1000) {
  if (!trip || !isFeedFresh(feed, 'alerts', now)) return trip;
  const skipped = new Set();
  for (const entity of feed.entities || []) {
    const alert = entity.alert;
    if (entity.isDeleted || alert?.effect !== 'NO_SERVICE') continue;
    const during = (start, end) => !alert.activePeriod?.length || alert.activePeriod.some(period => {
      const lo = period.start ? epochToServiceMinutes(period.start, serviceDate) : -Infinity;
      const hi = period.end ? epochToServiceMinutes(period.end, serviceDate) : Infinity;
      return end >= lo && start < hi;
    });
    for (const selector of alert.informedEntity || []) {
      const descriptor = selector.trip;
      const routeId = selector.routeId || descriptor?.routeId;
      if ((routeId && routeId !== trip.r) ||
          (descriptor?.tripId && descriptor.tripId !== trip.t) ||
          (descriptor?.startDate && descriptor.startDate !== serviceDate.replaceAll('-', ''))) continue;
      if (selector.stopId) {
        const id = aliases[selector.stopId] || selector.stopId;
        trip.stops.forEach((stop, i) => {
          if (stop.id === id && during(trip.times[i].arr, trip.times[i].dep)) skipped.add(i);
        });
      } else if ((routeId || descriptor?.tripId || selector.agencyId) && trip.times.length &&
          during(trip.times[0].dep, trip.times.at(-1).arr)) return null;
    }
  }
  return skipped.size ? { ...trip, stops: trip.stops.filter((_, i) => !skipped.has(i)), times: trip.times.filter((_, i) => !skipped.has(i)) } : trip;
}
