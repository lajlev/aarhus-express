// MapRenderer: draws the static city (ground, parks, water, roads, buildings)
// into pooled 1024px RenderTexture chunks baked on demand around the camera,
// plus a small whole-city 'minimap' texture usable from any scene.
import { DEPTH, PX } from '../config.js';

// Buildings: per-building roof palettes (OSM kind/levels/roof:* tags + district), pitched roofs with ridge lines,
// flat-roof details (vents, AC units, skylights, solar panels), level-based shadows, all deterministic per building
// index. Landmark footprints (map.landmarkBuildings) get a generated rooftop sprite (public/art/landmarks) fitted to
// the footprint's oriented bounding box and clipped to the polygon; overlays (map.landmarkOverlays) are stamped by
// coordinate. Clipped sprites are baked once to canvas textures `lmclip-*` and drawn into the chunk RenderTexture.

const CHUNK = 1024;
// Each chunk texture is baked PAD px larger on every side, so neighbouring chunks overlap and the bilinear-filtered
// edge texels (fractional camera scroll/zoom) never blend with transparent/background pixels (1px dark seam).
const PAD = 2;
const TEX = CHUNK + PAD * 2;
const POOL_MAX = 16;
const BAKES_PER_FRAME = 2;

export const PALETTE = {
  ground: 0xcfc7b4,
  green: [0x8db673, 0x79a862, 0x6b9657, 0x97b083, 0xbab3a6],
  water: 0x3d7fb8,
  waterEdge: 0x5f9bcc,
  sidewalk: 0xbdb3a1,
  kerb: 0x8f877a,
  asphalt: [0x4c4e55, 0x55575e, 0x5b5d63, 0x62646a], // by kind major,tertiary,minor,service
  pedestrian: 0xcbb99a,
  footway: 0xdcd3c0,
  cycleway: 0xb4675a,
  busway: 0x5e4f4f,
  dash: 0xe9e4d2,
  roofs: [
    [0xb5654a, 0xa65741, 0x9a5a48, 0x7d6a62, 0x6e7076, 0x8d5b4c, 0xc07a5a],
    [0x6fa597, 0x5f9488], // churches: copper
    [0xc9b48a, 0xb9a57c, 0xd2c09a], // public / culture
    [0x8a8d91, 0x9a9ca0, 0x7c8085], // industrial / commercial
  ],
};

const OLD = [0xb5503c, 0xa5442f, 0xc2623f, 0x9c4a38, 0xb8693f, 0xc98a4e, 0x8a6a58, 0x7d7a78];
const BRICK = [0x9a4a3c, 0x8c4438, 0xa65a46, 0x7f3f35, 0x6f6a68, 0x5f5e63, 0xa86a52];
const MODERN = [0xdedcd6, 0xc9c9c7, 0xb4b6b8, 0x9ea1a5, 0xe8e6e0, 0x8d9296];
const INDUSTRY = [0x8a8d91, 0x7c8085, 0x6f7e8a, 0x9a8a7a, 0x8f5a46, 0x5d6b78];
const MIXED = [0xb5654a, 0xa65741, 0x9a5a48, 0x7d6a62, 0x6e7076, 0x8d5b4c, 0xc07a5a];
const KIND_PAL = {
  1: [0x6fa597, 0x5f9488, 0x7aa89b],
  8: [0xa65a46, 0xb9a57c, 0x9a9ca0, 0x8c4438],
  9: [0xd8d6d0, 0xc9ccd0, 0xbfc3c8],
  11: [0x7d7a78, 0x6e7076, 0x8d8a85, 0x9a5a48, 0x6a6258],
  12: [0xc9b48a, 0xb9a57c, 0xd2c09a],
  13: [0x8a8d91, 0x9a9ca0, 0x7c8085],
};
const FLAT_PAL = [0x8a8d91, 0x9a9ca0, 0xa8a49a, 0x7c8085, 0x6f7276, 0xb0aca0];
// district -> style: 1 old town, 2 brick blocks, 3 modern, 4 harbour, 0 mixed
const DIST_STYLE = { 'Indre By': 1, Latinerkvarteret: 1, Midtbyen: 1, Frederiksbjerg: 2, 'Trøjborg': 2, Vesterbro: 2, 'Øgaderne': 2, 'Øgadekvarteret': 2, 'Nørre Stenbro': 2, Langenæs: 2, 'Aarhus Ø': 3, Havnen: 4 };
const H = (i, k) => (Math.imul(i + 1, 2654435761) ^ Math.imul(k + 7, 40503)) >>> 0; // deterministic per building
const R01 = (i, k) => (H(i, k) % 10007) / 10007;
const shade = (c, f) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

