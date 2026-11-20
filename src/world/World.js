// World: map data + spatial queries (collision, surfaces, road graphs, LOS).
// Owned by the foundation. Pure logic, no Phaser display objects.
//
// Map-knowledge API (streets, districts, landmarks, bikes):
//   streetAt(x, y, maxPx = 200)      nearest NAMED road within ~25 m, as a string or null. Spatially indexed and
//                                    cached (re-uses the last answer while the query point moves < 16 px), so it is
//                                    cheap to call every frame.
//   districtAt(x, y)                 district name ('Indre By', 'Latinerkvarteret', 'Frederiksbjerg', ...), weighted nearest seed
//   nearestLandmark(x, y, radiusPx)  { id, name, x, y, dist } for the closest named landmark building/overlay whose
//                                    footprint is within radiusPx (distance to its bounding box), or null
//   getBikeGraph()                   graph (same shape as drive/walk: count, x, y, out, und, nearest, path ...) of cycle
//                                    infrastructure only (highway=cycleway + roads with cycleway=* tags)
//   getBikeLanes()                   [{ type, pts: Float32Array [x0,y0,...] }], type 0 separate cycleway, 1 track,
//                                    2 painted lane, 3 shared lane / busway
//   buildingInfo(i)                  { kind, levels, shape, colour } packed OSM data of building i (see build-map.mjs)
//   resolveHome(cfg)                 snaps data/home.js config to a building + street door; result in `world.home`
//   --- transport / vehicle map data (scripts/build-map.mjs, see ARCHITECTURE.md "Realistic mode & options") ---
//   getBusStops()                    [{ id, name, x, y, lx, ly, node, routes: [routeIdx] }]  (x,y = snapped drive node)
//   getBusRoutes()                   [{ id, ref, name, from, to, stops: [stopIdx], derived }]  ordered stop sequence
//   getTrafficSignals()              [{ x, y, node }]  highway=traffic_signals snapped to drive-graph nodes
//   edgeSpeedLimit(edge)             km/h of drive-graph edge index `edge` (edge i = drive.e[i*4..i*4+3])
//   speedLimitAt(x, y)               km/h of the nearest drive edge (cached, cheap per frame); 50 if none near
//   getTaxiStands()                  [{ name, x, y, node, src }]  amenity=taxi plus a fallback at Aarhus H
//   getVehicleShops()                [{ name, kind: 'bicycle'|'car'|'motorcycle'|'rental'|'bikeRental', x, y, lx, ly, node }]
import { PX } from '../config.js';
import { MinHeap } from '../core/math.js';

export const F_BUILD = 1;
export const F_ROAD = 2; // drivable road surface
export const F_WATER = 4;
export const F_GREEN = 8;
export const F_FOOT = 16; // footway / pedestrian street / cycleway

const GRID = 16; // occupancy cell size in px (2 m)
const SEG_CELL = 128; // building-edge hash cell (16 m)
const NODE_CELL = 256; // graph node hash cell (32 m)

export class World {
  /** @param {object} map parsed public/maps/<city>.json */
  constructor(map) {
    this.map = map;
    this.W = map.width;
    this.H = map.height;
    this.landmarks = map.landmarks;
    this.pois = map.pois;
    this.gw = Math.ceil(this.W / GRID);
    this.gh = Math.ceil(this.H / GRID);
    this.grid = new Uint8Array(this.gw * this.gh);
    this._rasterize();
    this._buildSegments();
    this._buildStreetIndex();
    this._buildLandmarkIndex();
    this.drive = buildGraph(map.drive, true);
    this.walk = buildGraph(map.walk, false);
    this.home = null; // set by resolveHome()
    this._speedCache = { x: -1e9, y: -1e9, v: 50 };
  }

