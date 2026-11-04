import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadData, schedules, stops } from '../js/data.js';
import { state } from '../js/state.js';
import { findOptions, getArrival, getDeparture, isComplete } from '../js/routing.js';
import { serviceRunsOn, timeToMin, formatTime, formatDuration, shiftDate, getNYCDateTime } from '../js/time-utils.js';

// Run with a timezone west of UTC to catch date-only weekday regressions.
process.env.TZ = 'America/New_York';
globalThis.window = {};
const DATE = '2026-11-02'; // Monday, just after the DST change.
const daily = { days: [1, 1, 1, 1, 1, 1, 1], start: '20260101', end: '20271231' };

function trip(t, r, times, s = 'daily') {
  return { t, r, s, stops: times.map(([id, time]) => ({ id, arr: time, dep: time })) };
}

async function fixture(trips, services = { daily }) {
  const ids = [...new Set(trips.flatMap(t => t.stops.map(s => s.id)))];
  const routes = [...new Set(trips.map(t => t.r))].map(id => ({ id }));
  const data = {
    stops: ids.map(id => ({ id, name: id, routes: routes.map(r => r.id) })),
    routes, schedules: trips, services, graph: {}, routeStopSequences: {},
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => structuredClone(data) });
  try { await loadData(); } finally { globalThis.fetch = originalFetch; }
  state.transferTime = 5;
}

const search = (time = 480, mode = 'depart', date = DATE) => findOptions('A', 'D', date, time, mode);

test('later express overtakes the local and displays only its actual stops', async () => {
  await fixture([
    trip('local', 'R', [['A', '08:00:00'], ['B', '08:30:00'], ['D', '09:00:00']]),
    trip('express', 'R', [['A', '08:10:00'], ['D', '08:35:00']]),
  ]);
  const best = search()[1];
  assert.equal(best[0].tripId, 'express');
  assert.deepEqual(best[0].stops, ['A', 'D']);
  assert.equal(best[0].rideMin, 25);
});

test('a faster connection beats an available direct route', async () => {
  await fixture([
    trip('direct', 'R', [['A', '08:00:00'], ['D', '10:00:00']]),
    trip('first', 'X', [['A', '08:05:00'], ['B', '08:20:00']]),
    trip('second', 'Y', [['B', '08:25:00'], ['D', '08:40:00']]),
  ]);
  assert.deepEqual(search()[1].map(l => l.tripId), ['first', 'second']);
  state.transferTime = 6;
  assert.equal(search()[1][0].tripId, 'direct', 'changing transfer preference invalidates cached journeys');
});

test('changing ferries on the same route needs a transfer; staying aboard does not', async () => {
  await fixture([
    trip('first', 'R', [['A', '08:00:00'], ['B', '08:10:00']]),
    trip('too-soon', 'R', [['B', '08:14:00'], ['D', '08:25:00']]),
    trip('valid', 'R', [['B', '08:15:00'], ['D', '08:30:00']]),
  ]);
  assert.deepEqual(search()[1].map(l => l.tripId), ['first', 'valid']);
  assert.equal(search()[1][1].waitMin, 5);
  await fixture([trip('through', 'R', [['A', '08:00:00'], ['B', '08:10:00'], ['D', '08:20:00']])]);
  state.transferTime = 60;
  assert.equal(search()[1].length, 1);
  assert.equal(getArrival(search()[1]), 500);
});

test('retains later intermediate arrivals with fewer transfers for equal final arrivals', async () => {
  await fixture([
    trip('short-1', 'X', [['A', '08:00:00'], ['B', '08:05:00']]),
    trip('short-2', 'Y', [['B', '08:10:00'], ['C', '08:15:00']]),
    trip('through', 'R', [['A', '08:00:00'], ['C', '08:20:00']]),
    trip('last', 'Z', [['C', '08:25:00'], ['D', '08:40:00']]),
  ]);
  assert.deepEqual(search()[1].map(l => l.tripId), ['through', 'last']);
});

