// Timetable routing: search actual trips, keeping arrival/transfer Pareto labels.

import { stopById, schedules } from './data.js';
import { timeToMin, serviceRunsOn, shiftDate } from './time-utils.js';
import { state } from './state.js';

/**
 * @typedef {Object} RouteLeg
 * @property {string} route
 * @property {string} tripId
 * @property {string} serviceDate
 * @property {string[]} stops
 * @property {number} depTime - Minutes relative to midnight on the search date
 * @property {number} arrTime
 * @property {number|null} waitMin
 * @property {number} rideMin
 * @property {any[]} tripStops
 * @property {string} toward
 */

let timetableCache = null;
let journeyCache = null;

function getTimetable(dateStr) {
  if (timetableCache?.source === schedules && timetableCache.dateStr === dateStr) {
    return timetableCache.boardings;
  }

  const boardings = new Map();
  // Include yesterday's after-midnight service and tomorrow's connections.
  // First boardings are restricted to the selected calendar date below.
  for (const dayOffset of [-1, 0, 1]) {
    const serviceDate = shiftDate(dateStr, dayOffset);
    for (const trip of schedules) {
      if (!serviceRunsOn(trip.s, serviceDate)) continue;
      const times = trip.stops.map(s => ({
        arr: timeToMin(s.arr) + dayOffset * 1440,
        dep: timeToMin(s.dep) + dayOffset * 1440,
      }));
      const activeTrip = { ...trip, times, serviceDate };
      for (let i = 0; i < trip.stops.length - 1; i++) {
        if (times[i].dep < 0) continue;
        const stopId = trip.stops[i].id;
        if (!boardings.has(stopId)) boardings.set(stopId, []);
        boardings.get(stopId).push({ trip: activeTrip, index: i, dep: times[i].dep });
      }
    }
  }
  for (const events of boardings.values()) events.sort((a, b) => a.dep - b.dep);
  timetableCache = { source: schedules, dateStr, boardings };
  return boardings;
}

function lowerBound(events, time) {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].dep < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// An earlier arrival with more boardings must not discard a slightly later
// arrival with fewer boardings: both may catch the same onward ferry.
function dominates(a, b) {
  return a.time <= b.time && a.boardings <= b.boardings;
}

function findJourney(boardings, fromId, toId, departure, transferTime) {
  const origin = { stop: fromId, time: departure, boardings: 0, prev: null, ride: null };
  const labels = new Map([[fromId, [origin]]]);
  const queue = [origin];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (!labels.get(current.stop).includes(current) || current.stop === toId) continue;
    const events = boardings.get(current.stop) || [];
    const ready = current.time + (current.boardings ? transferTime : 0);
    for (let e = lowerBound(events, ready); e < events.length; e++) {
      const event = events[e];
      // Each run searches one exact first departure, without time sampling.
      if (current.boardings === 0 && event.dep !== departure) break;
      const { trip, index } = event;
      // Stay aboard through every downstream stop; no transfer buffer is
      // charged for intermediate stops, even on branching route patterns.
      for (let j = index + 1; j < trip.stops.length; j++) {
        const stop = trip.stops[j].id;
        const next = {
          stop, time: trip.times[j].arr, boardings: current.boardings + 1,
          prev: current, ride: { trip, boardIdx: index, alightIdx: j },
        };
        const existing = labels.get(stop) || [];
        if (existing.some(label => dominates(label, next))) continue;
        labels.set(stop, [...existing.filter(label => !dominates(next, label)), next]);
        queue.push(next);
      }
    }
  }

  const destinations = labels.get(toId);
  if (!destinations) return null;
  let best = destinations.reduce((a, b) =>
    a.time < b.time || (a.time === b.time && a.boardings <= b.boardings) ? a : b);
  const legs = [];
  while (best.ride) {
    const { trip, boardIdx, alightIdx } = best.ride;
    const depTime = trip.times[boardIdx].dep;
    const arrTime = trip.times[alightIdx].arr;
    const tripStops = trip.stops.slice(boardIdx, alightIdx + 1);
    legs.push({
      route: trip.r,
      tripId: trip.t,
      serviceDate: trip.serviceDate,
      stops: tripStops.map(s => s.id),
      depTime, arrTime,
      waitMin: best.prev.boardings ? depTime - best.prev.time : null,
      rideMin: arrTime - depTime,
      tripStops,
      toward: stopById[trip.stops[trip.stops.length - 1].id]?.name || '',
    });
    best = best.prev;
  }
  return legs.reverse();
}

function getJourneys(fromId, toId, dateStr) {
  const transferTime = state.transferTime;
  const key = JSON.stringify([fromId, toId, dateStr, transferTime]);
  if (journeyCache?.source === schedules && journeyCache.key === key) return journeyCache.journeys;

  const boardings = getTimetable(dateStr);
  const departures = new Set((boardings.get(fromId) || [])
    .filter(e => e.dep >= 0 && e.dep < 1440).map(e => e.dep));
  const candidates = [];
  for (const departure of departures) {
    const journey = findJourney(boardings, fromId, toId, departure, transferTime);
    if (journey) candidates.push(journey);
  }

  // Remove overtaken journeys. A later departure arriving no later is always
  // preferable. This also makes Earlier/Later navigation stable in both modes.
  const journeys = [];
  let earliestArrival = Infinity;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const arrival = getArrival(candidates[i]);
    if (arrival < earliestArrival) {
      journeys.push(candidates[i]);
      earliestArrival = arrival;
    }
  }
  journeys.reverse();
  journeyCache = { source: schedules, key, journeys };
  return journeys;
}

export function getArrival(r) { return r?.at(-1)?.arrTime ?? null; }
export function getDeparture(r) { return r?.[0]?.depTime ?? null; }
export function getTotalTime(r) {
  const a = getArrival(r), d = getDeparture(r);
  return a !== null && d !== null ? a - d : null;
}
export function getMaxWait(r) {
  return Math.max(0, ...(r || []).map(l => l.waitMin ?? 0));
}
export function isComplete(r) {
  return !!r?.length && r.every(l => Number.isFinite(l.depTime) && Number.isFinite(l.arrTime));
}

/**
 * Return [earlier, best, later] from the full selected-date timetable.
 * Depart: earliest arrival leaving at/after the request (later departure on ties).
 * Arrive: latest departure arriving by the deadline.
 * A missing best option stays null; never silently violate the requested time.
 * @returns {Array<RouteLeg[]|null>}
 */
export function findOptions(fromId, toId, dateStr, startMin, mode = 'depart') {
  if (!stopById[fromId] || !stopById[toId] || fromId === toId || !Number.isFinite(startMin)) {
    return [null, null, null];
  }
  const journeys = getJourneys(fromId, toId, dateStr);
  if (mode === 'arrive') {
    let index = journeys.length - 1;
    while (index >= 0 && getArrival(journeys[index]) > startMin) index--;
    if (index < 0) return [null, null, journeys[0] || null];
    return [journeys[index - 1] || null, journeys[index], journeys[index + 1] || null];
  }
  const index = journeys.findIndex(j => getDeparture(j) >= startMin);
  if (index < 0) return [journeys.at(-1) || null, null, null];
  return [journeys[index - 1] || null, journeys[index], journeys[index + 1] || null];
}
