// Converts a raw Overpass response (data/<city>/osm-raw.json) into the compact
// map JSON the game loads (public/maps/<city>.json).
// Usage: node scripts/build-map.mjs [cityId]
//
// Output coordinates are integer world pixels (SCALE px per metre), origin at
// the bbox north-west corner, y pointing down (south).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CITY_BOUNDS } from './cities.mjs';
import { LANDMARKS, STREET_LANDMARKS, POI_BLOCKLIST, LANDMARK_BUILDINGS, LANDMARK_OVERLAYS, DISTRICT_SEEDS } from './landmarks.mjs';
import { existsSync } from 'node:fs';

const cityId = process.argv[2] || 'aarhus';
const city = CITY_BOUNDS[cityId];
const SCALE = 8; // px per metre

const raw = JSON.parse(await readFile(`data/${cityId}/osm-raw.json`, 'utf8'));
const { south, west, north, east } = city.bbox;
const midLat = ((south + north) / 2) * (Math.PI / 180);
const M_LAT = 111132;
const M_LON = 111320 * Math.cos(midLat);
const W_M = (east - west) * M_LON;
const H_M = (north - south) * M_LAT;
const WIDTH = Math.round(W_M * SCALE);
const HEIGHT = Math.round(H_M * SCALE);

const projM = (lat, lon) => [(lon - west) * M_LON, (north - lat) * M_LAT];
const proj = (lat, lon) => {
  const [x, y] = projM(lat, lon);
  return [x * SCALE, y * SCALE];
};

// ---------- helpers ----------
function dp(points, tol) {
  // Douglas-Peucker on [[x,y],...]
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol * tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
const inWorld = (pts, margin = 200 * SCALE) =>
  pts.some(([x, y]) => x > -margin && y > -margin && x < WIDTH + margin && y < HEIGHT + margin);
const polyArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
};
const centroid = (pts) => {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
};

// Join way geometries (arrays of [x,y]) into rings by matching endpoints.
function assembleRings(lines) {
  const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const rings = [];
  const pool = lines.map((l) => l.slice());
  while (pool.length) {
    let ring = pool.pop();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 2000) {
      const end = key(ring[ring.length - 1]);
      let idx = pool.findIndex((l) => key(l[0]) === end || key(l[l.length - 1]) === end);
      if (idx >= 0) {
        let next = pool.splice(idx, 1)[0];
        if (key(next[0]) !== end) next = next.reverse();
        ring = ring.concat(next.slice(1));
        continue;
      }
      const start = key(ring[0]);
      idx = pool.findIndex((l) => key(l[0]) === start || key(l[l.length - 1]) === start);
      if (idx < 0) break;
      let prev = pool.splice(idx, 1)[0];
      if (key(prev[prev.length - 1]) !== start) prev = prev.reverse();
      ring = prev.slice(0, -1).concat(ring);
    }
    if (ring.length >= 2) rings.push(ring);
  }
  return rings;
}

const geomOf = (el) => (el.geometry || []).filter(Boolean).map((g) => proj(g.lat, g.lon));
function outerRings(el) {
  if (el.type === 'way') {
    const g = geomOf(el);
    return g.length >= 4 ? [g] : [];
  }
  if (el.type === 'relation') {
    const outers = (el.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry)
      .map((m) => m.geometry.filter(Boolean).map((g) => proj(g.lat, g.lon)));
    return assembleRings(outers);
  }
  return [];
}


// ---------- building meta ----------
// packed int: kind (4 bits) | min(levels,63) << 4 | roofShape (4 bits) << 10
// kind: 0 generic, 1 church, 2 apartments, 3 residential, 4 house, 5 commercial, 6 retail, 7 industrial/warehouse,
//       8 education, 9 health, 10 office/hotel, 11 small (garage/shed/carport/hut), 12 civic/culture, 13 sports/transport
// roofShape: 0 unknown, 1 flat, 2 gabled, 3 hipped, 4 skillion, 5 pyramidal, 6 dome/round, 7 other
const KIND_OF = {
  church: 1, cathedral: 1, chapel: 1, apartments: 2, dormitory: 2, residential: 3, terrace: 3,
  house: 4, detached: 4, semidetached_house: 4, allotment_house: 4, bungalow: 4,
  commercial: 5, retail: 6, mall: 6, supermarket: 6, industrial: 7, warehouse: 7, storage_tank: 7, silo: 7, service: 7, workshop: 7,
  university: 8, school: 8, college: 8, kindergarten: 8, research_institute: 8,
  hospital: 9, clinic: 9, office: 10, hotel: 10, bank: 10,
  garage: 11, garages: 11, shed: 11, carport: 11, hut: 11, kiosk: 11, toilets: 11, boathouse: 11, stable: 11, greenhouse: 11, guardhouse: 11,
  civic: 12, government: 12, museum: 12, public: 12, train_station: 13, sports_hall: 13, grandstand: 13, transportation: 13,
};
const SHAPE_OF = { flat: 1, gabled: 2, hipped: 3, 'half-hipped': 3, skillion: 4, 'lean_to': 4, pyramidal: 5, dome: 6, round: 6, onion: 6, gambrel: 2, mansard: 3 };
const NAMED_COLOURS = { red: 0xb5503c, brown: 0x7d5a46, grey: 0x7c8085, gray: 0x7c8085, black: 0x2e3035, white: 0xe4e2dc, green: 0x5f8f7a, blue: 0x486a9a, orange: 0xc9783c, yellow: 0xd8c070, silver: 0xaeb2b6, darkgrey: 0x55585d, lightgrey: 0xa5a8ac, beige: 0xc9b48a, tan: 0xb59a74, maroon: 0x7a2f2a, terracotta: 0xb25a3e };
function parseColour(v) {
  if (!v) return -1;
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  if (m) return parseInt(m[1], 16);
  const m3 = /^#([0-9a-f]{3})$/i.exec(v.trim());
  if (m3) return parseInt(m3[1].split('').map((c) => c + c).join(''), 16);
  const k = v.trim().toLowerCase().replace(/[\s_-]/g, '');
  return NAMED_COLOURS[k] ?? -1;
}
function packMeta(t) {
  const kind = KIND_OF[t.building] ?? (t.amenity === 'place_of_worship' ? 1 : t.shop ? 6 : 0);
  const lv = Math.max(0, Math.min(63, Math.round(parseFloat(t['building:levels']) || 0)));
  const shape = SHAPE_OF[t['roof:shape']] ?? 0;
  return kind | (lv << 4) | (shape << 10);
}

