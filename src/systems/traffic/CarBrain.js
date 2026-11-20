// Per-vehicle driving AI: follows the directed drive graph in the right-hand
// lane, brakes for obstacles, slows for turns, honks, unsticks itself.
// Drives only by writing vehicle.input. No allocation in step().
import { PX } from '../../config.js';
import { clamp, angleDiff } from '../../core/math.js';
import { T } from './config.js';

const laneFor = (w) => clamp(w / 2 - 2.4 * PX, 1.1 * PX, 2.2 * PX);
/** Cyclist lane: kerb side, outside the car lane (bike lane / edge of the carriageway). */
export const bikeLaneFor = (w) => clamp(w / 2 - T.CYC_LANE_OFF * PX, 0.9 * PX, 6 * PX);
const cruiseFor = (w) => clamp(6 + (w / PX) * 0.9, 8, 15);

export function makeAi(v) {
  return {
    kind: 'traffic', g: null,
    cyc: !!v.def.cyclist, ph: Math.random() * 6.283, fallT: 0,
    from: -1, to: -1, next: -1, w: 0, nw: 0,
    ax: 0, ay: 0, dx: 1, dy: 0, rx: 0, ry: 1, len: 1, hdg: 0, lane: 0, s: 0,
    nbx: 0, nby: 0, ndx: 1, ndy: 0, nrx: 0, nry: 1, nlen: 1, nhdg: 0, nlane: 0,
    acc: Math.random() * 0.1, near: true,
    factor: 0.85 + Math.random() * 0.3,
    blockT: 0, stuckT: 0, stuckCount: 0, reverseT: 0, revSteer: 1,
    hornCd: 0, panic: 0, panicMode: null, rammedCd: 0,
    dead: false, blocker: 0, // 1 = player/ped, 2 = car
    lim: 0, nlim: 0, // speed limit (km/h) of this / the next edge; 0 = unknown (bike graph)
    ap: null, nap: null, goAp: null, sigHold: false, // traffic-light approach of this / the next edge, latched "run it", stopping for a signal
  };
}

