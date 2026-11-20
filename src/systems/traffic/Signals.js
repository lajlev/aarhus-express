// Traffic lights. The map has 267 signal nodes (world.getTrafficSignals(), one per drive-graph node).
//  - Signals within SIG.CLUSTER of a seed signal share ONE controller (an intersection).
//  - Every incoming drive edge of a signal node is an "approach" with a stop line (gap before the node) and a lamp head on the
//    right-hand kerb. The approach's axis (0|1) comes from its heading relative to the first approach of its controller.
//  - Two-axis controllers cycle: axis 0 green, amber, all-red, axis 1 green, amber, all-red. Controllers with a single axis
//    (pedestrian-crossing style: 2-way straight road) get a long green and a short red.
//  - Rendering is pooled (lamp sprite + stop line per visible approach, culled to the camera view).
// Public: approach(from, to), stateOf(ap), redAge(ap), nearby(x, y, r, out), update(dt), destroy().
import { PX, DEPTH, TEX_RES } from '../../config.js';

export const SIG = {
  GREEN: 0, AMBER: 1, RED: 2,
  CLUSTER: 30 * PX, // signals closer than this share a controller
  G: 20, A: 3, R: 1.5, // two-axis cycle (seconds)
  GS: 26, RS: 9, // single-axis (crossing) cycle
  MIN_GAP: 5, MAX_GAP: 9, // stop line distance before the node (m)
  MAX_VIEW: 48, // max lamp sprites in the pool
};
const CELL = 512;
const LAMP_W = 30, LAMP_H = 12; // world px of the lamp texture

function makeTextures(scene) {
  if (scene.textures.exists('sigl-2')) return;
  const cols = [0x3dff8a, 0xffc233, 0xff3d3d]; // green, amber, red (lit)
  const S2 = TEX_RES;
  for (let st = 0; st < 3; st++) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const W = LAMP_W * S2, H = LAMP_H * S2, cy = H / 2;
    const lampX = [W / 2 - 7 * S2, W / 2, W / 2 + 7 * S2]; // green, amber, red along the travel direction
    // halo of the lit lamp
    for (let k = 5; k >= 1; k--) g.fillStyle(cols[st], 0.07 * (6 - k)).fillCircle(lampX[st], cy, (3 + k * 1.3) * S2);
    // housing
    g.fillStyle(0x000000, 0.35).fillRoundedRect(W / 2 - 12 * S2 + 1, cy - 3.5 * S2 + 2, 24 * S2, 7 * S2, 3 * S2);
    g.fillStyle(0x14171c, 1).fillRoundedRect(W / 2 - 12 * S2, cy - 3.5 * S2, 24 * S2, 7 * S2, 3 * S2);
    g.lineStyle(1, 0x3a4150, 1).strokeRoundedRect(W / 2 - 12 * S2, cy - 3.5 * S2, 24 * S2, 7 * S2, 3 * S2);
    for (let i = 0; i < 3; i++) {
      const lit = i === st;
      g.fillStyle(lit ? cols[i] : (i === 0 ? 0x16301f : i === 1 ? 0x3a2f14 : 0x3a1616), 1).fillCircle(lampX[i], cy, 2.4 * S2);
      if (lit) g.fillStyle(0xffffff, 0.8).fillCircle(lampX[i] - 0.6 * S2, cy - 0.6 * S2, 0.8 * S2);
    }
    g.generateTexture(`sigl-${st}`, Math.ceil(W), Math.ceil(H));
    g.destroy();
  }
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1).fillRect(0, 0, 8, 4);
  g.generateTexture('sigl-line', 8, 4);
  g.destroy();
}

export class TrafficSignals {
  constructor(ctx) {
    this.ctx = ctx;
    this.world = ctx.world;
    this.t = 0;
    this.ctrls = [];
    this.aps = [];
    this.byNode = new Map(); // node -> [approach]
    this.cells = new Map();
    this._build();
    makeTextures(ctx.scene);
    this.lamps = []; this.lines = [];
    this._vis = new Set();
  }

