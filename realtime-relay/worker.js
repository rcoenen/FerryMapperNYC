import bindings from 'gtfs-realtime-bindings';

const FeedMessage = bindings.transit_realtime.FeedMessage;
const ROOT = 'https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/';
const SOURCES = { vehicles: 'vehicleposition', tripUpdates: 'tripupdate', alerts: 'alert' };
const MAX_BYTES = 2 * 1024 * 1024;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

async function readBounded(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Feed too large');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error('Feed too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function fetchFeed(kind, fetcher = fetch) {
  try {
    const response = await fetcher(ROOT + SOURCES[kind], { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    const feed = FeedMessage.toObject(FeedMessage.decode(await readBounded(response)), { longs: Number, enums: String });
    if (!feed.header?.timestamp || feed.header.incrementality === 'DIFFERENTIAL') throw new Error('Unsupported feed snapshot');
    return { status: 'ok', timestamp: feed.header.timestamp, entities: feed.entity || [] };
  } catch (error) {
    console.warn(JSON.stringify({ event: 'feed_unavailable', kind, reason: error.message }));
    return { status: 'unavailable', timestamp: null, entities: [] };
  }
}

export async function handleRequest(request, ctx, cache = null, fetcher = fetch) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  if (url.pathname !== '/v1/live') return new Response('Not found', { status: 404, headers: CORS });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { ...CORS, Allow: 'GET, OPTIONS' } });
  const cacheKey = new Request(url.origin + '/v1/live');
  const cached = await cache?.match(cacheKey);
  if (cached) return cached;
  const entries = await Promise.all(Object.keys(SOURCES).map(async kind => [kind, await fetchFeed(kind, fetcher)]));
  const feeds = Object.fromEntries(entries);
  const available = entries.some(([, feed]) => feed.status === 'ok');
  const response = Response.json({ fetchedAt: Math.floor(Date.now() / 1000), feeds }, {
    status: available ? 200 : 503,
    headers: { ...CORS, 'Cache-Control': available ? 'public, max-age=20' : 'no-store' },
  });
  if (available && cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  fetch(request, env, ctx) { return handleRequest(request, ctx, caches.default); },
};