export class CarBrain {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.world = sys.ctx.world;
    this.tmp = [];
    this.tmpP = [];
  }

  edgeW(a, b, g = this.world.drive) {
    const o = g.out[a];
    for (let i = 0; i < o.length; i++) if (o[i].to === b) return o[i].w;
    return 40;
  }

  /** Choose the node after `to`, preferring straight and (when far) the player. */
  pickNext(from, to, far, g = this.world.drive) {
    const outs = g.out[to];
    if (!outs.length) return -1;
    const hdg = Math.atan2(g.y[to] - g.y[from], g.x[to] - g.x[from]);
    const p = this.ctx.player;
    let total = 0, n = 0;
    const w = this._w || (this._w = new Float32Array(16));
    for (let i = 0; i < outs.length && i < 16; i++) {
      const e = outs[i];
      let wt;
      if (e.to === from) wt = outs.length === 1 ? 1 : 0.02;
      else {
        const eh = Math.atan2(g.y[e.to] - g.y[to], g.x[e.to] - g.x[to]);
        const d = angleDiff(hdg, eh);
        wt = Math.exp(-(d * d) / 1.6) + 0.15;
        if (far) wt *= ((p.px - g.x[to]) * Math.cos(eh) + (p.py - g.y[to]) * Math.sin(eh)) > 0 ? 2.5 : 0.5;
      }
      w[i] = wt; total += wt; n++;
    }
    let r = Math.random() * total;
    for (let i = 0; i < n; i++) { r -= w[i]; if (r <= 0) return outs[i].to; }
    return outs[n - 1].to;
  }

  /** Put the AI on edge from->to (to must be reachable). */
  setRoute(ai, from, to, far, g = this.world.drive) {
    ai.g = g; ai.from = from; ai.to = to;
    ai.w = this.edgeW(from, to, g);
    ai.next = this.pickNext(from, to, far, g);
    this.loadGeom(ai);
  }

  loadGeom(ai) {
    const g = ai.g || this.world.drive;
    const a = ai.from, b = ai.to;
    ai.ax = g.x[a]; ai.ay = g.y[a];
    const dx = g.x[b] - ai.ax, dy = g.y[b] - ai.ay, l = Math.hypot(dx, dy) || 1;
    ai.len = l; ai.dx = dx / l; ai.dy = dy / l; ai.rx = -ai.dy; ai.ry = ai.dx;
    ai.hdg = Math.atan2(dy, dx);
    ai.lane = ai.cyc ? bikeLaneFor(ai.w) : laneFor(ai.w);
    const onDrive = g === this.world.drive;
    ai.lim = onDrive ? this.sys.limits.get(a, b) : 0;
    ai.ap = onDrive ? this.sys.signals.approach(a, b) : null;
    ai.nap = null; ai.nlim = 0;
    if (ai.next >= 0 && onDrive) { ai.nlim = this.sys.limits.get(b, ai.next); ai.nap = this.sys.signals.approach(b, ai.next); }
    if (ai.goAp && ai.goAp !== ai.ap && ai.goAp !== ai.nap) ai.goAp = null;
    if (ai.next >= 0) {
      ai.nw = this.edgeW(b, ai.next, g);
      ai.nbx = g.x[b]; ai.nby = g.y[b];
      const nx = g.x[ai.next] - ai.nbx, ny = g.y[ai.next] - ai.nby, nl = Math.hypot(nx, ny) || 1;
      ai.nlen = nl; ai.ndx = nx / nl; ai.ndy = ny / nl; ai.nrx = -ai.ndy; ai.nry = ai.ndx;
      ai.nhdg = Math.atan2(ny, nx);
      ai.nlane = ai.cyc ? bikeLaneFor(ai.nw) : laneFor(ai.nw);
    }
  }

  step(v, ai, dt, ped) {
    const inp = v.input;
    ai.hornCd -= dt; ai.rammedCd -= dt;
    if (ai.panic > 0) { ai.panic -= dt; if (ai.panic <= 0) ai.panicMode = null; }
    const spd = v.forwardSpeed / PX, aspd = Math.abs(spd);

    if (ai.reverseT > 0) {
      ai.reverseT -= dt;
      inp.throttle = -1; inp.steer = ai.revSteer; inp.handbrake = false;
      return;
    }

    // advance along the route
    const sw = 3 * PX + aspd * 0.2 * PX;
    for (let guard = 0; guard < 3; guard++) {
      ai.s = (v.x - ai.ax) * ai.dx + (v.y - ai.ay) * ai.dy;
      if (ai.len - ai.s > sw) break;
      if (ai.next < 0) { if (ai.len - ai.s < 0.5 * PX) { ai.dead = true; return; } break; }
      const far = (v.x - this.ctx.player.px) ** 2 + (v.y - this.ctx.player.py) ** 2 > (T.CAR_DESPAWN * 0.75) ** 2;
      ai.from = ai.to; ai.to = ai.next; ai.w = ai.nw;
      ai.next = this.pickNext(ai.from, ai.to, far, ai.g || this.world.drive);
      this.loadGeom(ai);
    }
    const rem = Math.max(ai.len - ai.s, 0);

    // pursuit target
    const look = clamp(aspd * 0.7, 3.5, 12) * PX;
    let tx, ty;
    if (ai.s + look <= ai.len || ai.next < 0) {
      const d = Math.min(ai.s + look, ai.len);
      tx = ai.ax + ai.dx * d + ai.rx * ai.lane; ty = ai.ay + ai.dy * d + ai.ry * ai.lane;
    } else {
      const d = Math.min(ai.s + look - ai.len, ai.nlen);
      tx = ai.nbx + ai.ndx * d + ai.nrx * ai.nlane; ty = ai.nby + ai.ndy * d + ai.nry * ai.nlane;
    }

    // speed limits
    const fv = clamp((ai.factor - 0.85) / 0.3, 0, 1); // per-driver variance 0..1
    let cruise = ai.lim > 0
      ? Math.min(ai.lim / 3.6 * (0.82 + 0.2 * fv), v.def.maxSpeed * (v.def.bike ? 0.8 : 0.75)) // obey the posted limit (82..102%)
      : Math.min(cruiseFor(ai.w) * ai.factor, v.def.maxSpeed * (v.def.bike ? 0.8 : 0.55));
    if (ai.cyc) cruise = Math.min(cruise, T.CYC_SPEED[0] + (T.CYC_SPEED[1] - T.CYC_SPEED[0]) * clamp((ai.factor - 0.85) / 0.3, 0, 1));
    if (ai.panic > 0 && ai.panicMode === 'flee') cruise = Math.min(cruise * 1.45, v.def.maxSpeed * 0.85);
    const th = ai.next >= 0 ? Math.abs(angleDiff(ai.hdg, ai.nhdg)) : 2.8;
    const vTurn = cruise + (3.2 - cruise) * clamp(th / 1.9, 0, 1);
    let allowed = Math.min(cruise, Math.sqrt(vTurn * vTurn + 2 * 3.5 * rem / PX));
    if (ai.nlim > 0 && ai.nlim < ai.lim) { // slow down in time for a lower limit ahead
      const nc = ai.nlim / 3.6 * (0.82 + 0.2 * fv);
      allowed = Math.min(allowed, Math.sqrt(nc * nc + 2 * 3 * rem / PX));
    }
    ai.sigHold = false;
    if (ai.ap || ai.nap) allowed = Math.min(allowed, this.signalAllowed(ai, rem / PX, aspd));
    if (v.surface !== 'road') allowed = Math.min(allowed, 6);
    if (ai.panic > 0 && ai.panicMode === 'angry') allowed = 0;
    else allowed = Math.min(allowed, this.scan(v, ai, aspd, ped));

    // controller
    let thr = 0, hb = false;
    if (spd < allowed - 0.3) thr = clamp((allowed - spd) * 0.8, 0.3, 1);
    else if (spd > allowed + 0.8 && spd > 1) thr = -clamp((spd - allowed) / 4, 0.2, 1);
    else if (spd > 0.5 && allowed > 1) thr = 0.2;
    if (allowed < 0.3 && aspd < 2) { thr = 0; hb = true; }
    inp.throttle = thr; inp.handbrake = hb;
    inp.steer = clamp(angleDiff(v.angle, Math.atan2(ty - v.y, tx - v.x)) * 2.2, -1, 1);
    if (ai.cyc) { // wobbly pedalling; stronger when slow
      ai.ph += dt * (2.4 + aspd * 0.25);
      inp.steer = clamp(inp.steer + Math.sin(ai.ph) * T.CYC_WOBBLE * (aspd < 2 ? 1.6 : 1), -1, 1);
      // ring the bell at anyone in the way
      if (ai.blocker === 1 && allowed < 4 && ai.hornCd <= 0) { this.sys.honk(v); ai.hornCd = 2.2 + Math.random() * 1.5; }
    }

    // blocked / stuck handling
    if (allowed < 1 && aspd < 1 && !ai.sigHold) {
      ai.blockT += dt;
      if (ai.blockT > 1.3 && ai.hornCd <= 0 && (ai.blocker === 1 || ai.panic > 0)) { this.sys.honk(v); ai.hornCd = 2.5 + Math.random() * 1.5; }
      if (ai.blockT > ((ai.ap || ai.nap) ? 45 : 7)) { ai.blockT = 3; ai.reverseT = 1.0; ai.revSteer = Math.random() < 0.5 ? -1 : 1; }
    } else ai.blockT = Math.max(0, ai.blockT - dt);
    if (allowed > 2.5 && aspd < 0.4 && !hb) {
      ai.stuckT += dt;
      if (ai.stuckT > 2) {
        ai.stuckT = 0; ai.stuckCount++;
        ai.reverseT = 1.2;
        ai.revSteer = -Math.sign(angleDiff(v.angle, Math.atan2(ty - v.y, tx - v.x))) || 1;
      }
    } else { ai.stuckT = 0; if (aspd > 3) ai.stuckCount = 0; }
    if (ai.stuckCount >= 4) ai.dead = true;
  }

  /** Max speed (m/s) so the car can stop at the next red/amber stop line (this edge, or the next edge when it is short). */
  signalAllowed(ai, remM, aspd) {
    let a = 99;
    if (ai.ap) a = this._sigStop(ai, ai.ap, remM - ai.ap.gapM, aspd);
    if (ai.nap && a > 5) {
      const d = remM + ai.nlen / PX - ai.nap.gapM;
      if (d < 45) a = Math.min(a, this._sigStop(ai, ai.nap, d, aspd));
    }
    return a;
  }

  _sigStop(ai, ap, dist, aspd) {
    const st = this.sys.signals.stateOf(ap);
    if (st === 0 || ai.goAp === ap) return 99;
    if (dist < -1.5 && (aspd > 4 || dist < -ap.gapM * 0.7)) return 99; // already through the line
    if (aspd > 2 && dist < aspd * aspd / 14) { ai.goAp = ap; return 99; } // too close to stop (even firmly): clear the junction
    ai.sigHold = true;
    return dist <= 1 ? 0 : Math.sqrt(2 * 3.5 * (dist - 1));
  }

  /** Max safe speed (m/s) given obstacles in the driving corridor. */
  scan(v, ai, aspd, ped) {
    ai.blocker = 0;
    const cx = Math.cos(v.angle), cy = Math.sin(v.angle);
    const look = (aspd * aspd / (2 * T.BRAKE) + 7) * PX;
    const mx = v.x + cx * look * 0.5, my = v.y + cy * look * 0.5;
    const halfLat = v.wid / 2, halfLen = v.len / 2, minGap = T.MIN_GAP;
    let allowed = 99;
    const list = this.sys.vehHash.query(mx, my, look * 0.5 + 8 * PX, this.tmp);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === v || o.state === 'sunk') continue;
      const dx = o.x - v.x, dy = o.y - v.y;
      const fwd = dx * cx + dy * cy;
      if (fwd <= 0 || fwd > look + o.boundR + halfLen) continue;
      const lat = -dx * cy + dy * cx;
      const oc = Math.cos(o.angle), os = Math.sin(o.angle);
      const cosr = oc * cx + os * cy, sinr = os * cx - oc * cy;
      const ac = Math.abs(cosr), as = Math.abs(sinr);
      const oFwd = ac * o.len / 2 + as * o.wid / 2, oLat = as * o.len / 2 + ac * o.wid / 2;
      const margin = cosr < -0.6 ? -0.3 * PX : 0.35 * PX;
      if (Math.abs(lat) > halfLat + oLat + margin) continue;
      const gap = fwd - halfLen - oFwd;
      // crossing traffic: only give way to cars coming from the right (or very close)
      if (ac < 0.5 && lat < 0 && gap > 3 * PX) continue;
      if (gap > look) continue;
      const ov = Math.max(0, (o.vx * cx + o.vy * cy) / PX);
      const a = ov + Math.sqrt(2 * T.BRAKE * Math.max(0, gap / PX - minGap));
      if (a < allowed) { allowed = a; ai.blocker = o.driver === 'player' ? 1 : 2; }
    }
    // pedestrians on or at the edge of the carriageway
    const pl = ped.hash.query(mx, my, look * 0.5 + 4 * PX, this.tmpP);
    for (let i = 0; i < pl.length; i++) {
      const p = pl[i];
      if (p.state === 'dying') continue;
      const dx = p.x - v.x, dy = p.y - v.y;
      const fwd = dx * cx + dy * cy;
      if (fwd <= 0 || fwd > look) continue;
      if (Math.abs(-dx * cy + dy * cx) > halfLat + 0.7 * PX) continue;
      if (!ai.cyc && !this.world.isRoad(p.x, p.y)) continue;
      const gap = fwd - halfLen - 0.4 * PX;
      const a = Math.sqrt(2 * T.BRAKE * Math.max(0, gap / PX - 1.2));
      if (a < allowed) { allowed = a; ai.blocker = 1; }
    }
    // the player on foot
    const pl2 = this.ctx.player;
    if (!pl2.vehicle && !pl2.dead) {
      const dx = pl2.x - v.x, dy = pl2.y - v.y;
      const fwd = dx * cx + dy * cy;
      if (fwd > 0 && fwd < look && Math.abs(-dx * cy + dy * cx) < halfLat + 0.6 * PX) {
        const gap = fwd - halfLen - 0.55 * PX;
        const a = Math.sqrt(2 * T.BRAKE * Math.max(0, gap / PX - 1.2));
        if (a < allowed) { allowed = a; ai.blocker = 1; }
      }
    }
    return allowed;
  }
}