  // ---------------------------------------------------------------- build
  _build() {
    const w = this.world, g = w.drive, sigs = w.getTrafficSignals();
    if (!sigs.length || !g.count) return;
    const sigNode = new Int32Array(g.count).fill(-1);
    sigs.forEach((s, i) => { sigNode[s.node] = i; });
    // greedy clusters around seeds
    const cl = new Int32Array(sigs.length).fill(-1);
    let nc = 0;
    for (let i = 0; i < sigs.length; i++) {
      if (cl[i] >= 0) continue;
      cl[i] = nc;
      for (let j = i + 1; j < sigs.length; j++) {
        if (cl[j] < 0 && Math.hypot(sigs[j].x - sigs[i].x, sigs[j].y - sigs[i].y) < SIG.CLUSTER) cl[j] = nc;
      }
      nc++;
    }
    const ctrls = Array.from({ length: nc }, (_, id) => ({ id, ref: null, axes: 0, cycle: 49, G: SIG.G, A: SIG.A, start1: 0, off: 0, n: 0 }));
    // approaches = incoming directed edges of signal nodes
    for (let a = 0; a < g.count; a++) {
      for (const e of g.out[a]) {
        const si = sigNode[e.to];
        if (si < 0) continue;
        const dx = g.x[e.to] - g.x[a], dy = g.y[e.to] - g.y[a], len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const c = ctrls[cl[si]];
        const ang = Math.atan2(dy, dx);
        if (c.ref === null) c.ref = ang;
        let d = Math.abs(ang - c.ref) % Math.PI;
        if (d > Math.PI / 2) d = Math.PI - d;
        const axis = d < Math.PI / 4 ? 0 : 1;
        c.axes |= 1 << axis; c.n++;
        const ux = dx / len, uy = dy / len, rx = -uy, ry = ux;
        const gapM = Math.max(SIG.MIN_GAP, Math.min(SIG.MAX_GAP, e.w / PX / 2 + 2.5));
        const sx = g.x[e.to] - ux * gapM * PX, sy = g.y[e.to] - uy * gapM * PX;
        const kerb = e.w / 2 + 1.0 * PX;
        const ap = {
          node: e.to, from: a, ctrl: c, axis, dx: ux, dy: uy, w: e.w, gapM,
          sx, sy, ang, lx: sx + rx * kerb - ux * 0.4 * PX, ly: sy + ry * kerb - uy * 0.4 * PX,
          lineX: sx + rx * e.w / 4, lineY: sy + ry * e.w / 4, lineLen: e.w / 2 - 0.2 * PX,
          st: -1, lamp: null, line: null,
        };
        this.aps.push(ap);
        let l = this.byNode.get(e.to);
        if (!l) this.byNode.set(e.to, (l = []));
        l.push(ap);
        const k = Math.floor(sx / CELL) * 65536 + Math.floor(sy / CELL);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, (cell = []));
        cell.push(ap);
      }
    }
    for (const c of ctrls) {
      if (c.axes === 3) { c.cycle = 2 * (SIG.G + SIG.A + SIG.R); c.start1 = SIG.G + SIG.A + SIG.R; c.G = SIG.G; }
      else { c.cycle = SIG.GS + SIG.A + SIG.RS; c.G = SIG.GS; c.start1 = 0; }
      c.A = SIG.A;
      c.off = ((c.id * 2654435761) % 4096) / 4096 * c.cycle; // deterministic phase spread
    }
    this.ctrls = ctrls.filter((c) => c.n > 0);
  }

  // ---------------------------------------------------------------- queries
  /** Approach of the directed drive edge from -> to if `to` has a signal, else null. */
  approach(from, to) {
    const l = this.byNode.get(to);
    if (!l) return null;
    for (let i = 0; i < l.length; i++) if (l[i].from === from) return l[i];
    return null;
  }

  _u(ap) {
    const c = ap.ctrl;
    const u = (this.t + c.off - (ap.axis ? c.start1 : 0)) % c.cycle;
    return u < 0 ? u + c.cycle : u;
  }

  /** SIG.GREEN | AMBER | RED for this approach right now. */
  stateOf(ap) {
    const c = ap.ctrl, u = this._u(ap);
    return u < c.G ? 0 : u < c.G + c.A ? 1 : 2;
  }

  /** Seconds the approach has been red (negative when not red). */
  redAge(ap) {
    const c = ap.ctrl, u = this._u(ap);
    return u < c.G + c.A ? -1 : u - c.G - c.A;
  }

  /** Approaches whose stop line lies within r px of (x, y). Fills and returns `out`. */
  nearby(x, y, r, out) {
    out.length = 0;
    const R = Math.ceil(r / CELL), cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), r2 = r * r;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
      const l = this.cells.get((cx + dx) * 65536 + cy + dy);
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const ap = l[i];
        if ((ap.sx - x) ** 2 + (ap.sy - y) ** 2 < r2) out.push(ap);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.t += dt;
    const sc = this.ctx.scene, v = sc.cameras.main.worldView, m = 60;
    const x0 = v.x - m, y0 = v.y - m, x1 = v.x + v.width + m, y1 = v.y + v.height + m;
    const aps = this.aps;
    let used = 0;
    for (let i = 0; i < aps.length; i++) {
      const ap = aps[i];
      if (ap.lx < x0 || ap.lx > x1 || ap.ly < y0 || ap.ly > y1) {
        if (ap.lamp) this._release(ap);
        continue;
      }
      if (used >= SIG.MAX_VIEW * 2) break;
      used++;
      if (!ap.lamp) this._acquire(ap);
      const st = this.stateOf(ap);
      if (st !== ap.st) { ap.st = st; ap.lamp.setTexture(`sigl-${st}`); }
    }
  }

  _acquire(ap) {
    const sc = this.ctx.scene;
    const lamp = this.lamps.pop() || sc.add.image(0, 0, 'sigl-2').setScale(1 / TEX_RES).setDepth(DEPTH.vehicle + 1);
    const line = this.lines.pop() || sc.add.image(0, 0, 'sigl-line').setDepth(DEPTH.marker).setAlpha(0.8);
    lamp.setPosition(ap.lx, ap.ly).setRotation(ap.ang).setVisible(true);
    line.setPosition(ap.lineX, ap.lineY).setRotation(ap.ang + Math.PI / 2).setDisplaySize(ap.lineLen, 3).setVisible(true);
    ap.lamp = lamp; ap.line = line; ap.st = -1;
  }

  _release(ap) {
    ap.lamp.setVisible(false); ap.line.setVisible(false);
    this.lamps.push(ap.lamp); this.lines.push(ap.line);
    ap.lamp = null; ap.line = null;
  }

  destroy() {
    for (const ap of this.aps) { ap.lamp = null; ap.line = null; }
    for (const o of this.lamps) o.destroy();
    for (const o of this.lines) o.destroy();
    this.lamps.length = 0; this.lines.length = 0;
  }
}
