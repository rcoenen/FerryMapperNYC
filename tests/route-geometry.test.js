import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteLanes, layoutRouteLanes } from '../js/route-geometry.js';

const point = (x, y, pin = false) => ({ x, y, pin });
const route = (id, points) => ({ id, points });
const model = paths => buildRouteLanes(paths, { tolerance: 2, minOverlap: 5 });
function yAt(points, x) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && a.x !== b.x) {
      return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    }
  }
  throw new Error(`No segment crosses x=${x}`);
}

test('shared routes have separate, deterministic seven-pixel lanes', () => {
  const paths = [route('pink', [point(0, 0), point(100, 0)]), route('purple', [point(0, 0), point(100, 0)])];
  const lanes = layoutRouteLanes(model(paths), 1);
  assert.equal(Math.abs(yAt(lanes.get('pink'), 50) - yAt(lanes.get('purple'), 50)), 7);
  assert.deepEqual(layoutRouteLanes(model(paths.toReversed()), 1), new Map([...lanes].toReversed()));
});

test('opposite travel directions keep the same lane ordering', () => {
  const paths = [route('A', [point(0, 0), point(100, 0)]), route('B', [point(100, 0), point(0, 0)])];
  const lanes = layoutRouteLanes(model(paths), 1);
  assert.equal(yAt(lanes.get('A'), 50), -3.5);
  assert.equal(yAt(lanes.get('B'), 50), 3.5);
});

test('a short shared section is detected inside a longer segment', () => {
  const paths = [route('A', [point(0, 0), point(300, 0)]), route('B', [point(100, 0), point(200, 0)])];
  const lanes = layoutRouteLanes(model(paths), 1);
  assert.equal(yAt(lanes.get('A'), 40), 0);
  assert.equal(yAt(lanes.get('A'), 150), -3.5);
  assert.equal(yAt(lanes.get('B'), 150), 3.5);
  assert.equal(yAt(lanes.get('A'), 260), 0);
});

test('crossings and unrelated nearby channels are not treated as shared corridors', () => {
  const paths = [
    route('A', [point(0, 0), point(100, 0)]),
    route('B', [point(50, -50), point(50, 50)]),
    route('C', [point(0, 10), point(100, 10)]),
  ];
  const lanes = layoutRouteLanes(model(paths), 1);
  assert.equal(yAt(lanes.get('A'), 50), 0);
  assert.equal(yAt(lanes.get('C'), 50), 10);
  assert.ok(lanes.get('B').every(p => p.x === 50));
});

test('spacing is constant on zoom and pinned landings remain exact', () => {
  const points = [point(0, 0), point(100, 0, true), point(200, 0)];
  const geometry = model([route('A', points), route('B', points)]);
  for (const scale of [0.5, 1, 4]) {
    const lanes = layoutRouteLanes(geometry, scale);
    assert.equal(Math.abs(yAt(lanes.get('A'), 50 * scale) - yAt(lanes.get('B'), 50 * scale)), 7);
    for (const path of lanes.values()) {
      assert.ok(path.some(p => p.x === 100 * scale && p.y === 0 && p.pin));
      assert.deepEqual([path[0].x, path[0].y], [0, 0]);
      assert.deepEqual([path.at(-1).x, path.at(-1).y], [200 * scale, 0]);
    }
  }
});

test('multiple overlapping segments of one route do not create extra lanes', () => {
  const lanes = layoutRouteLanes(model([
    route('A', [point(0, 0), point(100, 0)]),
    route('B', [point(0, 0), point(100, 0), point(0, 0)]),
    route('C', [point(0, 0), point(100, 0)]),
  ]), 1);
  assert.equal(yAt(lanes.get('A'), 50), -7);
  assert.equal(yAt(lanes.get('B'), 50), 0);
  assert.equal(yAt(lanes.get('C'), 50), 7);
});

test('sharp bends and repeated points produce finite coordinates without spikes', () => {
  const points = [point(0, 0), point(100, 0), point(100, 0), point(1, 1), point(200, 100)];
  const lanes = layoutRouteLanes(model([route('A', points), route('B', points)]), 1);
  for (const path of lanes.values()) {
    assert.ok(path.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.ok(path.every(p => p.x > -15 && p.x < 215 && p.y > -15 && p.y < 115));
  }
});
