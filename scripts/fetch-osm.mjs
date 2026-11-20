// Fetches raw OpenStreetMap data for a city from the Overpass API and saves it
// to data/<city>/osm-raw.json. Usage: node scripts/fetch-osm.mjs [cityId]
// Retries with exponential backoff and falls back to public mirrors.
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
const query = `[out:json][timeout:180];
(
  way["highway"](${bb});
  way["building"](${bb});
  way["natural"="water"](${bb});
  way["waterway"~"river|canal|stream"](${bb});
  relation["natural"="water"](${bb});
  way["natural"="coastline"](${bb});
  way["landuse"="harbour"](${bb});
  way["leisure"~"park|garden|pitch|playground"](${bb});
  way["landuse"~"grass|forest|recreation_ground|cemetery|meadow"](${bb});
  node["amenity"~"cafe|restaurant|fast_food|bar|pub|hospital|police|library|theatre|cinema|ice_cream"](${bb});
  node["shop"~"bakery|supermarket|convenience|florist|books|clothes|deli|butcher|bicycle|alcohol|wine"](${bb});
  nwr["tourism"~"museum|attraction|gallery|hotel"](${bb});
  nwr["amenity"~"hospital|police|townhall|place_of_worship|arts_centre|library|university|music_venue|nightclub|theatre"](${bb});
  nwr["railway"="station"](${bb});
  nwr["leisure"~"sports_centre|stadium|water_park|swimming_area"](${bb});
);
out body geom qt;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryFetch() {
  let wait = 3000;
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log(`Attempt ${attempt + 1}: ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'osm-city-map-builder/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(query),
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
    wait = Math.min(wait * 2, 30000);
  }
  throw new Error('All Overpass attempts failed');
}

const json = await tryFetch();
await mkdir(`data/${cityId}`, { recursive: true });
await writeFile(`data/${cityId}/osm-raw.json`, JSON.stringify(json));
console.log(`Saved ${json.elements.length} elements to data/${cityId}/osm-raw.json`);