// ---------- classify ----------
const ROAD_KINDS = ['major', 'tertiary', 'minor', 'service', 'pedestrian', 'footway', 'cycleway', 'busway'];
const ROAD_DEF = {
  motorway: ['major', 18, 1], trunk: ['major', 18, 1], primary: ['major', 16, 1], secondary: ['major', 14, 1],
  motorway_link: ['major', 10, 1], trunk_link: ['major', 10, 1], primary_link: ['major', 10, 1], secondary_link: ['major', 10, 1],
  tertiary: ['tertiary', 12, 1], tertiary_link: ['tertiary', 9, 1],
  unclassified: ['minor', 10, 1], residential: ['minor', 9, 1], living_street: ['minor', 7, 1],
  service: ['service', 6, 1], busway: ['busway', 8, 1], road: ['minor', 8, 1],
  pedestrian: ['pedestrian', 8, 0], footway: ['footway', 3, 0], path: ['footway', 2.5, 0], steps: ['footway', 3, 0],
  cycleway: ['cycleway', 3, 0], track: ['footway', 3, 0],
};

// Speed limit in km/h (maxspeed tag). Danish defaults when missing: 50 urban, 80 for motorways, trunks and
// ring/bypass roads ("...vej"/"Ring..." marked as primary or bigger), 30 on service roads.
function speedOf(t) {
  const m = (t.maxspeed || '').toString().trim().toLowerCase();
  const n = parseInt(m, 10);
  if (/mph/.test(m) && n) return Math.min(130, Math.round(n * 1.609 / 10) * 10);
  if (n > 0 && n <= 130) return Math.max(10, Math.round(n / 10) * 10);
  if (m === 'dk:urban') return 50;
  if (m === 'dk:rural') return 80;
  if (m === 'dk:motorway') return 130;
  if (m === 'walk') return 10;
  const h = t.highway;
  if (h === 'motorway' || h === 'motorway_link' || h === 'trunk' || h === 'trunk_link') return 80;
  if ((h === 'primary' || h === 'secondary') && /ring|omfartsvej|motorring/i.test(t.name || '')) return 80;
  if (h === 'service' || h === 'living_street') return 30;
  return 50;
}

const roads = [];
const buildings = [];
const buildingIds = []; // parallel to buildings: 'w123' / 'r456'
const buildingMeta = []; // parallel: packed ints, see packMeta()
const buildingNames = []; // parallel: OSM name or ''
const buildingColours = {}; // building index -> roof RGB int (from roof:colour)
const bikeWays = [];
const bikeLanes = []; // [type, x0,y0,...] type 0 separate cycleway, 1 track, 2 lane, 3 shared lane/busway
const water = [];
const waterLines = [];
const green = [];
const GREEN_KINDS = ['park', 'pitch', 'forest', 'cemetery', 'harbour'];
const coastLines = [];
const poiCandidates = [];

const nodeUse = new Map(); // osm node id -> count of drivable ways using it
const walkUse = new Map();
const driveWays = [];
const walkWays = [];