  // ---------------- occupancy grid ----------------
  _rasterize() {
    const m = this.map;
    for (const g of m.green) this._fillPoly(g, 1, F_GREEN, true);
    for (const w of m.water) this._fillPoly(w, 0, F_WATER, true);
    for (const s of m.sea) this._fillPoly(s, 0, F_WATER, true);
    for (const s of m.islands) this._fillPoly(s, 0, F_WATER, false);
    for (const l of m.waterLines) if (l[0] >= 6 * PX) this._stampLine(l, 1, l[0] / 2, F_WATER);
    for (const r of m.roads) {
      const drivable = r[0] <= 3 || r[0] === 7;
      this._stampLine(r, 3, r[1] / 2, drivable ? F_ROAD : F_FOOT);
    }
    for (const b of m.buildings) this._fillPoly(b, 1, F_BUILD, true);
  }

  _fillPoly(arr, off, flag, set) {
    const n = (arr.length - off) / 2;
    if (n < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { const y = arr[off + i * 2 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const r0 = Math.max(0, Math.floor(minY / GRID)), r1 = Math.min(this.gh - 1, Math.floor(maxY / GRID));
    const xs = [];
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * GRID;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = arr[off + i * 2], yi = arr[off + i * 2 + 1], xj = arr[off + j * 2], yj = arr[off + j * 2 + 1];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.round(xs[k] / GRID)), c1 = Math.min(this.gw - 1, Math.round(xs[k + 1] / GRID) - 1);
        const base = r * this.gw;
        if (set) for (let c = c0; c <= c1; c++) this.grid[base + c] |= flag;
        else for (let c = c0; c <= c1; c++) this.grid[base + c] &= ~flag;
      }
    }
  }

