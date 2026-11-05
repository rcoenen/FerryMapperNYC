import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTripUpdates, epochToServiceMinutes, getVehicles, getAlerts, isFeedFresh, applyServiceAlerts } from '../js/realtime-core.js';
import { loadData } from '../js/data.js';
import { findOptions, getArrival } from '../js/routing.js';
import { setRealtimeSnapshot } from '../js/realtime.js';

const DATE = '2026-11-05';
const NOW = Date.parse(DATE + 'T13:00:00Z') / 1000;
const sampleTrip = { t: 'first', r: 'R', s: 'daily', stops: [
  { id: 'A', sequence: 10, arr: '08:00:00', dep: '08:00:00' },
  { id: 'B', sequence: 20, arr: '08:10:00', dep: '08:10:00' },
  { id: 'C', sequence: 30, arr: '08:20:00', dep: '08:20:00' },
] };
const feed = (update, timestamp = NOW) => ({ status: 'ok', timestamp, entities: [{ id: '1', tripUpdate: { trip: { tripId: 'first', routeId: 'R', startDate: '20261105' }, ...update } }] });
const project = f => applyTripUpdates(sampleTrip, DATE, f, {}, NOW);

test('trip delays propagate without mutating published schedules; zero delay is live', () => {
  const before = structuredClone(sampleTrip);
  assert.deepEqual(project(feed({ delay: 300 })).times.map(t => t.dep), [485, 495, 505]);
  const onTime = project(feed({ delay: 0 }));
  assert.equal(onTime.times[0].realtimeDeparture, true);
  assert.equal(onTime.times[0].dep, 480);
  assert.deepEqual(sampleTrip, before);
});

test('absolute predictions and original stop aliases match the correct canonical stops', () => {
  const f = feed({ stopTimeUpdate: [{ stopId: 'raw-B', arrival: { time: NOW + 900 }, departure: { time: NOW + 960 } }] });
  const result = applyTripUpdates(sampleTrip, DATE, f, { 'raw-B': 'B' }, NOW);
  assert.deepEqual(result.times.map(t => [t.arr, t.dep]), [[480, 480], [495, 496], [506, 506]]);
  assert.equal(result.times[0].realtimeDeparture, false);
  assert.equal(result.times[2].realtimeArrival, true);
});

test('stop sequence takes priority, NO_DATA stops propagation, and SKIPPED cannot be boarded', () => {
  const f = feed({ delay: 300, stopTimeUpdate: [
    { stopSequence: 20, stopId: 'A', scheduleRelationship: 'SKIPPED' },
    { stopSequence: 30, scheduleRelationship: 'NO_DATA' },
  ] });
  const result = project(f);
  assert.deepEqual(result.stops.map(s => s.id), ['A', 'C']);
  assert.equal(result.times[0].dep, 485);
  assert.equal(result.times[1].dep, 500);
  assert.equal(result.times[1].realtimeDeparture, false);
});

test('cancellations are date-specific and stale reports never change the timetable', () => {
  const cancelled = feed({ trip: { tripId: 'first', routeId: 'R', startDate: '20261105', scheduleRelationship: 'CANCELED' } });
  assert.equal(project(cancelled), null);
  assert.equal(applyTripUpdates(sampleTrip, '2026-11-06', cancelled, {}, NOW).times[0].dep, 480);
  assert.equal(project({ ...cancelled, timestamp: NOW - 91 }).times[0].dep, 480);
  assert.equal(project(feed({ delay: 300, timestamp: NOW - 91 })).times[0].dep, 480);
  assert.equal(project(feed({ delay: 300 }, NOW + 60)).times[0].dep, 480);
});

test('invalid prediction chronology falls back safely and overnight epochs keep their service day', () => {
  const result = project(feed({ stopTimeUpdate: [{ stopSequence: 20, arrival: { time: NOW - 600 } }] }));
  assert.equal(result.times[1].arr, 490);
  assert.equal(result.times[1].realtimeArrival, false);
  assert.equal(epochToServiceMinutes(Date.parse('2026-11-06T05:15:00Z') / 1000, DATE), 1455);
  assert.equal(epochToServiceMinutes(Date.parse('2026-07-02T04:15:00Z') / 1000, '2026-07-01'), 1455);
});

test('vessel positions expire independently and unknown routes/invalid GPS are excluded', () => {
  const vehicles = { status: 'ok', timestamp: NOW, entities: [
    { id: 'good', vehicle: { trip: { tripId: 'first' }, timestamp: NOW - 20, position: { latitude: 40.7, longitude: -74 } } },
    { id: 'old', vehicle: { trip: { routeId: 'R' }, timestamp: NOW - 100, position: { latitude: 40.7, longitude: -74 } } },
    { id: 'bad', vehicle: { trip: { routeId: 'R' }, position: { latitude: 0, longitude: 0 } } },
    { id: 'unknown', vehicle: { trip: { routeId: 'BUS' }, position: { latitude: 40.7, longitude: -74 } } },
  ] };
  assert.deepEqual(getVehicles(vehicles, { first: sampleTrip }, { R: {} }, NOW).map(v => v.id), ['good']);
  assert.equal(getVehicles({ ...vehicles, timestamp: NOW - 91 }, {}, { R: {} }, NOW).length, 0);
  assert.equal(isFeedFresh({ status: 'ok', timestamp: NOW, entities: [] }, 'vehicles', NOW), true);
});