for (const el of raw.elements) {
  const t = el.tags || {};
  if (el.type === 'way' && t.highway && ROAD_DEF[t.highway] && t.area !== 'yes' && t.tunnel !== 'yes' && t.tunnel !== 'building_passage') {
    const [kind, wM, drivable] = ROAD_DEF[t.highway];
    const pts = geomOf(el);
    if (pts.length < 2 || !inWorld(pts)) continue;
    let width = t.width && !isNaN(parseFloat(t.width)) ? Math.min(Math.max(parseFloat(t.width), wM * 0.6), wM * 1.4) : wM;
    if (t.lanes && drivable) width = Math.max(width, Math.min(parseInt(t.lanes, 10) * 3.6, 20));
    const flags = (t.bridge && t.bridge !== 'no' ? 1 : 0);
    roads.push({ k: ROAD_KINDS.indexOf(kind), w: Math.round(width * SCALE), f: flags, name: t.name || '', pts });
    {
      // cycle infrastructure: separate cycleways and cycleway=* tags on roads
      const cyc = [t.cycleway, t['cycleway:left'], t['cycleway:right'], t['cycleway:both']].filter((v) => v && v !== 'no' && v !== 'none' && v !== 'separate');
      let bt = -1;
      if (t.highway === 'cycleway') bt = 0;
      else if (cyc.length) bt = cyc.some((v) => v === 'track' || v === 'opposite_track') ? 1 : cyc.some((v) => v === 'lane' || v === 'opposite_lane') ? 2 : 3;
      else if (t.highway === 'busway' || t.bicycle === 'designated') bt = 3;
      if (bt >= 0) {
        bikeLanes.push([bt, ...flat(dp(pts, 0.5 * SCALE))]);
        bikeWays.push({ nodes: el.nodes, pts, oneway: 0, w: bt === 0 ? 3 : width, kind: 'cycleway' });
      }
    }
    let oneway = 0;
    if (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular') oneway = 1;
    if (t.oneway === '-1') oneway = -1;
    const isDrive = drivable && t.access !== 'private' && t.access !== 'no' && t.service !== 'parking_aisle' && t.service !== 'drive-through';
    const rec = { nodes: el.nodes, pts, oneway, w: width, kind, speed: speedOf(t) };
    if (isDrive) {
      driveWays.push(rec);
      for (const n of el.nodes) nodeUse.set(n, (nodeUse.get(n) || 0) + 1);
    }
    if (t.highway !== 'steps' || true) {
      walkWays.push({ ...rec, oneway: 0 });
      for (const n of el.nodes) walkUse.set(n, (walkUse.get(n) || 0) + 1);
    }
    continue;
  }
  if (t.building && t.building !== 'no' && t.building !== 'roof' && t.location !== 'underground') {
    for (const ring of outerRings(el)) {
      if (!inWorld(ring, 0)) continue;
      const s = dp(ring, 0.3 * SCALE);
      if (s.length < 4 || polyArea(s) < 6 * SCALE * SCALE) continue;
      let cls = 0;
      if (t.amenity === 'place_of_worship' || t.building === 'church' || t.building === 'cathedral') cls = 1;
      else if (t.tourism || t.amenity || t.building === 'public' || t.building === 'civic') cls = 2;
      else if (t.building === 'industrial' || t.building === 'warehouse' || t.building === 'commercial' || t.building === 'retail') cls = 3;
      const bi = buildings.length;
      buildings.push([cls, ...flat(s.slice(0, -1))]);
      buildingIds.push((el.type === 'way' ? 'w' : 'r') + el.id);
      buildingNames.push(t.name || '');
      buildingMeta.push(packMeta(t));
      const rc = parseColour(t['roof:colour']);
      if (rc >= 0) buildingColours[bi] = rc;
    }
  }
  if (t.natural === 'coastline' && el.type === 'way') {
    coastLines.push(geomOf(el));
    continue;
  }
  if (t.natural === 'water' || t.landuse === 'basin' || t.landuse === 'reservoir') {
    if (t.intermittent === 'yes') continue;
    for (const ring of outerRings(el)) {
      if (!inWorld(ring, 0)) continue;
      const s = dp(ring, 0.5 * SCALE);
      if (s.length >= 4) water.push(flat(s.slice(0, -1)));
    }
  }
  if (el.type === 'way' && t.waterway && ['river', 'canal', 'stream'].includes(t.waterway) && t.tunnel !== 'yes' && t.tunnel !== 'culvert') {
    const pts = geomOf(el);
    if (!inWorld(pts, 0)) continue;
    const wM = t.waterway === 'river' ? 9 : t.waterway === 'canal' ? 6 : 2;
    waterLines.push([Math.round(wM * SCALE), ...flat(dp(pts, 0.5 * SCALE))]);
  }
  const gk =
    t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.landuse === 'meadow' || t.leisure === 'playground' ? 0 :
    t.leisure === 'pitch' ? 1 : t.landuse === 'forest' ? 2 : t.landuse === 'cemetery' ? 3 : t.landuse === 'harbour' ? 4 : -1;
  if (gk >= 0 && !t.building) {
    for (const ring of outerRings(el)) {
      if (!inWorld(ring, 0)) continue;
      const s = dp(ring, 0.6 * SCALE);
      if (s.length >= 4 && polyArea(s) > 30 * SCALE * SCALE) green.push([gk, ...flat(s.slice(0, -1))]);
    }
  }
  if (t.name) {
    let pos = null;
    if (el.type === 'node') pos = proj(el.lat, el.lon);
    else {
      const rings = outerRings(el);
      if (rings.length) pos = centroid(rings[0]);
      else if (el.bounds) pos = proj((el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2);
    }
    if (pos && pos[0] >= 0 && pos[1] >= 0 && pos[0] <= WIDTH && pos[1] <= HEIGHT) poiCandidates.push({ tags: t, pos, type: el.type });
  }
}

// ---------- sea from coastline ----------
// OSM coastlines have land on the left, sea on the right. Clip chains to the
// world rectangle and close them along the border, walking clockwise.
function buildSea(lines) {
  const chains = assembleRings(lines).concat([]); // closed rings + open chains
  // assembleRings drops nothing open-ended, it returns joined chains (open or closed)
  const W = WIDTH, H = HEIGHT;
  const inside = (p) => p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;
  const perim = (p) => {
    const [x, y] = p, e = 0.5;
    if (Math.abs(y) < e) return x;
    if (Math.abs(x - W) < e) return W + y;
    if (Math.abs(y - H) < e) return W + H + (W - x);
    return 2 * W + H + (H - y);
  };
  const intersect = (a, b) => {
    // segment a->b with rectangle border; return first crossing point from a towards b
    let best = null, bt = 2;
    const tests = [
      [0, (p) => p[1], 0], [0, (p) => p[1], H], [1, (p) => p[0], 0], [1, (p) => p[0], W],
    ];
    for (const [, f, v] of tests) {
      const fa = f(a), fb = f(b);
      if ((fa - v) * (fb - v) <= 0 && fa !== fb) {
        const t = (v - fa) / (fb - fa);
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (p[0] >= -0.5 && p[0] <= W + 0.5 && p[1] >= -0.5 && p[1] <= H + 0.5 && t < bt) { bt = t; best = p; }
      }
    }
    if (best) { best[0] = Math.max(0, Math.min(W, best[0])); best[1] = Math.max(0, Math.min(H, best[1])); }
    return best;
  };
  const pieces = [];
  const islands = [];
  for (const c of chains) {
    const closed = c.length > 3 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 1;
    if (closed && c.every(inside)) { islands.push(c); continue; }
    if (inside(c[0]) || inside(c[c.length - 1])) {
      if (!closed) { console.warn('  coastline chain ends inside world, skipped'); continue; }
    }
    let cur = null;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i], b = c[i + 1];
      const ia = inside(a), ib = inside(b);
      if (ia && cur) cur.push(a);
      if (ia && !ib) {
        const p = intersect(b, a);
        if (cur && p) { cur.push(p); pieces.push(cur); }
        cur = null;
      } else if (!ia && ib) {
        const p = intersect(a, b);
        cur = p ? [p] : null;
      } else if (!ia && !ib) {
        // segment could cross the rectangle entirely
        const p1 = intersect(a, b), p2 = intersect(b, a);
        if (p1 && p2 && Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) > 1) pieces.push([p1, p2]);
      }
    }
  }
  if (!pieces.length) return { sea: [], islands };
  const corners = [[W, 0, W], [W, H, W + H], [0, H, 2 * W + H], [0, 0, 2 * W + 2 * H]];
  const P = 2 * W + 2 * H;
  const info = pieces.map((p) => ({ pts: p, tin: perim(p[0]), tout: perim(p[p.length - 1]), used: false }));
  const polys = [];
  for (const start of info) {
    if (start.used) continue;
    let poly = [];
    let cur = start;
    let guard = 0;
    while (guard++ < 500) {
      cur.used = true;
      poly = poly.concat(cur.pts);
      // next entry clockwise from cur.tout
      let best = null, bestD = Infinity;
      for (const q of info) {
        let d = q.tin - cur.tout;
        if (d < 0) d += P;
        if ((q.used && q !== start) ) continue;
        if (d < bestD) { bestD = d; best = q; }
      }
      // corners between cur.tout and best.tin
      for (let k = 0; k < 8; k++) {
        const c = corners[k % 4];
        let ct = c[2] % P; let d = ct - cur.tout; if (d < 0) d += P;
        if (d > 0 && d < bestD) poly.push([c[0], c[1], d]);
      }
      // sort corner pts we just added by d
      const tail = [];
      while (poly.length && poly[poly.length - 1].length === 3) tail.push(poly.pop());
      tail.sort((a, b) => a[2] - b[2]);
      const seen = new Set();
      for (const t of tail) { const k = t[0] + ',' + t[1]; if (!seen.has(k)) { seen.add(k); poly.push([t[0], t[1]]); } }
      if (best === start || !best) break;
      cur = best;
    }
    polys.push(poly);
  }
  return { sea: polys, islands };
}
const { sea, islands } = buildSea(coastLines);
console.log(`coastline: ${coastLines.length} ways -> ${sea.length} sea polygons, ${islands.length} islands`);