  _stampLine(arr, off, hw, flag) {
    for (let i = off; i + 3 < arr.length; i += 2) {
      const ax = arr[i], ay = arr[i + 1], bx = arr[i + 2], by = arr[i + 3];
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw) / GRID)), c1 = Math.min(this.gw - 1, Math.floor((Math.max(ax, bx) + hw) / GRID));
      const r0 = Math.max(0, Math.floor((Math.min(ay, by) - hw) / GRID)), r1 = Math.min(this.gh - 1, Math.floor((Math.max(ay, by) + hw) / GRID));
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      for (let r = r0; r <= r1; r++) {
        const py = (r + 0.5) * GRID;
        for (let c = c0; c <= c1; c++) {
          const px = (c + 0.5) * GRID;
          let t = ((px - ax) * dx + (py - ay) * dy) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + t * dx - px, ey = ay + t * dy - py;
          if (ex * ex + ey * ey <= hw * hw) this.grid[r * this.gw + c] |= flag;
        }
      }
    }
  }

  flagsAt(x, y) {
    const c = Math.floor(x / GRID), r = Math.floor(y / GRID);
    if (c < 0 || r < 0 || c >= this.gw || r >= this.gh) return F_BUILD; // outside = solid
    return this.grid[r * this.gw + c];
  }

  /** 'road' | 'foot' | 'water' | 'green' | 'ground' | 'building' */
  surfaceAt(x, y) {
    const f = this.flagsAt(x, y);
    if (f & F_BUILD) return 'building';
    if (f & F_ROAD) return 'road';
    if (f & F_FOOT) return 'foot';
    if (f & F_WATER) return 'water';
    if (f & F_GREEN) return 'green';
    return 'ground';
  }

  isBuilding(x, y) { return (this.flagsAt(x, y) & F_BUILD) !== 0; }
  isRoad(x, y) { return (this.flagsAt(x, y) & F_ROAD) !== 0; }
  /** Deep water = water not covered by a road/bridge. */
  isWater(x, y) { const f = this.flagsAt(x, y); return (f & F_WATER) !== 0 && (f & (F_ROAD | F_FOOT)) === 0; }

  // ---------------- building collision ----------------
  _buildSegments() {
    const segs = [];
    const segPoly = [];
    this.map.buildings.forEach((b, bi) => {
      const n = (b.length - 1) / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        segs.push(b[1 + i * 2], b[2 + i * 2], b[1 + j * 2], b[2 + j * 2]);
        segPoly.push(bi);
      }
    });
    this.segs = new Float32Array(segs);
    this.segPoly = new Int32Array(segPoly);
    this.sw = Math.ceil(this.W / SEG_CELL);
    this.sh = Math.ceil(this.H / SEG_CELL);
    this.segCells = new Array(this.sw * this.sh);
    for (let s = 0; s < this.segs.length / 4; s++) {
      const x1 = this.segs[s * 4], y1 = this.segs[s * 4 + 1], x2 = this.segs[s * 4 + 2], y2 = this.segs[s * 4 + 3];
      const c0 = Math.max(0, Math.floor(Math.min(x1, x2) / SEG_CELL)), c1 = Math.min(this.sw - 1, Math.floor(Math.max(x1, x2) / SEG_CELL));
      const r0 = Math.max(0, Math.floor(Math.min(y1, y2) / SEG_CELL)), r1 = Math.min(this.sh - 1, Math.floor(Math.max(y1, y2) / SEG_CELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = r * this.sw + c;
        (this.segCells[k] || (this.segCells[k] = [])).push(s);
      }
    }
    this._stamp = new Uint32Array(this.segs.length / 4);
    this._stampId = 0;
    this._cand = [];
  }

  _pointInBuilding(bi, x, y) {
    const b = this.map.buildings[bi];
    const n = (b.length - 1) / 2;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = b[1 + i * 2], yi = b[2 + i * 2], xj = b[1 + j * 2], yj = b[2 + j * 2];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  _closestOnSeg(s, px, py) {
    const ax = this.segs[s * 4], ay = this.segs[s * 4 + 1], bx = this.segs[s * 4 + 2], by = this.segs[s * 4 + 3];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return [ax + t * dx, ay + t * dy];
  }

  /**
   * Push a circle out of building walls and the world edge.
   * Returns { x, y, hit, nx, ny } where (nx, ny) is the unit push normal.
   */
  pushOut(x, y, r) {
    const out = { x, y, hit: false, nx: 0, ny: 0 };
    const sid = ++this._stampId;
    const cand = this._cand;
    cand.length = 0;
    const c0 = Math.max(0, Math.floor((x - r) / SEG_CELL)), c1 = Math.min(this.sw - 1, Math.floor((x + r) / SEG_CELL));
    const r0 = Math.max(0, Math.floor((y - r) / SEG_CELL)), r1 = Math.min(this.sh - 1, Math.floor((y + r) / SEG_CELL));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
      const list = this.segCells[rr * this.sw + cc];
      if (!list) continue;
      for (const s of list) {
        if (this._stamp[s] === sid) continue;
        this._stamp[s] = sid;
        cand.push(s);
      }
    }
    let px = x, py = y;
    // 1) deep penetration: centre inside a building -> move to its nearest edge
    if (cand.length && this.isBuilding(px, py)) {
      const seen = new Set();
      for (const s of cand) {
        const bi = this.segPoly[s];
        if (seen.has(bi)) continue;
        seen.add(bi);
        if (!this._pointInBuilding(bi, px, py)) continue;
        let best = null, bd = Infinity;
        for (const s2 of cand) {
          if (this.segPoly[s2] !== bi) continue;
          const q = this._closestOnSeg(s2, px, py);
          const d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
          if (d < bd) { bd = d; best = q; }
        }
        if (best) {
          const d = Math.sqrt(bd) || 1e-3;
          const ux = (best[0] - px) / d, uy = (best[1] - py) / d;
          px = best[0] + ux * r; py = best[1] + uy * r;
          out.hit = true;
        }
        break;
      }
    }
    // 2) regular overlap with walls
    for (let pass = 0; pass < 2; pass++) {
      for (const s of cand) {
        const [qx, qy] = this._closestOnSeg(s, px, py);
        const ex = px - qx, ey = py - qy;
        const d2 = ex * ex + ey * ey;
        if (d2 >= r * r || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = r - d;
        px += (ex / d) * push; py += (ey / d) * push;
        out.hit = true;
      }
    }
    // world bounds
    if (px < r) { px = r; out.hit = true; }
    if (py < r) { py = r; out.hit = true; }
    if (px > this.W - r) { px = this.W - r; out.hit = true; }
    if (py > this.H - r) { py = this.H - r; out.hit = true; }
    if (out.hit) {
      const mx = px - x, my = py - y, ml = Math.hypot(mx, my);
      if (ml > 1e-6) { out.nx = mx / ml; out.ny = my / ml; }
    }
    out.x = px; out.y = py;
    return out;
  }

  /** True when the straight line between two points is not blocked by buildings. */
  lineOfSight(x1, y1, x2, y2, step = 12) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.ceil(d / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.isBuilding(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  /** Find a free (non-building, non-water) spot near (x, y). */
  findFreeSpot(x, y, maxR = 200) {
    if (!this.isBuilding(x, y) && !this.isWater(x, y)) return { x, y };
    for (let r = 16; r <= maxR; r += 16) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (!this.isBuilding(px, py) && !this.isWater(px, py)) return { x: px, y: py };
      }
    }
    return { x, y };
  }

  landmark(id) { return this.landmarks[id] || null; }

  // ---------------- streets, districts, landmarks, bikes ----------------
  _buildStreetIndex() {
    const m = this.map, roads = m.roads, rs = m.roadStreet || [];
    this.streetNames = m.streets || [''];
    const segs = [], segRoad = [];
    this._sCells = new Map();
    for (let r = 0; r < roads.length; r++) {
      const f = roads[r];
      if (!rs[r] || (f[0] > 4 && f[0] !== 7)) continue; // skip footways / cycleways: their names are noise
      for (let i = 3; i + 3 < f.length; i += 2) {
        const id = segs.length / 4;
        segs.push(f[i], f[i + 1], f[i + 2], f[i + 3]);
        segRoad.push(rs[r]);
        const c0 = Math.floor(Math.min(f[i], f[i + 2]) / NODE_CELL), c1 = Math.floor(Math.max(f[i], f[i + 2]) / NODE_CELL);
        const r0 = Math.floor(Math.min(f[i + 1], f[i + 3]) / NODE_CELL), r1 = Math.floor(Math.max(f[i + 1], f[i + 3]) / NODE_CELL);
        for (let yy = r0; yy <= r1; yy++) for (let xx = c0; xx <= c1; xx++) {
          const k = xx * 65536 + yy;
          let l = this._sCells.get(k);
          if (!l) this._sCells.set(k, (l = []));
          l.push(id);
        }
      }
    }
    this._sSegs = new Float32Array(segs);
    this._sSegStreet = new Int32Array(segRoad);
    this._streetCache = { x: -1e9, y: -1e9, v: null };
    this._distCache = { x: -1e9, y: -1e9, v: '' };
    this.districtSeeds = (m.districts || []).map(([n, x, y, bias]) => ({ n, x, y, bias }));
  }

  streetAt(x, y, maxPx = 25 * PX) {
    const c = this._streetCache;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < 256 && c.max === maxPx) return c.v;
    const cx = Math.floor(x / NODE_CELL), cy = Math.floor(y / NODE_CELL), R = Math.ceil(maxPx / NODE_CELL);
    let best = 0, bd = maxPx * maxPx;
    const S = this._sSegs;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
      const l = this._sCells.get((cx + dx) * 65536 + cy + dy);
      if (!l) continue;
      for (const s of l) {
        const ax = S[s * 4], ay = S[s * 4 + 1], bx = S[s * 4 + 2], by = S[s * 4 + 3];
        const ddx = bx - ax, ddy = by - ay, l2 = ddx * ddx + ddy * ddy || 1;
        let t = ((x - ax) * ddx + (y - ay) * ddy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * ddx - x, ey = ay + t * ddy - y, d = ex * ex + ey * ey;
        if (d < bd) { bd = d; best = this._sSegStreet[s]; }
      }
    }
    c.x = x; c.y = y; c.max = maxPx; c.v = best ? this.streetNames[best] : null;
    return c.v;
  }

  districtAt(x, y) {
    const c = this._distCache;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < 1024) return c.v;
    let best = '', bd = Infinity;
    for (const d of this.districtSeeds) {
      const v = Math.hypot(d.x - x, d.y - y) - d.bias;
      if (v < bd) { bd = v; best = d.n; }
    }
    c.x = x; c.y = y; c.v = best;
    return best;
  }

  _buildLandmarkIndex() {
    const m = this.map, list = [];
    for (const [id, L] of Object.entries(m.landmarkBuildings || {})) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const bi of L.bi) {
        const b = m.buildings[bi];
        for (let k = 1; k < b.length; k += 2) { x0 = Math.min(x0, b[k]); x1 = Math.max(x1, b[k]); y0 = Math.min(y0, b[k + 1]); y1 = Math.max(y1, b[k + 1]); }
      }
      list.push({ id, name: L.label, x0, y0, x1, y1 });
    }
    for (const o of m.landmarkOverlays || []) list.push({ id: o.id, name: o.label, x0: o.x - o.w / 2, y0: o.y - o.h / 2, x1: o.x + o.w / 2, y1: o.y + o.h / 2 });
    this._lmList = list;
    this._lmGroups = null;
  }

  nearestLandmark(x, y, radius = 60 * PX) {
    let best = null, bd = radius;
    for (const L of this._lmList) {
      const dx = Math.max(L.x0 - x, 0, x - L.x1), dy = Math.max(L.y0 - y, 0, y - L.y1);
      const d = Math.hypot(dx, dy);
      if (d <= bd) { bd = d; best = L; }
    }
    return best ? { id: best.id, name: best.name, x: (best.x0 + best.x1) / 2, y: (best.y0 + best.y1) / 2, dist: bd } : null;
  }

  buildingInfo(i) {
    const v = this.map.buildingMeta?.[i] || 0;
    return { kind: v & 15, levels: (v >> 4) & 63, shape: (v >> 10) & 15, colour: this.map.buildingColours?.[i] ?? -1 };
  }

  // ---------------- home ----------------
  /**
   * Snap a home config ({ id, name, lat, lon }) to the nearest building and find its street door.
   * Sets and returns `this.home` ({ id, name, street, district, x, y, bx, by, angle, parkX, parkY }), or null
   * if no building is within 80 m.
   */
  resolveHome(cfg) {
    if (!cfg) return null;
    const b = this.map.bbox, S = this.map.scale || PX;
    const midLat = ((b.south + b.north) / 2) * (Math.PI / 180);
    const hx = (cfg.lon - b.west) * 111320 * Math.cos(midLat) * S, hy = (b.north - cfg.lat) * 111132 * S;
    let bi = -1, bd = (80 * PX) ** 2, bcx = hx, bcy = hy;
    this.map.buildings.forEach((poly, i) => {
      let sx = 0, sy = 0; const n = (poly.length - 1) / 2;
      for (let k = 1; k < poly.length; k += 2) { sx += poly[k]; sy += poly[k + 1]; }
      sx /= n; sy /= n;
      const d = (sx - hx) ** 2 + (sy - hy) ** 2;
      if (d < bd) { bd = d; bi = i; bcx = sx; bcy = sy; }
    });
    if (bi < 0) return null;
    // street side: the road node closest to the building decides which wall is the "front"
    const g = this.drive;
    const nn = g.nearest(bcx, bcy, 70 * PX);
    let dx = 0, dy = 1;
    if (nn >= 0) { dx = g.x[nn] - bcx; dy = g.y[nn] - bcy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
    let ex = bcx, ey = bcy;
    for (let t = 0; t < 400; t++) { // walk out of the building along the street direction
      ex += dx * 4; ey += dy * 4;
      if (!this.isBuilding(ex, ey)) break;
    }
    ex += dx * 1.2 * PX; ey += dy * 1.2 * PX; // one step onto the pavement
    const door = this.findFreeSpot(ex, ey, 160);
    const ang = Math.atan2(dy, dx);
    // parking spot for a bike / car along the street, a few metres to the side of the door
    const sideX = -dy, sideY = dx;
    const park = this.findFreeSpot(door.x + sideX * 4.5 * PX, door.y + sideY * 4.5 * PX, 160);
    this.home = {
      id: cfg.id, name: cfg.name, bi, bx: Math.round(bcx), by: Math.round(bcy),
      x: Math.round(door.x), y: Math.round(door.y), angle: ang,
      parkX: Math.round(park.x), parkY: Math.round(park.y),
      street: this.streetAt(door.x, door.y), district: this.districtAt(door.x, door.y),
    };
    return this.home;
  }

  // ---------------- transport / vehicle map data ----------------
  getBusStops() { return this.map.busStops || []; }
  getBusRoutes() { return this.map.busRoutes || []; }
  /** [{ x, y, node }]; the map stores them flat as [x, y, node, ...]. */
  getTrafficSignals() {
    if (!this._signals) {
      const f = this.map.trafficSignals || [];
      this._signals = [];
      for (let i = 0; i + 2 < f.length; i += 3) this._signals.push({ x: f[i], y: f[i + 1], node: f[i + 2] });
    }
    return this._signals;
  }
  getTaxiStands() { return this.map.taxiStands || []; }
  getVehicleShops() { return this.map.vehicleShops || []; }

  /** km/h of drive-graph edge `edge` (index into drive.e / 4). Defaults to 50 (urban) when the map has no data. */
  edgeSpeedLimit(edge) {
    const s = this.map.drive.s;
    if (!s || edge < 0 || edge >= s.length) return 50;
    return parseInt(s[edge], 36) * 10;
  }

  /** km/h speed limit at a world point: the nearest drive edge within ~30 m (cached while the point moves < 16 px). */
  speedLimitAt(x, y) {
    const c = this._speedCache;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < 256) return c.v;
    if (!this._edgeCells) this._buildEdgeIndex();
    const cx = Math.floor(x / NODE_CELL), cy = Math.floor(y / NODE_CELL);
    let best = -1, bd = (30 * PX) ** 2;
    const g = this.drive, e = this.map.drive.e;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = this._edgeCells.get((cx + dx) * 65536 + cy + dy);
      if (!l) continue;
      for (const i of l) {
        const a = e[i * 4], b = e[i * 4 + 1];
        const ax = g.x[a], ay = g.y[a], ddx = g.x[b] - ax, ddy = g.y[b] - ay, l2 = ddx * ddx + ddy * ddy || 1;
        let t = ((x - ax) * ddx + (y - ay) * ddy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + t * ddx - x, qy = ay + t * ddy - y, d = qx * qx + qy * qy;
        if (d < bd) { bd = d; best = i; }
      }
    }
    c.x = x; c.y = y; c.v = best >= 0 ? this.edgeSpeedLimit(best) : 50;
    return c.v;
  }

  _buildEdgeIndex() {
    this._edgeCells = new Map();
    const g = this.drive, e = this.map.drive.e;
    for (let i = 0; i < e.length / 4; i++) {
      const a = e[i * 4], b = e[i * 4 + 1];
      const c0 = Math.floor(Math.min(g.x[a], g.x[b]) / NODE_CELL), c1 = Math.floor(Math.max(g.x[a], g.x[b]) / NODE_CELL);
      const r0 = Math.floor(Math.min(g.y[a], g.y[b]) / NODE_CELL), r1 = Math.floor(Math.max(g.y[a], g.y[b]) / NODE_CELL);
      for (let yy = r0; yy <= r1; yy++) for (let xx = c0; xx <= c1; xx++) {
        const k = xx * 65536 + yy;
        let l = this._edgeCells.get(k);
        if (!l) this._edgeCells.set(k, (l = []));
        l.push(i);
      }
    }
  }

  getBikeGraph() {
    if (!this._bike) this._bike = buildGraph(this.map.bike || { n: [], e: [] }, false);
    return this._bike;
  }

  getBikeLanes() {
    if (!this._bikeLanes) this._bikeLanes = (this.map.bikeLanes || []).map((f) => ({ type: f[0], pts: Float32Array.from(f.slice(1)) }));
    return this._bikeLanes;
  }
}