const DRIVE_KINDS = new Set([0, 1, 2, 3, 7]);

export class MapRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.map = world.map;
    this.cols = Math.ceil(world.W / CHUNK);
    this.rows = Math.ceil(world.H / CHUNK);
    this._index();
    this.g = scene.make.graphics({ x: 0, y: 0 }, false);
    this.active = new Map(); // key -> { rt, key, lastUsed }
    this.pool = [];
    this.frame = 0;
  }

  // Assign each feature to the chunks its bbox overlaps.
  _index() {
    const n = this.cols * this.rows;
    const mk = () => Array.from({ length: n }, () => []);
    this.idx = { green: mk(), water: mk(), sea: mk(), islands: mk(), waterLines: mk(), roads: mk(), buildings: mk() };
    const add = (layer, arr, off, pad) => {
      arr.forEach((f, i) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = off; k < f.length; k += 2) {
          const x = f[k], y = f[k + 1];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        const p = pad(f);
        const c0 = Math.max(0, Math.floor((x0 - p) / CHUNK)), c1 = Math.min(this.cols - 1, Math.floor((x1 + p) / CHUNK));
        const r0 = Math.max(0, Math.floor((y0 - p) / CHUNK)), r1 = Math.min(this.rows - 1, Math.floor((y1 + p) / CHUNK));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.idx[layer][r * this.cols + c].push(i);
      });
    };
    const m = this.map;
    add('green', m.green, 1, () => 0);
    add('water', m.water, 0, () => 8);
    add('sea', m.sea, 0, () => 8);
    add('islands', m.islands, 0, () => 0);
    add('waterLines', m.waterLines, 1, (f) => f[0]);
    add('roads', m.roads, 3, (f) => f[1] / 2 + 3 * PX);
    add('buildings', m.buildings, 1, () => 12);
    // draw order for roads: footways first, then service..major
    const order = [5, 6, 4, 7, 3, 2, 1, 0];
    this.roadRank = (k) => order.indexOf(k);
    for (const list of this.idx.roads) list.sort((a, b) => this.roadRank(m.roads[a][0]) - this.roadRank(m.roads[b][0]));
    this._prepBuildings();
  }

  // Oriented bounding box, area and style per building (computed once).
  _prepBuildings() {
    const m = this.map, B = m.buildings, n = B.length;
    this.obb = new Float32Array(n * 6); // cx, cy, ux, uy, L, W (px)
    this.areaM = new Float32Array(n);
    this.fill = new Float32Array(n); // polygon area / obb area
    this.dstyle = new Uint8Array(n);
    const world = this.world;
    for (let i = 0; i < n; i++) {
      const b = B[i], np = (b.length - 1) / 2;
      let a2 = 0;
      for (let k = 0, j = np - 1; k < np; j = k++) a2 += (b[1 + j * 2] + b[1 + k * 2]) * (b[2 + j * 2] - b[2 + k * 2]);
      const area = Math.abs(a2 / 2);
      let best = Infinity, bu = 1, bv = 0, bx0 = 0, bx1 = 0, by0 = 0, by1 = 0;
      const step = np > 40 ? Math.ceil(np / 40) : 1;
      for (let e = 0; e < np; e += step) {
        const j = (e + 1) % np;
        let ux = b[1 + j * 2] - b[1 + e * 2], uy = b[2 + j * 2] - b[2 + e * 2];
        const l = Math.hypot(ux, uy);
        if (l < 1e-3) continue;
        ux /= l; uy /= l;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < np; k++) {
          const px = b[1 + k * 2], py = b[2 + k * 2];
          const u = px * ux + py * uy, v = -px * uy + py * ux;
          if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
        }
        const ar = (x1 - x0) * (y1 - y0);
        if (ar < best) { best = ar; bu = ux; bv = uy; bx0 = x0; bx1 = x1; by0 = y0; by1 = y1; }
      }
      let L = bx1 - bx0, Wd = by1 - by0, ux = bu, uy = bv;
      const cu = (bx0 + bx1) / 2, cv = (by0 + by1) / 2;
      const cx = cu * ux - cv * uy, cy = cu * uy + cv * ux;
      if (Wd > L) { const t = L; L = Wd; Wd = t; const tx = ux; ux = -uy; uy = tx; } // long axis = u
      if (ux < 0 || (ux === 0 && uy < 0)) { ux = -ux; uy = -uy; } // never upside down
      this.obb.set([cx, cy, ux, uy, L, Wd], i * 6);
      this.areaM[i] = area / (PX * PX);
      this.fill[i] = area / Math.max(1, L * Wd);
      this.dstyle[i] = DIST_STYLE[world.districtAt(cx, cy)] ?? 0;
    }
    // landmark lookup
    this.lmOf = new Map(); // building index -> { sprite, mode, id }
    for (const [id, L] of Object.entries(m.landmarkBuildings || {})) for (const bi of L.bi) this.lmOf.set(bi, { id, sprite: L.sprite, mode: L.mode });
    this.lmClips = new Map();
    this.stamp = null;
  }

  /** Call every frame from the Game scene. */
  update(camera) {
    this.frame++;
    const view = camera.worldView;
    const margin = 256;
    const c0 = Math.max(0, Math.floor((view.x - margin) / CHUNK)), c1 = Math.min(this.cols - 1, Math.floor((view.right + margin) / CHUNK));
    const r0 = Math.max(0, Math.floor((view.y - margin) / CHUNK)), r1 = Math.min(this.rows - 1, Math.floor((view.bottom + margin) / CHUNK));
    const needed = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) needed.push(r * this.cols + c);
    // visible chunks first (sorted by distance to view centre)
    const cx = view.centerX, cy = view.centerY;
    needed.sort((a, b) => this._chunkDist(a, cx, cy) - this._chunkDist(b, cx, cy));
    let baked = 0;
    for (const key of needed) {
      const ch = this.active.get(key);
      if (ch) { ch.lastUsed = this.frame; continue; }
      const visible = this._chunkVisible(key, view);
      if (!visible && baked >= BAKES_PER_FRAME) continue;
      if (visible || baked < BAKES_PER_FRAME) { this._bake(key); baked++; }
    }
    // evict least recently used beyond the pool limit
    if (this.active.size > POOL_MAX) {
      const sorted = [...this.active.values()].sort((a, b) => a.lastUsed - b.lastUsed);
      for (const ch of sorted.slice(0, this.active.size - POOL_MAX)) {
        if (ch.lastUsed === this.frame) continue;
        this.active.delete(ch.key);
        ch.rt.setVisible(false);
        this.pool.push(ch.rt);
      }
    }
  }

  /** Bake all chunks in view immediately (e.g. after a teleport). */
  warm(camera) {
    const v = camera.worldView;
    for (let r = Math.max(0, Math.floor(v.y / CHUNK)); r <= Math.min(this.rows - 1, Math.floor(v.bottom / CHUNK)); r++)
      for (let c = Math.max(0, Math.floor(v.x / CHUNK)); c <= Math.min(this.cols - 1, Math.floor(v.right / CHUNK)); c++) {
        const key = r * this.cols + c;
        if (!this.active.has(key)) this._bake(key);
      }
  }

  _chunkDist(key, x, y) {
    const c = key % this.cols, r = Math.floor(key / this.cols);
    return ((c + 0.5) * CHUNK - x) ** 2 + ((r + 0.5) * CHUNK - y) ** 2;
  }
  _chunkVisible(key, v) {
    const c = key % this.cols, r = Math.floor(key / this.cols);
    const x = c * CHUNK, y = r * CHUNK;
    return x < v.right && x + CHUNK > v.x && y < v.bottom && y + CHUNK > v.y;
  }

  _bake(key) {
    const c = key % this.cols, r = Math.floor(key / this.cols);
    const ox = c * CHUNK - PAD, oy = r * CHUNK - PAD;
    let rt = this.pool.pop();
    if (!rt) rt = this.scene.add.renderTexture(0, 0, TEX, TEX).setOrigin(0, 0).setDepth(DEPTH.map);
    rt.setPosition(ox, oy).setVisible(true);
    rt.clear();
    const g = this.g;
    g.clear();
    const t0 = performance.now();
    this._drawChunk(g, key); // terrain, roads, shadows
    rt.draw(g, -ox, -oy);
    this._overlays(rt, key, ox, oy);
    g.clear();
    this._drawRoofs(g, key);
    rt.draw(g, -ox, -oy);
    this._landmarkRoofs(rt, g, key, ox, oy);
    this.active.set(key, { rt, key, lastUsed: this.frame });
    this.bakeStats = this.bakeStats || { n: 0, total: 0, max: 0 };
    const dt = performance.now() - t0;
    this.bakeStats.n++; this.bakeStats.total += dt; if (dt > this.bakeStats.max) this.bakeStats.max = dt;
  }

  _poly(g, arr, off) {
    g.beginPath();
    g.moveTo(arr[off], arr[off + 1]);
    for (let i = off + 2; i < arr.length; i += 2) g.lineTo(arr[i], arr[i + 1]);
    g.closePath();
    g.fillPath();
  }

  _line(g, arr, off, w, color, alpha = 1, caps = true) {
    g.lineStyle(w, color, alpha);
    g.beginPath();
    g.moveTo(arr[off], arr[off + 1]);
    for (let i = off + 2; i < arr.length; i += 2) g.lineTo(arr[i], arr[i + 1]);
    g.strokePath();
    if (caps && w > 6) {
      g.fillStyle(color, alpha);
      for (let i = off; i < arr.length; i += 2) g.fillCircle(arr[i], arr[i + 1], w / 2);
    }
  }

  _dashes(g, arr, off, color) {
    g.lineStyle(PX * 0.25, color, 0.75);
    const dash = 3 * PX, gap = 4 * PX;
    let carry = 0;
    for (let i = off; i + 3 < arr.length; i += 2) {
      const ax = arr[i], ay = arr[i + 1], bx = arr[i + 2], by = arr[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      let t = carry;
      while (t < len) {
        const e = Math.min(t + dash, len);
        g.lineBetween(ax + ux * t, ay + uy * t, ax + ux * e, ay + uy * e);
        t += dash + gap;
      }
      carry = t - len;
    }
  }

  _drawChunk(g, key) {
    const m = this.map, I = this.idx;
    const c = key % this.cols, r = Math.floor(key / this.cols);
    g.fillStyle(PALETTE.ground, 1);
    g.fillRect(c * CHUNK - PAD, r * CHUNK - PAD, TEX, TEX);
    for (const i of I.green[key]) { const f = m.green[i]; g.fillStyle(PALETTE.green[f[0]] ?? PALETTE.green[0], 1); this._poly(g, f, 1); }
    g.fillStyle(PALETTE.water, 1);
    for (const i of I.sea[key]) this._poly(g, m.sea[i], 0);
    for (const i of I.water[key]) this._poly(g, m.water[i], 0);
    g.fillStyle(PALETTE.ground, 1);
    for (const i of I.islands[key]) this._poly(g, m.islands[i], 0);
    for (const i of I.waterLines[key]) { const f = m.waterLines[i]; this._line(g, f, 1, f[0], PALETTE.water); }

    const roads = I.roads[key].map((i) => m.roads[i]);
    // sidewalks + kerbs under drivable roads
    for (const f of roads) if (DRIVE_KINDS.has(f[0]) && f[0] !== 3) this._line(g, f, 3, f[1] + 4.5 * PX, PALETTE.kerb);
    for (const f of roads) if (DRIVE_KINDS.has(f[0]) && f[0] !== 3) this._line(g, f, 3, f[1] + 4 * PX, PALETTE.sidewalk);
    for (const f of roads) {
      const k = f[0];
      let col;
      if (k === 4) col = PALETTE.pedestrian;
      else if (k === 5) col = PALETTE.footway;
      else if (k === 6) col = PALETTE.cycleway;
      else if (k === 7) col = PALETTE.busway;
      else col = PALETTE.asphalt[k];
      this._line(g, f, 3, f[1], col);
    }
    for (const f of roads) if (f[0] <= 1 && f[1] >= 10 * PX) this._dashes(g, f, 3, PALETTE.dash);

    // building shadows (length by levels; landmarks a bit longer)
    const blds = I.buildings[key];
    g.fillStyle(0x000000, 0.22);
    for (const i of blds) {
      const b = m.buildings[i];
      const meta = m.buildingMeta ? m.buildingMeta[i] : 0;
      let lv = (meta >> 4) & 63;
      if (!lv) lv = this._defaultLevels(meta & 15, i);
      lv = Math.min(lv, 14);
      const lm = this.lmOf.has(i) ? 1.3 : 1;
      const sx = (3 + lv * 1.1) * lm, sy = (4.2 + lv * 1.5) * lm;
      if (lv >= 5) this._shadow(g, b, sx * 0.5, sy * 0.5);
      this._shadow(g, b, sx, sy);
    }
  }

  _shadow(g, b, dx, dy) {
    g.beginPath();
    g.moveTo(b[1] + dx, b[2] + dy);
    for (let k = 3; k < b.length; k += 2) g.lineTo(b[k] + dx, b[k + 1] + dy);
    g.closePath();
    g.fillPath();
  }

  _defaultLevels(kind, i) {
    switch (kind) {
      case 2: return 3 + (H(i, 1) % 3);
      case 3: case 4: return 2;
      case 5: case 6: case 10: return 2 + (H(i, 1) % 2);
      case 7: return 1 + (H(i, 1) % 2);
      case 8: case 9: case 12: return 3;
      case 11: return 1;
      case 1: return 5;
      default: return 2;
    }
  }

  _roofColour(i, cls, kind, style) {
    const colMap = this.map.buildingColours;
    const rc = colMap ? colMap[i] : undefined;
    let base;
    const r = R01(i, 3);
    if (rc !== undefined) base = rc;
    else if (KIND_PAL[kind]) { const pal = KIND_PAL[kind]; base = pal[(r * pal.length) | 0]; }
    else if (kind === 7 || cls === 3 && style === 4) base = INDUSTRY[(r * INDUSTRY.length) | 0];
    else if (kind === 5 || kind === 6 || kind === 10) base = style === 1 ? OLD[(r * OLD.length) | 0] : FLAT_PAL[(r * FLAT_PAL.length) | 0];
    else {
      const pal = style === 1 ? OLD : style === 2 ? BRICK : style === 3 ? MODERN : style === 4 ? INDUSTRY : MIXED;
      base = pal[(r * pal.length) | 0];
    }
    return shade(base, 0.9 + R01(i, 4) * 0.2);
  }

  _isPitched(i, kind, shape, style) {
    if (shape === 2 || shape === 3 || shape === 5) return true;
    if (shape === 1 || shape === 4 || shape === 6) return false;
    if (kind === 1 || kind === 3 || kind === 4) return this.areaM[i] < 700;
    if (kind === 11) return R01(i, 5) < 0.5;
    if (kind === 5 || kind === 6 || kind === 7 || kind === 10 || kind === 9 || kind === 13) return false;
    if (style === 3) return false;
    if (style === 1) return this.areaM[i] < 400;
    return this.areaM[i] < 160 || (kind === 2 && style === 2 && R01(i, 6) < 0.35 && this.areaM[i] < 600);
  }

  _quad(g, cx, cy, ux, uy, hl, hw) {
    const vx = -uy, vy = ux;
    g.beginPath();
    g.moveTo(cx - ux * hl - vx * hw, cy - uy * hl - vy * hw);
    g.lineTo(cx + ux * hl - vx * hw, cy + uy * hl - vy * hw);
    g.lineTo(cx + ux * hl + vx * hw, cy + uy * hl + vy * hw);
    g.lineTo(cx - ux * hl + vx * hw, cy - uy * hl + vy * hw);
    g.closePath();
    g.fillPath();
  }

  _inside(b, x, y) {
    let r = false;
    const n = (b.length - 1) / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = b[1 + i * 2], yi = b[2 + i * 2], xj = b[1 + j * 2], yj = b[2 + j * 2];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
    }
    return r;
  }

  // ordinary building roofs (landmark footprints are drawn later as sprites)
  _drawRoofs(g, key) {
    const m = this.map, blds = this.idx.buildings[key];
    const o = this.obb;
    for (const i of blds) {
      const b = m.buildings[i];
      const lm = this.lmOf.get(i);
      const meta = m.buildingMeta ? m.buildingMeta[i] : 0;
      const kind = meta & 15, shape = (meta >> 10) & 15, style = this.dstyle[i];
      const col = this._roofColour(i, b[0], kind, style);
      g.fillStyle(col, 1);
      this._poly(g, b, 1);
      if (lm) continue;
      const cx = o[i * 6], cy = o[i * 6 + 1], ux = o[i * 6 + 2], uy = o[i * 6 + 3], L = o[i * 6 + 4], Wd = o[i * 6 + 5];
      const area = this.areaM[i];
      const rect = this.fill[i] > 0.86;
      if (this._isPitched(i, kind, shape, style)) {
        if (rect && Wd > 6 * PX) {
          // two roof planes: the one facing up-left is lit
          const vx = -uy, vy = ux;
          const lit = (vx + vy) < 0 ? -1 : 1;
          const hw = Wd / 2 - 1, hl = L / 2 - 1;
          g.fillStyle(shade(col, 1.14), 1);
          this._quad(g, cx + vx * lit * hw / 2, cy + vy * lit * hw / 2, ux, uy, hl, hw / 2);
          g.fillStyle(shade(col, 0.8), 1);
          this._quad(g, cx - vx * lit * hw / 2, cy - vy * lit * hw / 2, ux, uy, hl, hw / 2);
          const hipped = shape === 3 || shape === 5 || (shape === 0 && R01(i, 7) < 0.4);
          g.lineStyle(2, shade(col, 0.62), 0.9);
          if (hipped && L > Wd * 1.1) {
            const rl = Math.max(0, L / 2 - Wd / 2);
            g.lineBetween(cx - ux * rl, cy - uy * rl, cx + ux * rl, cy + uy * rl);
            for (const sgn of [-1, 1]) for (const sv of [-1, 1]) g.lineBetween(cx + sgn * ux * rl, cy + sgn * uy * rl, cx + sgn * ux * hl + sv * vx * hw, cy + sgn * uy * hl + sv * vy * hw);
          } else {
            g.lineBetween(cx - ux * hl, cy - uy * hl, cx + ux * hl, cy + uy * hl);
          }
        } else if (Wd > 5 * PX) {
          g.lineStyle(2, shade(col, 0.65), 0.8);
          g.lineBetween(cx - ux * L * 0.35, cy - uy * L * 0.35, cx + ux * L * 0.35, cy + uy * L * 0.35);
        }
        // chimney on small pitched roofs
        if (area < 220 && R01(i, 8) < 0.6) { g.fillStyle(0x3a302c, 1); this._quad(g, cx + ux * L * 0.25, cy + uy * L * 0.25, ux, uy, 5, 5); }
      } else if (area > 110 && Wd > 6 * PX) {
        // flat roof: parapet rim + equipment
        g.lineStyle(3, shade(col, 1.18), 0.55);
        g.beginPath();
        g.moveTo(b[1], b[2]);
        for (let k = 3; k < b.length; k += 2) g.lineTo(b[k], b[k + 1]);
        g.closePath();
        g.strokePath();
        const vx = -uy, vy = ux;
        const cnt = Math.min(7, 1 + ((area / 140) | 0));
        let placed = 0;
        for (let n = 0; n < cnt * 3 && placed < cnt; n++) {
          const t = H(i, 20 + n);
          const pu = (((t % 1000) / 1000) - 0.5) * (L - 8 * PX) * 0.9;
          const pv = ((((t >> 10) % 1000) / 1000) - 0.5) * (Wd - 8 * PX) * 0.9;
          const x = cx + ux * pu + vx * pv, y = cy + uy * pu + vy * pv;
          const type = (t >> 20) % 4;
          const hl = type === 3 ? 3.2 * PX : type === 2 ? 2.2 * PX : 1.4 * PX, hw = type === 3 ? 1.8 * PX : type === 2 ? 1.1 * PX : 1.2 * PX;
          if (!this._inside(b, x + ux * hl + vx * hw, y + uy * hl + vy * hw) || !this._inside(b, x - ux * hl - vx * hw, y - uy * hl - vy * hw) ||
              !this._inside(b, x + ux * hl - vx * hw, y + uy * hl - vy * hw) || !this._inside(b, x - ux * hl + vx * hw, y - uy * hl + vy * hw)) continue;
          placed++;
          if (type === 0) { g.fillStyle(shade(col, 0.55), 1); this._quad(g, x, y, ux, uy, hl, hw); g.fillStyle(shade(col, 1.25), 1); this._quad(g, x, y, ux, uy, hl * 0.6, hw * 0.6); }
          else if (type === 1) { g.fillStyle(0x8f949a, 1); this._quad(g, x, y, ux, uy, hl, hw); g.fillStyle(0x3a3d42, 1); g.fillCircle(x, y, hw * 0.55); }
          else if (type === 2) { g.fillStyle(0x9ed0e6, 1); this._quad(g, x, y, ux, uy, hl, hw); g.lineStyle(1, 0x4a6f84, 1); g.lineBetween(x - vx * hw, y - vy * hw, x + vx * hw, y + vy * hw); }
          else { // solar panel row
            g.fillStyle(0x24324f, 1); this._quad(g, x, y, ux, uy, hl, hw);
            g.lineStyle(1, 0x6f86b0, 0.9);
            for (let q = -1; q <= 1; q++) g.lineBetween(x + ux * q * hl * 0.5 - vx * hw, y + uy * q * hl * 0.5 - vy * hw, x + ux * q * hl * 0.5 + vx * hw, y + uy * q * hl * 0.5 + vy * hw);
          }
        }
      }
    }
    // outlines
    g.lineStyle(2, 0x2a2320, 0.45);
    for (const i of blds) {
      if (this.lmOf.has(i)) continue;
      const b = m.buildings[i];
      g.beginPath();
      g.moveTo(b[1], b[2]);
      for (let k = 3; k < b.length; k += 2) g.lineTo(b[k], b[k + 1]);
      g.closePath();
      g.strokePath();
    }
  }

  // ---- landmark sprites ----
  _stampImage() {
    if (!this.stamp) this.stamp = this.scene.make.image({ x: 0, y: 0, key: '__DEFAULT' }, false);
    return this.stamp;
  }

  _overlays(rt, key, ox, oy) {
    const list = this.map.landmarkOverlays;
    if (!list) return;
    for (const o of list) {
      const tk = `lmart-${o.sprite}`;
      if (!this.scene.textures.exists(tk)) continue;
      if (o.x + o.w / 2 < ox || o.x - o.w / 2 > ox + TEX || o.y + o.h / 2 < oy || o.y - o.h / 2 > oy + TEX) continue;
      const im = this._stampImage();
      im.setTexture(tk).setOrigin(0.5).setDisplaySize(o.w, o.h).setRotation((o.rot * Math.PI) / 180);
      rt.draw(im, o.x - ox, o.y - oy);
    }
  }

  /** Canvas texture of the sprite fitted to (or sampled for) building i and clipped to its polygon. null if the art is missing. */
  _clip(i) {
    let c = this.lmClips.get(i);
    if (c !== undefined) return c;
    c = null;
    const lm = this.lmOf.get(i);
    const art = lm && this.scene.textures.exists(`lmart-${lm.sprite}`) ? this.scene.textures.get(`lmart-${lm.sprite}`).getSourceImage() : null;
    if (art) {
      const b = this.map.buildings[i];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 1; k < b.length; k += 2) { x0 = Math.min(x0, b[k]); x1 = Math.max(x1, b[k]); y0 = Math.min(y0, b[k + 1]); y1 = Math.max(y1, b[k + 1]); }
      x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2;
      const w = Math.ceil(x1 - x0) + 2, h = Math.ceil(y1 - y0) + 2;
      const tk = `lmclip-${i}`;
      if (this.scene.textures.exists(tk)) this.scene.textures.remove(tk);
      const tex = this.scene.textures.createCanvas(tk, w, h);
      const ctx = tex.getContext();
      const o = this.obb;
      const cx = o[i * 6] - x0, cy = o[i * 6 + 1] - y0, ux = o[i * 6 + 2], uy = o[i * 6 + 3], L = o[i * 6 + 4], Wd = o[i * 6 + 5];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(b[1] - x0, b[2] - y0);
      for (let k = 3; k < b.length; k += 2) ctx.lineTo(b[k] - x0, b[k + 1] - y0);
      ctx.closePath();
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(uy, ux));
      if (lm.mode === 'fit') {
        // landscape sprite: long side along the footprint's long axis; portrait/square: stretch to the box
        ctx.drawImage(art, -L / 2, -Wd / 2, L, Wd);
      } else {
        // swatch: random crop of the sprite at ~1:1 (scaled up if the building is bigger than the art)
        const sc = Math.max(1, L / art.width, Wd / art.height);
        const cw = Math.min(art.width, L / sc), ch = Math.min(art.height, Wd / sc);
        const sx = R01(i, 31) * (art.width - cw), sy = R01(i, 32) * (art.height - ch);
        ctx.drawImage(art, sx, sy, cw, ch, -L / 2, -Wd / 2, L, Wd);
      }
      ctx.restore();
      tex.refresh();
      c = { key: tk, x: x0, y: y0 };
    }
    this.lmClips.set(i, c);
    return c;
  }

  _landmarkRoofs(rt, g, key, ox, oy) {
    if (!this.lmOf.size) return;
    const blds = this.idx.buildings[key];
    let any = false;
    for (const i of blds) {
      if (!this.lmOf.has(i)) continue;
      const c = this._clip(i);
      if (!c) continue;
      rt.draw(c.key, c.x - ox, c.y - oy);
      any = true;
    }
    // crisp outline + faint inner rim over the sprites
    g.clear();
    for (const i of blds) {
      if (!this.lmOf.has(i)) continue;
      const b = this.map.buildings[i];
      g.lineStyle(3, 0x2a2320, 0.7);
      g.beginPath();
      g.moveTo(b[1], b[2]);
      for (let k = 3; k < b.length; k += 2) g.lineTo(b[k], b[k + 1]);
      g.closePath();
      g.strokePath();
    }
    rt.draw(g, -ox, -oy);
    g.clear();
  }

  /**
   * Bake the whole city into a small dynamic texture `key` (for the minimap
   * and the big map). Scale = texture px per world px.
   */
  bakeMinimap(key = 'minimap', scale = 1 / 32) {
    const tm = this.scene.textures;
    if (tm.exists(key)) tm.remove(key);
    const w = Math.ceil(this.world.W * scale), h = Math.ceil(this.world.H * scale);
    const dt = tm.addDynamicTexture(key, w, h);
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    const m = this.map;
    const P = (arr, off) => {
      g.beginPath();
      g.moveTo(arr[off] * scale, arr[off + 1] * scale);
      for (let i = off + 2; i < arr.length; i += 2) g.lineTo(arr[i] * scale, arr[i + 1] * scale);
      g.closePath();
      g.fillPath();
    };
    g.fillStyle(0xbfb7a4, 1).fillRect(0, 0, w, h);
    g.fillStyle(0x86ad6c, 1); m.green.forEach((f) => P(f, 1));
    g.fillStyle(0x3d7fb8, 1); m.sea.forEach((f) => P(f, 0)); m.water.forEach((f) => P(f, 0));
    g.fillStyle(0xbfb7a4, 1); m.islands.forEach((f) => P(f, 0));
    g.fillStyle(0xa29a8a, 1); m.buildings.forEach((f) => P(f, 1));
    for (const f of m.roads) {
      if (!DRIVE_KINDS.has(f[0])) continue;
      const wpx = Math.max(1, f[1] * scale * (f[0] <= 1 ? 1.6 : 1.2));
      g.lineStyle(wpx, f[0] <= 1 ? 0xfaf3df : 0xece6d6, 1);
      g.beginPath();
      g.moveTo(f[3] * scale, f[4] * scale);
      for (let i = 5; i < f.length; i += 2) g.lineTo(f[i] * scale, f[i + 1] * scale);
      g.strokePath();
    }
    dt.draw(g, 0, 0);
    g.destroy();
    return { key, scale, width: w, height: h };
  }

  destroy() {
    for (const ch of this.active.values()) ch.rt.destroy();
    for (const rt of this.pool) rt.destroy();
    this.g.destroy();
  }
}