test('service alerts respect active periods, route scope, and English translations', () => {
  const alert = (id, route, start, end) => ({ id, alert: {
    activePeriod: [{ start, end }], informedEntity: route ? [{ routeId: route }] : [],
    headerText: { translation: [{ language: 'es', text: 'Aviso' }, { language: 'en', text: 'Pier closure' }] },
  } });
  const alerts = { status: 'ok', timestamp: NOW, entities: [alert('active', 'R', NOW - 10, NOW + 10), alert('other', 'X', NOW - 10, NOW + 10), alert('expired', 'R', NOW - 20, NOW - 1), alert('global', null, NOW - 10, NOW + 10)] };
  assert.deepEqual(getAlerts(alerts, ['R'], NOW).map(a => [a.id, a.title]), [['active', 'Pier closure'], ['global', 'Pier closure']]);
});

test('live delay can invalidate a connection, cancellations reroute, and expired data restores schedules', async () => {
  globalThis.window = {};
  const later = { t: 'later', r: 'Y', s: 'daily', stops: [{ id: 'B', sequence: 1, arr: '08:30:00', dep: '08:30:00' }, { id: 'D', sequence: 2, arr: '08:40:00', dep: '08:40:00' }] };
  const connect = { t: 'connect', r: 'Y', s: 'daily', stops: [{ id: 'B', sequence: 1, arr: '08:15:00', dep: '08:15:00' }, { id: 'D', sequence: 2, arr: '08:25:00', dep: '08:25:00' }] };
  const direct = { t: 'direct', r: 'Z', s: 'daily', stops: [{ id: 'A', sequence: 1, arr: '08:01:00', dep: '08:01:00' }, { id: 'D', sequence: 2, arr: '08:50:00', dep: '08:50:00' }] };
  const first = { ...sampleTrip, stops: sampleTrip.stops.slice(0, 2) };
  const data = { stops: ['A', 'B', 'D'].map(id => ({ id, name: id, routes: ['R', 'Y', 'Z'] })), routes: ['R', 'Y', 'Z'].map(id => ({ id })), graph: {}, routeStopSequences: {}, schedules: [first, connect, later, direct], services: { daily: { days: [1,1,1,1,1,1,1], start: '20260101', end: '20271231' } } };
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  globalThis.fetch = async () => ({ json: async () => structuredClone(data) });
  Date.now = () => NOW * 1000;
  try {
    await loadData();
    setRealtimeSnapshot({ feeds: {}, status: 'ok' });
    assert.equal(getArrival(findOptions('A', 'D', DATE, 480)[1]), 505);
    setRealtimeSnapshot({ feeds: { tripUpdates: feed({ delay: 300 }) }, status: 'ok' });
    const delayed = findOptions('A', 'D', DATE, 480)[1];
    assert.equal(getArrival(delayed), 520);
    assert.equal(delayed[0].realtime, true);
    assert.equal(delayed[0].delayMin, 5);
    setRealtimeSnapshot({ feeds: { tripUpdates: feed({ trip: { tripId: 'first', startDate: '20261105', scheduleRelationship: 'CANCELED' } }) }, status: 'ok' });
    assert.equal(findOptions('A', 'D', DATE, 480)[1][0].tripId, 'direct');
    Date.now = () => (NOW + 100) * 1000;
    assert.equal(getArrival(findOptions('A', 'D', DATE, 480)[1]), 505);
    Date.now = () => NOW * 1000;
    setRealtimeSnapshot({ feeds: { tripUpdates: feed({ delay: 300, timestamp: NOW - 89 }) }, status: 'ok' });
    assert.equal(getArrival(findOptions('A', 'D', DATE, 480)[1]), 520);
    Date.now = () => (NOW + 2) * 1000;
    assert.equal(getArrival(findOptions('A', 'D', DATE, 480)[1]), 505, 'individual trip reports expire even while the feed header is fresh');
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    setRealtimeSnapshot({ feeds: {}, status: 'loading' });
  }
});


test('stop-specific alert selectors use canonical aliases and combine route and stop scope', () => {
  const notice = { status: 'ok', timestamp: NOW, entities: [{ id: 'stop', alert: {
    informedEntity: [{ routeId: 'R', stopId: 'raw-B' }],
    headerText: { translation: [{ text: 'Landing closed' }] },
  } }] };
  assert.equal(getAlerts(notice, ['R'], NOW, ['B'], { 'raw-B': 'B' }).length, 1);
  assert.equal(getAlerts(notice, ['R'], NOW, ['A'], { 'raw-B': 'B' }).length, 0);
  assert.equal(getAlerts(notice, ['X'], NOW, ['B'], { 'raw-B': 'B' }).length, 0);
});


test('structured service suspensions exclude matching routes/stops only during the reported period', () => {
  const base = applyTripUpdates(sampleTrip, DATE, null, {}, NOW);
  const closure = { status: 'ok', timestamp: NOW, entities: [{ id: 'closure', alert: {
    effect: 'NO_SERVICE', informedEntity: [{ routeId: 'R' }], activePeriod: [{ start: NOW, end: NOW + 3600 }],
  } }] };
  assert.equal(applyServiceAlerts(base, DATE, closure, {}, NOW), null);
  const other = { ...base, r: 'X' };
  assert.equal(applyServiceAlerts(other, DATE, closure, {}, NOW), other);
  assert.ok(applyServiceAlerts(base, '2026-11-06', closure, {}, NOW));
  assert.ok(applyServiceAlerts(base, DATE, { ...closure, timestamp: NOW - 601 }, {}, NOW));
  const stopClosure = structuredClone(closure);
  stopClosure.entities[0].alert.informedEntity = [{ routeId: 'R', stopId: 'raw-B' }];
  assert.deepEqual(applyServiceAlerts(base, DATE, stopClosure, { 'raw-B': 'B' }, NOW).stops.map(s => s.id), ['A', 'C']);
  stopClosure.entities[0].alert.effect = 'REDUCED_SERVICE';
  assert.equal(applyServiceAlerts(base, DATE, stopClosure, {}, NOW), base);
});