// ---------- graphs ----------
function buildGraph(ways, useMap, tolM, keepMin = 0) {
  const idx = new Map();
  const xs = [], ys = [];
  const edges = [];
  const speeds = []; // parallel to edges: km/h
  const getNode = (id, p) => {
    let i = idx.get(id);
    if (i === undefined) { i = xs.length; idx.set(id, i); xs.push(Math.round(p[0])); ys.push(Math.round(p[1])); }
    return i;
  };
  for (const w of ways) {
    if (!w.nodes || w.nodes.length !== w.pts.length) continue;
    // keep junctions, endpoints and shape points
    const keepIdx = new Set([0, w.nodes.length - 1]);
    w.nodes.forEach((n, i) => { if ((useMap.get(n) || 0) > 1) keepIdx.add(i); });
    const sorted = [...keepIdx].sort((a, b) => a - b);
    const final = new Set(sorted);
    for (let s = 0; s < sorted.length - 1; s++) {
      const a = sorted[s], b = sorted[s + 1];
      const seg = w.pts.slice(a, b + 1).map((p, k) => [...p, a + k]);
      dp(seg, tolM * SCALE).forEach((p) => final.add(p[2]));
    }
    const order = [...final].sort((a, b) => a - b);
    for (let k = 0; k < order.length - 1; k++) {
      const ia = order[k], ib = order[k + 1];
      const a = getNode(w.nodes[ia], w.pts[ia]);
      const b = getNode(w.nodes[ib], w.pts[ib]);
      if (a === b) continue;
      speeds.push(w.speed || 50);
      if (w.oneway === -1) edges.push([b, a, 1, Math.round(w.w * SCALE)]);
      else edges.push([a, b, w.oneway, Math.round(w.w * SCALE)]);
    }
  }
  // largest undirected component
  const adj = xs.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const comp = new Int32Array(xs.length).fill(-1);
  let bestC = -1, bestSize = 0, c = 0;
  const keepComp = new Set();
  for (let i = 0; i < xs.length; i++) {
    if (comp[i] >= 0) continue;
    let size = 0; const st = [i]; comp[i] = c;
    while (st.length) { const u = st.pop(); size++; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; st.push(v); } }
    if (size > bestSize) { bestSize = size; bestC = c; }
    if (keepMin && size >= keepMin) keepComp.add(c);
    c++;
  }
  if (!keepMin) keepComp.add(bestC);
  const remap = new Int32Array(xs.length).fill(-1);
  const nx = [];
  for (let i = 0; i < xs.length; i++) if (keepComp.has(comp[i])) { remap[i] = nx.length / 2; nx.push(xs[i], ys[i]); }
  const ne = [];
  let ss = ''; // one base-36 char per kept edge: speed limit / 10 (5 = 50 km/h, 8 = 80, d = 130)
  edges.forEach(([a, b, o, w], i) => {
    if (remap[a] >= 0 && remap[b] >= 0) { ne.push(remap[a], remap[b], o ? 1 : 0, w); ss += Math.min(35, Math.round(speeds[i] / 10)).toString(36); }
  });
  return { n: nx, e: ne, s: ss };
}
const drive = buildGraph(driveWays, nodeUse, 1.2);
const walk = buildGraph(walkWays, walkUse, 2.0);
const bikeUse = new Map();
for (const w of bikeWays) for (const n of w.nodes) bikeUse.set(n, (bikeUse.get(n) || 0) + 1);
const bike = buildGraph(bikeWays, bikeUse, 1.5, 6); // all cycle-infrastructure components with >= 6 nodes
console.log(`bike graph: ${bike.n.length / 2} nodes, ${bike.e.length / 4} edges; ${bikeLanes.length} bike lane polylines`);
delete walk.s; delete bike.s; // per-edge speed limits are only kept for the drive graph
console.log(`drive graph: ${drive.n.length / 2} nodes, ${drive.e.length / 4} edges; walk graph: ${walk.n.length / 2} nodes`);

