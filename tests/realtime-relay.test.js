import test from 'node:test';
import assert from 'node:assert/strict';
import bindings from 'gtfs-realtime-bindings';
import { fetchFeed, handleRequest } from '../realtime-relay/worker.js';
const Feed = bindings.transit_realtime.FeedMessage;
const bytes = Feed.encode(Feed.create({ header: { gtfsRealtimeVersion: '2.0', timestamp: 1793872800 } })).finish();
const upstream = () => new Response(bytes, { headers: { 'Content-Type': 'application/x-protobuf' } });

test('official binary feeds decode, preserving timestamps and healthy empty snapshots', async () => {
  const result = await fetchFeed('vehicles', async url => { assert.ok(url.endsWith('/vehicleposition')); return upstream(); });
  assert.deepEqual(result, { status: 'ok', timestamp: 1793872800, entities: [] });
});

test('relay is limited to official endpoints, supports CORS, and caches shared snapshots', async () => {
  let calls = 0;
  const pending = [], store = new Map();
  const cache = { match: async r => store.get(r.url)?.clone(), put: async (r, v) => store.set(r.url, v) };
  const ctx = { waitUntil: p => pending.push(p) };
  const fetcher = async url => { calls++; assert.equal(new URL(url).hostname, 'nycferry.connexionz.net'); return upstream(); };
  const request = new Request('https://relay.test/v1/live?url=https://example.com');
  const response = await handleRequest(request, ctx, cache, fetcher);
  await Promise.all(pending);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys((await response.json()).feeds), ['vehicles', 'tripUpdates', 'alerts']);
  await handleRequest(new Request('https://relay.test/v1/live'), ctx, cache, fetcher);
  assert.equal(calls, 3);
  assert.equal((await handleRequest(new Request('https://relay.test/anything'), ctx, cache, fetcher)).status, 404);
  assert.equal((await handleRequest(new Request('https://relay.test/v1/live', { method: 'POST' }), ctx, cache, fetcher)).status, 405);
});

test('one failed feed does not hide other feeds and total failure is not cached', async () => {
  const ctx = { waitUntil() {} };
  const result = await handleRequest(new Request('https://relay.test/v1/live'), ctx, null, async url => url.endsWith('/alert') ? new Response('Unavailable', { status: 503 }) : upstream());
  const data = await result.json();
  assert.equal(result.status, 200);
  assert.equal(data.feeds.alerts.status, 'unavailable');
  assert.equal(data.feeds.vehicles.status, 'ok');
  const failed = await handleRequest(new Request('https://relay.test/v1/live'), ctx, null, async () => new Response('Unavailable', { status: 503 }));
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
});


test('oversized and malformed protobuf feeds are rejected', async () => {
  const huge = await fetchFeed('vehicles', async () => new Response(bytes, { headers: { 'Content-Length': '3000000' } }));
  assert.equal(huge.status, 'unavailable');
  const invalid = await fetchFeed('vehicles', async () => new Response(new Uint8Array([255, 255])));
  assert.equal(invalid.status, 'unavailable');
});
