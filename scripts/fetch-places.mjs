// Fetches district-level OSM places (suburb / neighbourhood / quarter nodes+ways, admin boundaries 9-10)
// into data/<city>/osm-places.json. Small query, separate from the big raw fetch. Optional: build-map
// falls back to hand-set district seeds when this file is missing or empty.
import { writeFile, mkdir } from 'node:fs/promises';
import { CITY_BOUNDS } from './cities.mjs';
const cityId = process.argv[2] || 'aarhus';
const { south: s, west: w, north: n, east: e } = CITY_BOUNDS[cityId].bbox;
const bb = `${s},${w},${n},${e}`;
const query = `[out:json][timeout:60];(node["place"~"suburb|neighbourhood|quarter|locality"](${bb});way["place"~"suburb|neighbourhood|quarter"](${bb});relation["place"~"suburb|neighbourhood|quarter"](${bb});relation["boundary"="administrative"]["admin_level"~"9|10"](${bb}););out center tags;`;
const EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wait = 4000;
for (let i = 0; i < 10; i++) {
  try {
    const res = await fetch(EP[i % EP.length], { method: 'POST', headers: { 'User-Agent': 'osm-city-map-builder/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
    const text = await res.text();
    if (res.ok && text.trim().startsWith('{')) {
      await mkdir(`data/${cityId}`, { recursive: true });
      await writeFile(`data/${cityId}/osm-places.json`, text);
      console.log('saved', JSON.parse(text).elements.length, 'places');
      process.exit(0);
    }
    console.log('attempt', i + 1, res.status);
  } catch (err) { console.log('attempt', i + 1, err.message); }
  await sleep(wait); wait = Math.min(wait * 1.5, 20000);
}
console.log('giving up; hand-set district seeds will be used');