// nearest drive node helper (grid)
const CELL = 50 * SCALE;
const grid = new Map();
for (let i = 0; i < drive.n.length / 2; i++) {
  const k = `${Math.floor(drive.n[i * 2] / CELL)},${Math.floor(drive.n[i * 2 + 1] / CELL)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
}
function nearestDrive(x, y, maxM = 80) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  const R = Math.ceil((maxM * SCALE) / CELL);
  let best = -1, bd = (maxM * SCALE) ** 2;
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
    for (const i of grid.get(`${cx + dx},${cy + dy}`) || []) {
      const d = (drive.n[i * 2] - x) ** 2 + (drive.n[i * 2 + 1] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

// ---------- POIs ----------
const catOf = (t) => {
  const a = t.amenity, s = t.shop, tr = t.tourism, l = t.leisure;
  if (['cafe', 'ice_cream'].includes(a)) return 'cafe';
  if (['restaurant', 'fast_food'].includes(a)) return 'food';
  if (['bar', 'pub', 'nightclub'].includes(a)) return 'bar';
  if (['hospital'].includes(a)) return 'hospital';
  if (['police'].includes(a)) return 'police';
  if (['museum', 'gallery'].includes(tr) || ['library', 'theatre', 'cinema', 'arts_centre', 'music_venue'].includes(a)) return 'culture';
  if (tr === 'attraction' || a === 'townhall' || t.railway === 'station' || a === 'place_of_worship') return 'landmark';
  if (tr === 'hotel') return 'hotel';
  if (s) return 'shop';
  if (['sports_centre', 'stadium', 'water_park', 'swimming_area'].includes(l)) return 'sport';
  if (a === 'university') return 'culture';
  return null;
};
const pois = [];
const seenNames = new Set();
for (const c of poiCandidates) {
  const name = c.tags.name.trim();
  const cat = catOf(c.tags);
  if (!cat) continue;
  if (POI_BLOCKLIST.some((re) => re.test(name) || re.test(c.tags.brand || ''))) continue;
  if (/bagerudsalg|slagter|delikatesse|marketenderi/i.test(name)) continue;
  if (cat === 'landmark' && c.tags.amenity === 'place_of_worship' && c.type === 'node') continue;
  const key = name.toLowerCase();
  if (seenNames.has(key)) continue;
  const ni = nearestDrive(c.pos[0], c.pos[1], 60);
  if (ni < 0) continue;
  seenNames.add(key);
  pois.push({ n: name, k: cat, x: drive.n[ni * 2], y: drive.n[ni * 2 + 1], lx: Math.round(c.pos[0]), ly: Math.round(c.pos[1]) });
}

// curated landmarks: match by name in OSM, else street midpoint, else fallback coordinates
const landmarks = {};
const addLandmark = (id, name, kind, pos, source) => {
  const ni = nearestDrive(pos[0], pos[1], source === 'approx' ? 400 : 150);
  if (ni < 0) { console.warn(`  landmark ${id} not near any road, skipped`); return; }
  landmarks[id] = { n: name, k: kind, x: drive.n[ni * 2], y: drive.n[ni * 2 + 1], lx: Math.round(pos[0]), ly: Math.round(pos[1]), src: source };
};
for (const L of LANDMARKS) {
  const matches = poiCandidates.filter((c) => L.match.test(c.tags.name));
  matches.sort((a, b) => L.preferNode ? (b.type === 'node') - (a.type === 'node') : (a.type === 'node') - (b.type === 'node'));
  if (matches.length) addLandmark(L.id, L.name, L.kind, matches[0].pos, 'osm');
  else if (L.fallback) addLandmark(L.id, L.name, L.kind, proj(...L.fallback), 'approx');
}
for (const S of STREET_LANDMARKS) {
  const segs = roads.filter((r) => r.name === S.street);
  if (!segs.length) { if (S.fallback) addLandmark(S.id, S.name, S.kind, proj(...S.fallback), 'approx'); continue; }
  const all = segs.flatMap((r) => r.pts);
  all.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  addLandmark(S.id, S.name, S.kind, all[Math.floor(all.length / 2)], 'osm-street');
}
for (const [id, l] of Object.entries(landmarks)) console.log(`  landmark ${id.padEnd(12)} ${l.src.padEnd(10)} ${l.n}`);
console.log(`POIs: ${pois.length}`);

// ---------- streets (names kept on road segments) ----------
const streets = ['']; // index 0 = unnamed
const streetIdx = new Map();
const roadStreet = roads.map((r) => {
  if (!r.name) return 0;
  let i = streetIdx.get(r.name);
  if (i === undefined) { i = streets.length; streets.push(r.name); streetIdx.set(r.name, i); }
  return i;
});
console.log(`streets: ${streets.length - 1} names on ${roadStreet.filter(Boolean).length}/${roads.length} road segments`);

// ---------- districts ----------
const districtSeeds = new Map(); // name -> {x,y,bias}
for (const [n, la, lo, bias] of DISTRICT_SEEDS) { const [x, y] = proj(la, lo); districtSeeds.set(n, { x, y, bias: bias * SCALE }); }
const placesFile = `data/${cityId}/osm-places.json`;
if (existsSync(placesFile)) {
  const pl = JSON.parse(await readFile(placesFile, 'utf8'));
  let used = 0;
  for (const e of pl.elements || []) {
    const t = e.tags || {};
    if (!t.name || !/^(suburb|neighbourhood|quarter)$/.test(t.place || '')) continue; // localities and admin relations are too fine/odd
    const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
    if (la === undefined) continue;
    const [x, y] = proj(la, lo);
    if (x < -200 * SCALE || y < -200 * SCALE || x > WIDTH + 200 * SCALE || y > HEIGHT + 200 * SCALE) continue;
    // only OSM names that the game cares about replace hand seeds' centre; tiny OSM neighbourhoods are added with small reach
    const prev = districtSeeds.get(t.name);
    if (prev) { prev.x = x; prev.y = y; } // OSM centre beats the hand-set guess
    else districtSeeds.set(t.name, { x, y, bias: (t.place === 'suburb' ? 200 : 40) * SCALE });
    used++;
  }
  console.log(`districts: ${used} OSM places merged`);
}
const districts = [...districtSeeds].map(([n, d]) => [n, Math.round(d.x), Math.round(d.y), Math.round(d.bias)]);
console.log(`districts: ${districts.map((d) => d[0]).join(', ')}`);

// ---------- landmark buildings ----------
const bbox = (b) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let k = 1; k < b.length; k += 2) { x0 = Math.min(x0, b[k]); x1 = Math.max(x1, b[k]); y0 = Math.min(y0, b[k + 1]); y1 = Math.max(y1, b[k + 1]); } return [x0, y0, x1, y1]; };
const bCentre = (b) => { const q = bbox(b); return [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2]; };
const bArea = (b) => { const pts = []; for (let k = 1; k < b.length; k += 2) pts.push([b[k], b[k + 1]]); return polyArea(pts) / (SCALE * SCALE); };
const inPoly = (x, y, pts) => { let r = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > y) !== (pts[j][1] > y) && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) r = !r; return r; };
const landmarkBuildings = {};
for (const L of LANDMARK_BUILDINGS) {
  const found = new Set();
  let how = '';
  if (L.osmIds) for (const id of L.osmIds) buildingIds.forEach((b, i) => { if (b === id) { found.add(i); how = 'id'; } });
  if (!found.size && L.name) buildingNames.forEach((n, i) => { if (n && L.name.test(n)) { found.add(i); how = 'name'; } });
  if (!found.size && L.near) {
    const [la, lo, rad, minA] = L.near, [px, py] = proj(la, lo);
    let best = -1, ba = 0;
    buildings.forEach((b, i) => { const c = bCentre(b); if (Math.hypot(c[0] - px, c[1] - py) <= rad * SCALE) { const a = bArea(b); if (a >= minA && a > ba) { ba = a; best = i; } } });
    if (best >= 0) { found.add(best); how = 'coords'; }
  }
  if (L.within) {
    const el = raw.elements.find((e) => (e.type === 'way' ? 'w' : 'r') + e.id === L.within);
    const ring = el ? outerRings(el)[0] : null;
    if (ring) { buildings.forEach((b, i) => { const c = bCentre(b); if (inPoly(c[0], c[1], ring)) found.add(i); }); how = 'within ' + L.within; }
  }
  if (L.groupNear && found.size) {
    const seed = [...found].map((i) => bCentre(buildings[i]));
    buildings.forEach((b, i) => { if (found.has(i) || bArea(b) < L.groupNear[1]) return; const c = bCentre(b); if (seed.some((s) => Math.hypot(s[0] - c[0], s[1] - c[1]) <= L.groupNear[0] * SCALE)) found.add(i); });
  }
  if (!found.size) { console.warn(`  landmark building ${L.id}: NO footprint matched`); continue; }
  landmarkBuildings[L.id] = { sprite: L.sprite, mode: L.mode, label: L.label, lm: L.lm, bi: [...found], how };
  console.log(`  landmark building ${L.id.padEnd(11)} ${how.padEnd(18)} ${found.size} footprint(s), ${Math.round([...found].reduce((a, i) => a + bArea(buildings[i]), 0))} m2`);
}
// Overlays flagged `quay` are snapped to the nearest sea edge: rotated along the shoreline, sprite bottom pointing inland.
function snapToQuay(x, y, offsetPx) {
  let best = null, bd = Infinity;
  for (const poly of sea) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      if (l2 < (3 * SCALE) ** 2 || a[0] <= 1 || a[0] >= WIDTH - 1 || a[1] <= 1 || a[1] >= HEIGHT - 1) continue; // skip bbox-border edges
      let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
      const qx = a[0] + t * dx, qy = a[1] + t * dy, d = Math.hypot(qx - x, qy - y);
      if (d < bd) { bd = d; best = { qx, qy, ang: Math.atan2(dy, dx) }; }
    }
  }
  if (!best || bd > 400 * SCALE) return null;
  // inland normal = the side whose point is not water
  const nx = -Math.sin(best.ang), ny = Math.cos(best.ang);
  const inSea = (px, py) => sea.some((poly) => inPoly(px, py, poly));
  const sgn = inSea(best.qx + nx * 40, best.qy + ny * 40) ? -1 : 1;
  const ix = nx * sgn, iy = ny * sgn;
  let rot = Math.atan2(ix, -iy) * 180 / Math.PI; // sprite local +y -> inland normal: rotate so that (-sin r, cos r) = (ix, iy)
  rot = Math.atan2(-ix, iy) * 180 / Math.PI;
  return { x: Math.round(best.qx + ix * offsetPx), y: Math.round(best.qy + iy * offsetPx), rot };
}
const landmarkOverlays = LANDMARK_OVERLAYS.map((o) => {
  let [x, y] = proj(...o.at), rot = o.rot;
  if (o.quay) { const q = snapToQuay(x, y, o.hM * SCALE * 0.25); if (q) { x = q.x; y = q.y; rot = q.rot; } else console.warn('  overlay', o.id, 'no quay found'); }
  return { id: o.id, sprite: o.sprite, label: o.label, lm: o.lm, x: Math.round(x), y: Math.round(y), w: Math.round(o.wM * SCALE), h: Math.round(o.hM * SCALE), rot: Math.round(rot) };
});



// ---------- transport + vehicle shops (data/<city>/osm-transport.json, see scripts/fetch-transport.mjs) ----------
// Bus stops (clustered), bus routes (relations, else derived), traffic signals, taxi stands, vehicle shops.
const transport = existsSync(`data/${cityId}/osm-transport.json`) ? JSON.parse(await readFile(`data/${cityId}/osm-transport.json`, 'utf8')) : { elements: [] };
const tEls = transport.elements;
const tpos = (el) => (el.lat != null ? proj(el.lat, el.lon) : el.center ? proj(el.center.lat, el.center.lon) : null);
const inMap = (p) => p && p[0] > 0 && p[1] > 0 && p[0] < WIDTH && p[1] < HEIGHT;
const snap = (p, maxM) => nearestDrive(p[0], p[1], maxM);

// --- bus stops: bus_stop / platform / stop_position nodes, merged when they share a name within 40 m (or lie within 8 m) ---
const stopNodes = []; // { id, name, p }
const seenStop = new Set();
const relMemberIds = new Set();
for (const el of tEls) if (el.type === 'relation') for (const m of el.members || []) if (m.type === 'node') relMemberIds.add(m.ref);
for (const el of tEls) {
  if (el.type !== 'node' || seenStop.has(el.id)) continue;
  const t = el.tags || {};
  const isStop = t.highway === 'bus_stop' || (t.bus === 'yes' && (t.public_transport === 'platform' || t.public_transport === 'stop_position')) || (relMemberIds.has(el.id) && t.public_transport);
  if (!isStop) continue;
  const p = proj(el.lat, el.lon);
  if (!inMap(p)) continue;
  seenStop.add(el.id);
  stopNodes.push({ id: el.id, name: (t.name || '').trim(), p });
}
const parent = stopNodes.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
for (let i = 0; i < stopNodes.length; i++) for (let j = i + 1; j < stopNodes.length; j++) {
  const d = Math.hypot(stopNodes[i].p[0] - stopNodes[j].p[0], stopNodes[i].p[1] - stopNodes[j].p[1]) / SCALE;
  const sameName = stopNodes[i].name && stopNodes[i].name === stopNodes[j].name;
  if ((sameName && d < 40) || d < 8) parent[find(i)] = find(j);
}
const clusters = new Map();
stopNodes.forEach((s, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(s); });
const busStops = [];
const stopOfOsm = new Map(); // osm node id -> stop index
for (const list of clusters.values()) {
  const cx = list.reduce((a, s) => a + s.p[0], 0) / list.length, cy = list.reduce((a, s) => a + s.p[1], 0) / list.length;
  const ni = snap([cx, cy], 60);
  if (ni < 0) continue;
  const idx = busStops.length;
  busStops.push({ name: list.find((s) => s.name)?.name || 'Bus stop', x: drive.n[ni * 2], y: drive.n[ni * 2 + 1], lx: Math.round(cx), ly: Math.round(cy), node: ni, routes: [] });
  for (const s of list) stopOfOsm.set(s.id, idx);
}

// --- bus routes ---
const busRoutes = [];
let routesFrom = 'relations';
for (const el of tEls) {
  if (el.type !== 'relation' || el.tags?.route !== 'bus') continue;
  const seq = [];
  for (const m of el.members || []) {
    if (m.type !== 'node' || !/^(stop|platform)/.test(m.role || '')) continue;
    const si = stopOfOsm.get(m.ref);
    if (si === undefined || seq[seq.length - 1] === si) continue;
    seq.push(si);
  }
  if (seq.length < 3) continue;
  const t = el.tags;
  busRoutes.push({ id: `r${el.id}`, ref: t.ref || '', name: t.name || `${t.from || ''} - ${t.to || ''}`.trim(), from: t.from || busStops[seq[0]].name, to: t.to || busStops[seq[seq.length - 1]].name, stops: seq, derived: false });
}
if (!busRoutes.length) {
  // Fallback: no usable relations. Derive routes from the stop sequence along the named main roads
  // (major/tertiary roads): stops are grouped by their nearest named main road and ordered along it.
  routesFrom = 'derived';
  const mainSegs = roads.filter((r) => r.name && r.k <= 1);
  const byStreet = new Map();
  busStops.forEach((s, i) => {
    let best = null, bd = (30 * SCALE) ** 2;
    for (const r of mainSegs) for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((s.lx - ax) * dx + (s.ly - ay) * dy) / l2));
      const d = (ax + tt * dx - s.lx) ** 2 + (ay + tt * dy - s.ly) ** 2;
      if (d < bd) { bd = d; best = r.name; }
    }
    if (best) { if (!byStreet.has(best)) byStreet.set(best, []); byStreet.get(best).push(i); }
  });
  for (const [name, list] of byStreet) {
    if (list.length < 4) continue;
    // order along the dominant axis of the stops (principal direction of travel)
    const mx = list.reduce((a, i) => a + busStops[i].lx, 0) / list.length, my = list.reduce((a, i) => a + busStops[i].ly, 0) / list.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const i of list) { const dx = busStops[i].lx - mx, dy = busStops[i].ly - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
    list.sort((a, b) => (busStops[a].lx - mx) * ux + (busStops[a].ly - my) * uy - ((busStops[b].lx - mx) * ux + (busStops[b].ly - my) * uy));
    busRoutes.push({ id: `d-${busRoutes.length}`, ref: '', name: name, from: busStops[list[0]].name, to: busStops[list[list.length - 1]].name, stops: list, derived: true });
  }
}
busRoutes.forEach((r, ri) => r.stops.forEach((si) => { if (!busStops[si].routes.includes(ri)) busStops[si].routes.push(ri); }));
console.log(`bus: ${busStops.length} stops, ${busRoutes.length} routes (${routesFrom})`);

// --- traffic signals snapped to drive-graph nodes (flat [x, y, node, ...], one entry per graph node) ---
const trafficSignals = [];
{
  const seen = new Set();
  for (const el of tEls) {
    if (el.type !== 'node' || el.tags?.highway !== 'traffic_signals') continue;
    const p = proj(el.lat, el.lon);
    if (!inMap(p)) continue;
    const ni = snap(p, 25);
    if (ni < 0 || seen.has(ni)) continue;
    seen.add(ni);
    trafficSignals.push(drive.n[ni * 2], drive.n[ni * 2 + 1], ni);
  }
}
console.log(`traffic signals: ${trafficSignals.length / 3}`);

// --- taxi stands: amenity=taxi plus a fallback at Aarhus H ---
const taxiStands = [];
for (const el of tEls) {
  if (el.tags?.amenity !== 'taxi') continue;
  const p = tpos(el);
  if (!inMap(p)) continue;
  const ni = snap(p, 80);
  if (ni < 0) continue;
  taxiStands.push({ name: el.tags.name || 'Taxi stand', x: drive.n[ni * 2], y: drive.n[ni * 2 + 1], node: ni, src: 'osm' });
}
{
  const h = landmarks.aarhush;
  if (h && !taxiStands.some((s) => Math.hypot(s.x - h.x, s.y - h.y) < 120 * SCALE)) {
    taxiStands.push({ name: 'Aarhus H taxi rank', x: h.x, y: h.y, node: nearestDrive(h.x, h.y, 30), src: 'fallback' });
  }
}
console.log(`taxi stands: ${taxiStands.length}`);

// --- vehicle shops and rentals ---
const SHOP_KIND = { bicycle: 'bicycle', car: 'car', motorcycle: 'motorcycle' };
const vehicleShops = [];
for (const el of tEls) {
  const t = el.tags || {};
  const kind = SHOP_KIND[t.shop] || (t.amenity === 'car_rental' ? 'rental' : t.amenity === 'bicycle_rental' ? 'bikeRental' : null);
  if (!kind) continue;
  const p = tpos(el);
  if (!inMap(p)) continue;
  const ni = snap(p, 80);
  if (ni < 0) continue;
  const label = { bicycle: 'Bicycle shop', car: 'Car dealer', motorcycle: 'Motorcycle shop', rental: 'Car rental', bikeRental: 'Bike rental' }[kind];
  vehicleShops.push({ name: (t.name || label).trim(), kind, x: drive.n[ni * 2], y: drive.n[ni * 2 + 1], lx: Math.round(p[0]), ly: Math.round(p[1]), node: ni });
}
console.log(`vehicle shops: ${vehicleShops.length} (${Object.entries(vehicleShops.reduce((a, s) => ((a[s.kind] = (a[s.kind] || 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ')})`);
const speedHist = {};
for (const ch of drive.s) speedHist[parseInt(ch, 36) * 10] = (speedHist[parseInt(ch, 36) * 10] || 0) + 1;
console.log('drive edge speed limits (km/h: edges):', JSON.stringify(speedHist));

// ---------- write ----------
const out = {
  version: 1,
  city: cityId,
  name: city.name,
  scale: SCALE,
  width: WIDTH,
  height: HEIGHT,
  bbox: city.bbox,
  roadKinds: ROAD_KINDS,
  greenKinds: GREEN_KINDS,
  roads: roads.map((r) => [r.k, r.w, r.f, ...flat(dp(r.pts, 0.4 * SCALE))]),
  buildings,
  buildingMeta,
  buildingColours,
  buildingNames: Object.fromEntries(buildingNames.map((n, i) => [i, n]).filter((e) => e[1])),
  landmarkBuildings,
  landmarkOverlays,
  streets,
  roadStreet,
  districts,
  bikeLanes,
  bike,
  water,
  waterLines,
  sea: sea.map(flat),
  islands: islands.map(flat),
  green,
  pois,
  landmarks,
  drive,
  walk,
  busStops,
  busRoutes,
  trafficSignals,
  taxiStands,
  vehicleShops,
  generated: new Date().toISOString(),
  attribution: '© OpenStreetMap contributors (ODbL)',
};
await mkdir('public/maps', { recursive: true });
const json = JSON.stringify(out);
await writeFile(`public/maps/${cityId}.json`, json);
console.log(`Wrote public/maps/${cityId}.json (${(json.length / 1024 / 1024).toFixed(2)} MB): ${WIDTH}x${HEIGHT}px, ${roads.length} roads, ${buildings.length} buildings, ${water.length} water, ${green.length} green`);