// ---------------- road graphs ----------------
/**
 * Graph shape:
 *  { count, x: Float32Array, y: Float32Array,
 *    out: Array<Array<{to, w}>>  directed adjacency (respects oneway for drive),
 *    und: Array<Array<{to, w}>>  undirected adjacency,
 *    nearest(x, y, maxDist), randomNodeInRing(x, y, rMin, rMax), path(a, b) }
 * `w` is the road width in px (useful for lane offsets).
 */
function buildGraph(g, directed) {
  const count = g.n.length / 2;
  const x = new Float32Array(count), y = new Float32Array(count);
  for (let i = 0; i < count; i++) { x[i] = g.n[i * 2]; y[i] = g.n[i * 2 + 1]; }
  const out = Array.from({ length: count }, () => []);
  const und = Array.from({ length: count }, () => []);
  for (let i = 0; i < g.e.length; i += 4) {
    const a = g.e[i], b = g.e[i + 1], oneway = g.e[i + 2], w = g.e[i + 3];
    out[a].push({ to: b, w });
    if (!directed || !oneway) out[b].push({ to: a, w });
    und[a].push({ to: b, w });
    und[b].push({ to: a, w });
  }
  const cells = new Map();
  for (let i = 0; i < count; i++) {
    const k = Math.floor(x[i] / NODE_CELL) * 65536 + Math.floor(y[i] / NODE_CELL);
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push(i);
  }
  const graph = { count, x, y, out, und };
  graph.nearest = (px, py, maxDist = 400) => {
    const R = Math.ceil(maxDist / NODE_CELL);
    const cx = Math.floor(px / NODE_CELL), cy = Math.floor(py / NODE_CELL);
    let best = -1, bd = maxDist * maxDist;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
      const l = cells.get((cx + dx) * 65536 + cy + dy);
      if (!l) continue;
      for (const i of l) {
        const d = (x[i] - px) ** 2 + (y[i] - py) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };
  graph.randomNodeInRing = (px, py, rMin, rMax, tries = 24) => {
    for (let t = 0; t < tries; t++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const n = graph.nearest(px + Math.cos(a) * r, py + Math.sin(a) * r, 300);
      if (n < 0) continue;
      const d = Math.hypot(x[n] - px, y[n] - py);
      if (d >= rMin && d <= rMax) return n;
    }
    return -1;
  };
  /** A* over the undirected graph. Returns node index array or null. */
  graph.path = (start, goal, maxExpand = 6000) => {
    if (start < 0 || goal < 0) return null;
    const came = new Map([[start, -1]]);
    const gScore = new Map([[start, 0]]);
    const open = new MinHeap();
    open.push(start, 0);
    let expanded = 0;
    while (open.size && expanded++ < maxExpand) {
      const cur = open.pop();
      if (cur === goal) {
        const p = [];
        for (let n = goal; n !== -1; n = came.get(n)) p.push(n);
        return p.reverse();
      }
      const gc = gScore.get(cur);
      for (const { to } of und[cur]) {
        const ng = gc + Math.hypot(x[to] - x[cur], y[to] - y[cur]);
        if (ng < (gScore.get(to) ?? Infinity)) {
          gScore.set(to, ng);
          came.set(to, cur);
          open.push(to, ng + Math.hypot(x[goal] - x[to], y[goal] - y[to]));
        }
      }
    }
    return null;
  };
  return graph;
}
