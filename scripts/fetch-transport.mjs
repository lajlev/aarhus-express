// Fetches transport and vehicle-related OSM data for a city into data/<city>/osm-transport.json.
// Usage: node scripts/fetch-transport.mjs [cityId]   (also run by `npm run fetch-map`)
// Separate from fetch-osm.mjs on purpose: route relations are fetched WITHOUT geometry (members only),
// which keeps the file small, and the main map extract stays untouched.
// Same pattern as fetch-osm.mjs: generic User-Agent, retries with backoff, mirror fallback.
import { writeFile, mkdir } from 'node:fs/promises';
import { CITY_BOUNDS } from './cities.mjs';

const cityId = process.argv[2] || 'aarhus';
const city = CITY_BOUNDS[cityId];
if (!city) {
  console.error(`Unknown city "${cityId}". Known: ${Object.keys(CITY_BOUNDS).join(', ')}`);
  process.exit(1);
}
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const { south: s, west: w, north: n, east: e } = city.bbox;
const bb = `${s},${w},${n},${e}`;
// Two queries so a busy server only costs us the heavy one:
//   A: tagged nodes/ways (bus stops, signals, taxi, vehicle shops), centre point + tags only.
//   B: bus route relations (members only, no geometry) plus the member nodes they reference.
// If B never succeeds the build falls back to routes derived from the stop sequence (see build-map.mjs).
const queryA = `[out:json][timeout:120];
(
  node["highway"="bus_stop"](${bb});
  node["public_transport"~"platform|stop_position"]["bus"="yes"](${bb});
  node["highway"="traffic_signals"](${bb});
  nwr["amenity"="taxi"](${bb});
  nwr["shop"~"^(bicycle|car|motorcycle)$"](${bb});
  nwr["amenity"~"^(car_rental|bicycle_rental)$"](${bb});
);
out center tags;`;
const queryB = `[out:json][timeout:150];
rel["route"="bus"](${bb})->.r;
.r out body;
node(r.r);
out body;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tryFetch(query, label, attempts = 10) {
  let wait = 4000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log(`[${label}] attempt ${attempt + 1}: ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'osm-city-map-builder/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(170000),
      });
      const text = await res.text();
      if (res.ok && text.trim().startsWith('{')) {
        const json = JSON.parse(text);
        if (json.elements?.length) return json;
      }
      console.log(`  -> HTTP ${res.status}, ${text.slice(0, 80).replace(/\n/g, ' ')}`);
    } catch (err) {
      console.log(`  -> ${err.message}`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 45000);
  }
  return null;
}
const A = await tryFetch(queryA, 'stops/signals/shops');
if (!A) throw new Error('All Overpass attempts failed for the tagged-node query');
const B = await tryFetch(queryB, 'bus routes', 6);
if (!B) console.warn('Bus route relations unavailable: build-map will derive routes from the stop sequence.');
const json = { elements: [...A.elements, ...(B?.elements || [])], routesFetched: !!B };
await mkdir(`data/${cityId}`, { recursive: true });
await writeFile(`data/${cityId}/osm-transport.json`, JSON.stringify(json));
const c = {};
for (const el of json.elements) { const k = el.type + ':' + (el.tags?.highway || el.tags?.route || el.tags?.amenity || el.tags?.shop || el.tags?.public_transport || '-'); c[k] = (c[k] || 0) + 1; }
console.log(`Saved ${json.elements.length} elements`, c);