test('uses exact departure events and Earlier/Later selections remain stable in both modes', async () => {
  await fixture([
    trip('one', 'R', [['A', '08:01:00'], ['D', '08:11:00']]),
    trip('two', 'R', [['A', '08:02:00'], ['D', '08:12:00']]),
    trip('three', 'R', [['A', '08:03:00'], ['D', '08:13:00']]),
  ]);
  assert.equal(search(482)[1][0].tripId, 'two');
  for (const mode of ['depart', 'arrive']) {
    const options = search(mode === 'depart' ? 482 : 492, mode);
    assert.deepEqual(options.map(o => o[0].tripId), ['one', 'two', 'three']);
    for (const adjacent of [options[0], options[2]]) {
      const ref = mode === 'depart' ? getDeparture(adjacent) : getArrival(adjacent);
      assert.deepEqual(search(ref, mode)[1], adjacent);
    }
  }
});

test('arrive by finds the latest departure, including trips beyond the old search window', async () => {
  await fixture([
    trip('long', 'R', [['A', '00:01:00'], ['D', '08:00:00']]),
    trip('express', 'R', [['A', '07:45:00'], ['D', '08:00:00']]),
    trip('late', 'R', [['A', '07:50:00'], ['D', '08:05:00']]),
  ]);
  assert.equal(search(480, 'arrive')[1][0].tripId, 'express');
  await fixture([trip('long', 'R', [['A', '00:01:00'], ['D', '08:00:00']])]);
  assert.equal(search(480, 'arrive')[1][0].tripId, 'long');
});

test('missing requested options stay empty rather than silently violating the time', async () => {
  await fixture([trip('only', 'R', [['A', '08:00:00'], ['D', '08:30:00']])]);
  assert.deepEqual(search(481).map(o => o?.[0]?.tripId ?? null), ['only', null, null]);
  assert.deepEqual(search(509, 'arrive').map(o => o?.[0]?.tripId ?? null), [null, null, 'only']);
  assert.deepEqual(findOptions('missing', 'D', DATE, 480), [null, null, null]);
  assert.deepEqual(findOptions('A', 'A', DATE, 480), [null, null, null]);
  assert.equal(isComplete(null), false);
  assert.equal(isComplete([]), false);
});

test('Now uses New York date and time across UTC midnight and DST', () => {
  assert.deepEqual(getNYCDateTime(new Date('2026-11-03T01:30:00Z')), { date: '2026-11-02', time: '20:30' });
  assert.deepEqual(getNYCDateTime(new Date('2026-07-02T01:30:00Z')), { date: '2026-07-01', time: '21:30' });
  assert.deepEqual(getNYCDateTime(new Date('2026-11-02T05:00:00Z')), { date: '2026-11-02', time: '00:00' });
  assert.equal(formatDuration(119.5), '2 hr');
});

test('weekday, weekend, date ranges, and calendar exceptions are timezone independent', async () => {
  await fixture([trip('weekday', 'R', [['A', '08:00:00'], ['D', '08:30:00']], 'weekday')], {
    weekday: { ...daily, days: [1, 1, 1, 1, 1, 0, 0], removed: ['20261103'], added: ['20261107', '20280101'] },
    weekend: { ...daily, days: [0, 0, 0, 0, 0, 1, 1] },
  });
  assert.equal(serviceRunsOn('weekday', DATE), true);
  assert.equal(serviceRunsOn('weekend', DATE), false);
  assert.equal(serviceRunsOn('weekday', '2026-11-03'), false);
  assert.equal(serviceRunsOn('weekday', '2026-11-07'), true);
  assert.equal(serviceRunsOn('weekday', '2028-01-01'), true);
  assert.equal(serviceRunsOn('weekday', '2028-01-03'), false);
  assert.equal(search()[1][0].tripId, 'weekday');
  assert.deepEqual(search(480, 'depart', '2026-11-03'), [null, null, null]);
  assert.equal(shiftDate('2026-11-01', 1), DATE);
});

