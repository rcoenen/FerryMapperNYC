// Screen-space lanes for shared ferry corridors. Detection uses a fixed map
// projection; lane spacing stays constant in pixels as the map zooms.
const EPS = 1e-7;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, n) => ({ x: a.x * n, y: a.y * n });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const length = a => Math.hypot(a.x, a.y);
const at = (s, t) => add(s.a, mul(s.d, t));

export function buildRouteLanes(paths, { tolerance = 16, minOverlap = 24 } = {}) {
  const segments = [];
  const byRoute = new Map();
  for (const path of paths) {
    const own = [];
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      const d = sub(b, a), len = length(d);
      if (len < EPS) continue;
      const segment = { id: path.id, a, b, d, len, overlaps: [] };
      own.push(segment);
      segments.push(segment);
    }
    byRoute.set(path.id, own);
  }
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      if (a.id === b.id || Math.abs(dot(a.d, b.d) / (a.len * b.len)) < 0.995) continue;
      const overlap = (s, other) => {
        const t0 = dot(sub(other.a, s.a), s.d) / (s.len * s.len);
        const t1 = dot(sub(other.b, s.a), s.d) / (s.len * s.len);
        const start = Math.max(0, Math.min(t0, t1));
        const end = Math.min(1, Math.max(t0, t1));
        if ((end - start) * s.len < minOverlap) return null;
        const distance = p => Math.abs(cross(sub(p, other.a), other.d)) / other.len;
        if (Math.max(distance(at(s, start)), distance(at(s, end))) > tolerance) return null;
        return { start, end, id: other.id };
      };
      const ab = overlap(a, b), ba = overlap(b, a);
      if (ab && ba) { a.overlaps.push(ab); b.overlaps.push(ba); }
    }
  }
  const model = new Map();
  for (const [id, own] of byRoute) {
    const pieces = [];
    for (const s of own) {
      const cuts = [...new Set([0, 1, ...s.overlaps.flatMap(o => [o.start, o.end])])].sort((a, b) => a - b);
      // Canonical direction makes opposite travel directions use the same lanes.
      const sign = s.d.x < 0 || (Math.abs(s.d.x) < EPS && s.d.y < 0) ? -1 : 1;
      const normal = { x: -s.d.y / s.len * sign, y: s.d.x / s.len * sign };
      for (let i = 1; i < cuts.length; i++) {
        const start = cuts[i - 1], end = cuts[i];
        if (end - start < EPS) continue;
        const mid = (start + end) / 2;
        const ids = [...new Set([id, ...s.overlaps.filter(o => mid > o.start && mid < o.end).map(o => o.id)])].sort();
        pieces.push({
          a: { ...at(s, start), pin: start === 0 && s.a.pin },
          b: { ...at(s, end), pin: end === 1 && s.b.pin },
          normal, lane: ids.indexOf(id) - (ids.length - 1) / 2,
          group: ids.join('|'),
        });
      }
    }
    model.set(id, pieces);
  }
  return model;
}

function join(a, b) {
  const center = a.b;
  if (center.pin || b.a.pin || a.group !== b.group) return center;
  const p = add(a.b, a.offset), q = add(b.a, b.offset);
  const d = sub(a.b, a.a), e = sub(b.b, b.a);
  const det = cross(d, e);
  if (Math.abs(det) < EPS) return add(center, mul(add(a.offset, b.offset), 0.5));
  const intersection = add(p, mul(d, cross(sub(q, p), e) / det));
  // Bound sharp turns rather than allowing long miter spikes.
  return length(sub(intersection, center)) <= Math.max(length(a.offset), length(b.offset)) * 2 + 1
    ? intersection : add(center, mul(add(a.offset, b.offset), 0.5));
}

export function layoutRouteLanes(model, scale, spacing = 7) {
  const result = new Map();
  for (const [id, pieces] of model) {
    const chunks = pieces.map(p => ({
      ...p, a: { ...mul(p.a, scale), pin: p.a.pin }, b: { ...mul(p.b, scale), pin: p.b.pin },
      offset: mul(p.normal, p.lane * spacing),
    }));
    const points = [];
    const push = p => {
      const last = points.at(-1);
      if (last && length(sub(last, p)) < EPS) last.pin ||= p.pin;
      else points.push(p);
    };
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const start = i ? join(chunks[i - 1], chunk) : chunk.a;
      const end = i < chunks.length - 1 ? join(chunk, chunks[i + 1]) : chunk.b;
      const d = sub(chunk.b, chunk.a), len = length(d);
      const taper = Math.min(16, len / 4) / len;
      push(start);
      // Fan lanes into landings and at corridor splits over a short distance.
      if (length(sub(start, add(chunk.a, chunk.offset))) > 0.1) push(add(add(chunk.a, mul(d, taper)), chunk.offset));
      if (length(sub(end, add(chunk.b, chunk.offset))) > 0.1) push(add(add(chunk.b, mul(d, -taper)), chunk.offset));
      push(end);
    }
    result.set(id, roundCorners(points));
  }
  return result;
}

function roundCorners(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], before = sub(points[i - 1], p), after = sub(points[i + 1], p);
    const a = length(before), b = length(after);
    if (p.pin || a < EPS || b < EPS) { result.push(p); continue; }
    const radius = Math.min(10, a / 4, b / 4);
    const start = add(p, mul(before, radius / a)), end = add(p, mul(after, radius / b));
    result.push(start);
    for (const t of [0.25, 0.5, 0.75]) {
      result.push(add(add(mul(start, (1 - t) ** 2), mul(p, 2 * (1 - t) * t)), mul(end, t ** 2)));
    }
    result.push(end);
  }
  result.push(points.at(-1));
  return result;
}
