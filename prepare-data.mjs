import { createWriteStream, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Extract } from 'unzipper';
import path from 'path';

const GTFS_URL = 'https://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx';
const GTFS_DIR = 'gtfs_tmp';
const OUT_DIR = 'data';

// --- CSV parser (no dependencies) ---
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (values[i] || '').trim());
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// --- Haversine distance in meters ---
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Download & extract GTFS ---
async function downloadGTFS() {
  if (existsSync(GTFS_DIR)) {
    const { execSync } = await import('child_process');
    execSync(`rm -rf ${GTFS_DIR}`);
  }
  mkdirSync(GTFS_DIR, { recursive: true });

  console.log('Downloading GTFS feed...');
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);

  const zipPath = path.join(GTFS_DIR, 'gtfs.zip');
  const fileStream = createWriteStream(zipPath);
  await pipeline(res.body, fileStream);

  console.log('Extracting...');
  const { Open } = await import('unzipper');
  const zip = await Open.file(zipPath);
  await zip.extract({ path: GTFS_DIR });
  console.log('Extracted GTFS files.');
}

function readGTFSFile(name) {
  const filePath = path.join(GTFS_DIR, name);
  if (!existsSync(filePath)) {
    console.warn(`Warning: ${name} not found`);
    return [];
  }
  return parseCSV(readFileSync(filePath, 'utf-8'));
}

// --- Route colors ---
const ROUTE_COLORS = {
  'AS': '#f7941d',  // Astoria - orange
  'ER': '#00aeef',  // East River - blue
  'RW': '#e91e63',  // Rockaway - pink
  'SB': '#00a651',  // South Brooklyn - green
  'SG': '#a8518a',  // St. George - purple
  'SR': '#ffd200',  // Soundview - yellow
  'RES': '#795548', // Rockaway Express Shuttle - brown
  'RWS': '#607d8b', // Rockaway Shuttle - blue grey
  'GM': '#e53935',  // Governors Island / Lower Manhattan - red
  'CI': '#4caf50',  // Coney Island - green variant
};