test('includes yesterday\'s GTFS times after midnight and next-day transfers', async () => {
  await fixture([
    trip('overnight', 'R', [['A', '24:10:00'], ['D', '24:30:00']], 'sunday'),
  ], { sunday: { ...daily, days: [0, 0, 0, 0, 0, 0, 1] } });
  assert.equal(search(5)[1][0].serviceDate, '2026-11-01');
  assert.equal(getDeparture(search(5)[1]), 10);
  assert.equal(getArrival(search(5)[1]), 30);
  await fixture([
    trip('night', 'X', [['A', '23:50:00'], ['B', '24:05:00']], 'monday'),
    trip('morning', 'Y', [['B', '00:10:00'], ['D', '00:25:00']], 'tuesday'),
  ], {
    monday: { ...daily, days: [1, 0, 0, 0, 0, 0, 0] },
    tuesday: { ...daily, days: [0, 1, 0, 0, 0, 0, 0] },
  });
  const best = search(1420)[1];
  assert.equal(getArrival(best), 1465);
  assert.equal(best[1].serviceDate, '2026-11-03');
  assert.equal(best[1].waitMin, 5);
  state.use12h = false;
  assert.equal(formatTime(1465), '00:25 (+1 day)');
  state.use12h = true;
  assert.equal(formatTime(1465), '12:25 AM (+1 day)');
  state.use12h = false;
});

test('preserves seconds when checking transfer feasibility', async () => {
  await fixture([
    trip('first', 'X', [['A', '08:00:00'], ['B', '08:10:30']]),
    trip('missed', 'Y', [['B', '08:15:00'], ['D', '08:25:00']]),
    trip('valid', 'Y', [['B', '08:16:00'], ['D', '08:30:00']]),
  ]);
  assert.equal(timeToMin('24:10:30'), 1450.5);
  assert.equal(search()[1][1].tripId, 'valid');
});

// Independent full-trip relaxation oracle: no route templates, Pareto pruning,
// departure profiles, or planner internals. Checks actual-feed earliest arrivals.
function earliestArrival(from, to, date, start) {
  const arrivals = new Map([[from, start]]);
  const trips = schedules.filter(t => serviceRunsOn(t.s, date));
  for (let round = 0; round < stops.length; round++) {
    let changed = false;
    for (const t of trips) {
      let aboard = false;
      for (const stop of t.stops) {
        const arr = timeToMin(stop.arr);
        if (aboard && arr < (arrivals.get(stop.id) ?? Infinity)) {
          arrivals.set(stop.id, arr);
          changed = true;
        }
        const ready = stop.id === from ? start : (arrivals.get(stop.id) ?? Infinity) + state.transferTime;
        if (timeToMin(stop.dep) >= ready) aboard = true;
      }
    }
    if (!changed) break;
  }
  return arrivals.get(to) ?? null;
}

test('real feed matches independent earliest-arrival searches and every leg is boardable', async () => {
  const raw = JSON.parse(await readFile(new URL('../data/ferry-data.json', import.meta.url), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => structuredClone(raw) });
  try { await loadData(); } finally { globalThis.fetch = originalFetch; }
  state.transferTime = 5;
  const pairs = [
    ['soundview', 'st-george'], ['bay-ridge', 'astoria'],
    ['wall-st-pier-11', 'east-34th-street'], ['red-hook-atlantic-basin', 'ferry-point-park'],
    ['hunters-point-south', 'beach-channel-dr-beach-108th-street'],
  ];
  for (const date of ['2026-11-02', '2026-11-07']) {
    for (const [from, to] of pairs) {
      assert.ok(stops.some(s => s.id === from) && stops.some(s => s.id === to), 'Real-feed fixture stops must exist');
      for (const start of [420, 720, 1080]) {
        const best = findOptions(from, to, date, start, 'depart')[1];
        assert.equal(getArrival(best), earliestArrival(from, to, date, start), `${from} → ${to}, ${date}, ${start}`);
        if (!best) continue;
        assert.ok(getDeparture(best) >= start);
        for (let i = 0; i < best.length; i++) {
          const leg = best[i];
          const source = schedules.find(t => t.t === leg.tripId);
          assert.ok(serviceRunsOn(source.s, leg.serviceDate));
          assert.equal(source.r, leg.route);
          assert.deepEqual(leg.stops, leg.tripStops.map(s => s.id));
          if (i > 0) {
            assert.equal(best[i - 1].stops.at(-1), leg.stops[0]);
            assert.ok(leg.depTime >= best[i - 1].arrTime + state.transferTime);
          }
        }
      }
    }
  }
});