async function main() {
  await downloadGTFS();

  const rawRoutes = readGTFSFile('routes.txt');
  const rawStops = readGTFSFile('stops.txt');
  const rawTrips = readGTFSFile('trips.txt');
  const rawStopTimes = readGTFSFile('stop_times.txt');
  const rawShapes = readGTFSFile('shapes.txt');

  console.log(`Parsed: ${rawRoutes.length} routes, ${rawStops.length} stops, ${rawTrips.length} trips, ${rawStopTimes.length} stop_times`);

  // Build trip -> route mapping
  const tripRoute = {};
  for (const t of rawTrips) {
    tripRoute[t.trip_id] = t.route_id;
  }

  // Find which routes have active trips
  const activeRoutes = new Set(rawTrips.map(t => t.route_id));
  console.log('Active routes:', [...activeRoutes].sort().join(', '));

  // Collect all shape_ids per route
  const routeShapeIds = {};
  for (const t of rawTrips) {
    if (t.shape_id) {
      if (!routeShapeIds[t.route_id]) routeShapeIds[t.route_id] = new Set();
      routeShapeIds[t.route_id].add(t.shape_id);
    }
  }

  // Parse shapes into polylines grouped by shape_id
  const shapesById = {};
  for (const s of rawShapes) {
    const id = s.shape_id;
    if (!shapesById[id]) shapesById[id] = [];
    shapesById[id].push({
      lat: parseFloat(s.shape_pt_lat),
      lng: parseFloat(s.shape_pt_lon),
      seq: parseInt(s.shape_pt_sequence)
    });
  }
  // Sort by sequence
  for (const id in shapesById) {
    shapesById[id].sort((a, b) => a.seq - b.seq);
  }

  // Build route info
  const routes = {};
  for (const r of rawRoutes) {
    if (!activeRoutes.has(r.route_id)) {
      console.log(`Skipping inactive route: ${r.route_id} (${r.route_long_name})`);
      continue;
    }
    // Pick the longest shape for this route (covers most of the route path)
    const shapeIds = routeShapeIds[r.route_id] || new Set();
    let shapePoints = [];
    for (const sid of shapeIds) {
      const pts = shapesById[sid] ? shapesById[sid].map(p => [p.lat, p.lng]) : [];
      if (pts.length > shapePoints.length) shapePoints = pts;
    }

    // Use GTFS color if available, fall back to our defaults
    const color = r.route_color
      ? '#' + r.route_color
      : (ROUTE_COLORS[r.route_id] || '#999999');

    routes[r.route_id] = {
      id: r.route_id,
      name: r.route_long_name || r.route_short_name || r.route_id,
      color,
      shape: shapePoints
    };
  }

  // Deduplicate stops by name — collect all stop_ids per stop_name
  const stopsByName = {};
  for (const s of rawStops) {
    const name = s.stop_name.trim();
    if (!stopsByName[name]) {
      stopsByName[name] = {
        name,
        lat: parseFloat(s.stop_lat),
        lng: parseFloat(s.stop_lon),
        ids: []
      };
    }
    stopsByName[name].ids.push(s.stop_id);
  }

  let stops = Object.values(stopsByName);
  console.log(`${stops.length} unique stops after name dedup`);

  // Figure out which routes serve each stop
  // First, build stop_id -> set of routes from stop_times
  const stopIdRoutes = {};
  for (const st of rawStopTimes) {
    const routeId = tripRoute[st.trip_id];
    if (!routeId || !routes[routeId]) continue;
    if (!stopIdRoutes[st.stop_id]) stopIdRoutes[st.stop_id] = new Set();
    stopIdRoutes[st.stop_id].add(routeId);
  }

  // Map routes to each deduplicated stop
  for (const stop of stops) {
    stop.routes = new Set();
    for (const sid of stop.ids) {
      const r = stopIdRoutes[sid];
      if (r) r.forEach(rid => stop.routes.add(rid));
    }
  }

  // Remove stops with no routes
  stops = stops.filter(s => s.routes.size > 0);
  console.log(`${stops.length} stops with active routes`);

  // Merge nearby stops (<200m) with different names
  // This connects shuttle bus stops to nearby ferry stops
  const MERGE_DISTANCE = 200; // meters - see CONFIG.STOP_MERGE_DISTANCE_M
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const d = haversine(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
        if (d < MERGE_DISTANCE) {
          console.log(`Merging "${stops[j].name}" into "${stops[i].name}" (${Math.round(d)}m apart)`);
          // Keep the first stop's name and position, merge routes and ids
          stops[j].routes.forEach(r => stops[i].routes.add(r));
          stops[i].ids.push(...stops[j].ids);
          stops.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }
  console.log(`${stops.length} stops after proximity merge`);

  // Assign canonical IDs and convert routes to arrays
  // Use a slug from the stop name so IDs are stable across data refreshes
  function toStopId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  const canonicalStops = stops.map((s) => ({
    id: toStopId(s.name),
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    routes: [...s.routes].sort(),
    originalIds: s.ids
  }));

  // Build stop_id -> canonical_id lookup
  const stopIdToCanonical = {};
  for (const cs of canonicalStops) {
    for (const oid of cs.originalIds) {
      stopIdToCanonical[oid] = cs.id;
    }
  }

  // Pre-build stop_times lookup by trip_id (avoids O(n*m) filter in loops below)
  const stopTimesByTrip = {};
  for (const st of rawStopTimes) {
    if (!stopTimesByTrip[st.trip_id]) stopTimesByTrip[st.trip_id] = [];
    stopTimesByTrip[st.trip_id].push(st);
  }

  // Build stop sequences per route from ALL trips (not just one representative)
  // Some routes have multiple trip patterns that serve different stops
  const routeStopSequences = {};
  const routeEdges = {}; // routeId -> Set of "fromId|toId" edges

  for (const t of rawTrips) {
    if (!routes[t.route_id]) continue;
    const routeId = t.route_id;
    if (!routeEdges[routeId]) routeEdges[routeId] = new Set();

    const times = (stopTimesByTrip[t.trip_id] || [])
      .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

    const seq = [];
    const seen = new Set();
    for (const st of times) {
      const cid = stopIdToCanonical[st.stop_id];
      if (cid && !seen.has(cid)) {
        seen.add(cid);
        seq.push(cid);
      }
    }

    // Record edges from consecutive stops in this trip
    for (let i = 0; i + 1 < seq.length; i++) {
      routeEdges[routeId].add(`${seq[i]}|${seq[i + 1]}`);
    }

    // Keep the longest sequence as representative for ordering
    if (!routeStopSequences[routeId] || seq.length > routeStopSequences[routeId].length) {
      routeStopSequences[routeId] = seq;
    }
  }

  // Also add any stops only found in shorter trips to the sequence
  for (const routeId in routeEdges) {
    const stopsInRoute = new Set();
    for (const edge of routeEdges[routeId]) {
      const [a, b] = edge.split('|');
      stopsInRoute.add(a);
      stopsInRoute.add(b);
    }
    const seq = routeStopSequences[routeId] || [];
    const seqSet = new Set(seq);
    for (const sid of stopsInRoute) {
      if (!seqSet.has(sid)) {
        seq.push(sid);
        seqSet.add(sid);
      }
    }
    routeStopSequences[routeId] = seq;
  }

  // Build adjacency list graph
  // Edge: { to: stopId, route: routeId }
  const graph = {};
  for (const s of canonicalStops) {
    graph[s.id] = [];
  }

  for (const [routeId, edges] of Object.entries(routeEdges)) {
    for (const edge of edges) {
      const [from, to] = edge.split('|');
      graph[from].push({ to, route: routeId });
      graph[to].push({ to: from, route: routeId });
    }
  }

  // Deduplicate edges
  for (const sid in graph) {
    const seen = new Set();
    graph[sid] = graph[sid].filter(e => {
      const key = `${e.to}|${e.route}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // --- Parse calendar & calendar_dates for service schedules ---
  const rawCalendar = readGTFSFile('calendar.txt');
  const rawCalendarDates = readGTFSFile('calendar_dates.txt');

  const services = {};
  for (const c of rawCalendar) {
    services[c.service_id] = {
      days: [
        parseInt(c.monday), parseInt(c.tuesday), parseInt(c.wednesday),
        parseInt(c.thursday), parseInt(c.friday), parseInt(c.saturday), parseInt(c.sunday)
      ],
      start: c.start_date,
      end: c.end_date,
      added: [],
      removed: []
    };
  }
  for (const cd of rawCalendarDates) {
    const svc = services[cd.service_id];
    if (!svc) {
      // Service defined only via calendar_dates
      services[cd.service_id] = { days: [0,0,0,0,0,0,0], start: cd.date, end: cd.date, added: [], removed: [] };
    }
    if (cd.exception_type === '1') {
      (services[cd.service_id].added ??= []).push(cd.date);
    } else if (cd.exception_type === '2') {
      (services[cd.service_id].removed ??= []).push(cd.date);
    }
  }
  console.log(`${Object.keys(services).length} service schedules`);

  // --- Build trip schedules with canonical stop IDs ---
  // (stopTimesByTrip already built above)

  // Build trip -> service_id mapping
  const tripService = {};
  for (const t of rawTrips) {
    tripService[t.trip_id] = t.service_id;
  }

  // Build schedules: array of trips with canonical stop times
  // Format: { tripId, serviceId, routeId, stops: [{ id, arr, dep }] }
  const schedules = [];
  for (const t of rawTrips) {
    if (!routes[t.route_id]) continue;
    const times = (stopTimesByTrip[t.trip_id] || [])
      .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

    const tripStops = [];
    const seen = new Set();
    for (const st of times) {
      const cid = stopIdToCanonical[st.stop_id];
      if (cid && !seen.has(cid)) {
        seen.add(cid);
        tripStops.push({
          id: cid,
          sequence: Number(st.stop_sequence),
          arr: st.arrival_time,
          dep: st.departure_time
        });
      }
    }
    if (tripStops.length >= 2) {
      schedules.push({
        t: t.trip_id,
        s: t.service_id,
        r: t.route_id,
        stops: tripStops
      });
    }
  }
  console.log(`${schedules.length} trip schedules exported`);

  // Clean up output (remove originalIds)
  const outputStops = canonicalStops.map(({ originalIds, ...rest }) => rest);

  // Build final output
  const output = {
    metadata: { generatedAt: new Date().toISOString(), source: GTFS_URL },
    stopAliases: stopIdToCanonical,
    stops: outputStops,
    routes: Object.values(routes),
    graph,
    routeStopSequences,
    services,
    schedules
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'ferry-data.json');
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  ${outputStops.length} stops, ${Object.keys(routes).length} routes`);

  // Verify connectivity from a hub
  const hub = outputStops.find(s => s.routes.length >= 3);
  if (hub) {
    const visited = new Set();
    const queue = [hub.id];
    visited.add(hub.id);
    while (queue.length) {
      const cur = queue.shift();
      for (const edge of graph[cur]) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    console.log(`  Connectivity from "${hub.name}": ${visited.size}/${outputStops.length} stops reachable`);
    if (visited.size < outputStops.length) {
      const unreachable = outputStops.filter(s => !visited.has(s.id));
      console.log('  Unreachable:', unreachable.map(s => s.name).join(', '));
    }
  }

  // Cleanup
  const { execSync } = await import('child_process');
  execSync(`rm -rf ${GTFS_DIR}`);
  console.log('Cleaned up temp files.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
