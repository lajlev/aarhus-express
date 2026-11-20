// Pooled pedestrians walking the walk graph. States:
// walk | flee | down | dying. Hit by vehicles, scared by fast cars, horns, crimes.
import { PX, TEX_RES, DEPTH } from '../../config.js';
import { bus, EV } from '../../core/events.js';
import { rand, clamp } from '../../core/math.js';
import { opt } from '../../core/options.js';
import { WalkingVisual } from '../../entities/WalkingVisual.js';
import { SpatialHash } from './SpatialHash.js';
import { TRAFFIC_EV } from './events.js';
import { T } from './config.js';

export class Pedestrians {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.world = sys.ctx.world;
    this.list = [];
    this.free = [];
    this.hash = new SpatialHash(256);
    this.tmp = [];
  }

  get count() { return this.list.length; }

  _make() {
    const sprite = this.ctx.scene.add.image(0, 0, 'ped-0').setScale(1 / TEX_RES).setDepth(DEPTH.pedestrian).setVisible(false);
    const visual = new WalkingVisual(this.ctx.scene, sprite);
    visual.setVisible(false);
    return { sprite, visual, x: 0, y: 0, vx: 0, vy: 0, angle: 0, state: 'walk', a: -1, b: -1, side: 0, speed: 1.4 * PX,
      t: 0, fx: 0, fy: 0, fleePlayer: false, killed: false, acc: 0, think: 0, tex: 0, hitCd: 0, hidden: true };
  }

  _init(p, x, y) {
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.state = 'walk'; p.t = 0; p.killed = false; p.fleePlayer = false;
    p.speed = rand(T.PED_WALK[0], T.PED_WALK[1]) * PX;
    p.side = (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.9) * PX;
    p.acc = Math.random() * 0.2; p.think = Math.random() * 0.15; p.hitCd = 0;
    p.tex = Math.floor(Math.random() * 6);
    p.sprite.setTexture(`ped-${p.tex}`).clearTint().setAlpha(1);
    p.angle = Math.random() * 6.283;
    p.visual.reset(x, y, p.angle);
    p.visual.setVisible(false);
  }

  /** Spawn a walker at graph node `n` (partway along a random edge). */
  spawnOnGraph(n) {
    const g = this.world.walk;
    if (n < 0 || !g.und[n].length) return null;
    const p = this.free.pop() || this._make();
    const e = g.und[n][Math.floor(Math.random() * g.und[n].length)];
    const t = Math.random() * 0.8;
    this._init(p, g.x[n] + (g.x[e.to] - g.x[n]) * t, g.y[n] + (g.y[e.to] - g.y[n]) * t);
    p.a = n; p.b = e.to;
    this.list.push(p);
    return p;
  }

  /** Spawn a fleeing pedestrian at a point (ejected driver). */
  spawnFleeing(x, y, fromPlayer = true, dur = 8) {
    const p = this.free.pop() || this._make();
    this._init(p, x, y);
    this.flee(p, this.ctx.player.px, this.ctx.player.py, dur);
    p.fleePlayer = fromPlayer;
    this.list.push(p);
    return p;
  }

  /** A cyclist thrown off their bike: lies on the ground, then gets up and runs (or stays down if killed). */
  dropRider(x, y, vx, vy, killed) {
    const p = this.free.pop() || this._make();
    this._init(p, x, y);
    p.killed = killed; p.state = 'down'; p.t = killed ? 1.2 : rand(2.2, 3.5);
    p.vx = vx * 0.5; p.vy = vy * 0.5; p.hitCd = 1;
    p.sprite.setTint(killed ? 0x884444 : 0xcc9999);
    this.list.push(p);
    return p;
  }

  flee(p, fx, fy, dur) {
    if (p.state === 'down' || p.state === 'dying') return;
    p.state = 'flee'; p.fx = fx; p.fy = fy; p.t = Math.max(p.t, dur);
    p.speed = rand(T.PED_FLEE[0], T.PED_FLEE[1]) * PX;
  }

  scare(x, y, r, dur) {
    const r2 = r * r;
    for (const p of this.list) {
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < r2) this.flee(p, x, y, dur);
    }
  }

  nearest(x, y, maxD = Infinity) {
    let best = null, bd = maxD * maxD;
    for (const p of this.list) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  _release(i) {
    const p = this.list[i];
    p.sprite.setVisible(false); p.hidden = true;
    p.visual.setVisible(false);
    this.free.push(p);
    this.list[i] = this.list[this.list.length - 1];
    this.list.pop();
  }

  _resume(p) {
    const g = this.world.walk;
    const n = g.nearest(p.x, p.y, 320);
    if (n < 0 || !g.und[n].length) return false;
    p.state = 'walk';
    p.a = n; p.b = g.und[n][Math.floor(Math.random() * g.und[n].length)].to;
    p.speed = rand(T.PED_WALK[0], T.PED_WALK[1]) * PX;
    return true;
  }

  /** Called by the system when a vehicle overlaps a pedestrian. */
  knock(p, v, byPlayer) {
    if (p.state === 'down' || p.state === 'dying' || p.hitCd > 0) return;
    const sp = v.speedMps;
    p.killed = sp > 12 || (v.mass > 15 && sp > 9);
    p.state = 'down'; p.t = p.killed ? 1.2 : rand(2.2, 3.5);
    p.vx = v.vx * 0.55; p.vy = v.vy * 0.55;
    p.sprite.setTint(p.killed ? 0x884444 : 0xcc9999);
    p.hitCd = 1;
    const severity = p.killed ? 2 : 1;
    if (!opt('mayhem')) {
      // Mayhem OFF: not a crime. The traffic-rules/fines module listens for this and penalises byPlayer hits.
      bus.emit(TRAFFIC_EV.INJURY, { severity, byPlayer, killed: p.killed, x: p.x, y: p.y, vehicle: v });
    } else if (byPlayer) {
      bus.emit(EV.CRIME, { type: 'pedestrianHit', severity, x: p.x, y: p.y });
    }
    bus.emit(TRAFFIC_EV.PED_DOWN, { x: p.x, y: p.y, killed: p.killed, byPlayer, vehicle: v });
    this.scare(p.x, p.y, 22 * PX, 4);
  }

  update(dt) {
    const sys = this.sys, pl = this.ctx.player;
    const list = this.list;
    this.hash.clear();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const inView = sys.inView(p.x, p.y, T.PED_NEAR_MARGIN);
      p.acc += dt;
      p.hitCd -= dt;
      if (inView || p.acc >= T.PED_TICK_FAR) { this._step(p, p.acc); p.acc = 0; }
      const far = (p.x - pl.px) ** 2 + (p.y - pl.py) ** 2 > T.PED_DESPAWN * T.PED_DESPAWN;
      if (far && !inView && !p.keep) {
        if (!this._respawn(p)) { this._release(i); continue; }
      }
      if (p.state === 'dying' && p.t <= 0) { this._release(i); continue; }
      this.hash.insert(p);
      const vis = sys.inView(p.x, p.y, 40);
      if (vis) {
        if (p.state === 'walk' || p.state === 'flee') {
          if (p.hidden) p.visual.reset(p.x, p.y, p.angle);
          p.visual.setVisible(true);
          p.visual.update(p.x, p.y, p.angle, dt, true, p.state === 'flee');
        } else {
          p.visual.setVisible(false);
          p.sprite.setPosition(p.x, p.y).setRotation(p.state === 'down' ? p.angle + Math.PI / 2 : p.angle);
        }
        if (p.hidden) { p.sprite.setVisible(true); p.hidden = false; }
      } else if (!p.hidden) { p.sprite.setVisible(false); p.visual.setVisible(false); p.hidden = true; }
    }
  }

  _respawn(p) {
    const pl = this.ctx.player;
    const n = this.world.walk.randomNodeInRing(pl.px, pl.py, T.PED_SPAWN_MIN * 1.5, T.PED_SPAWN_MAX, 8);
    if (n < 0) return false;
    const g = this.world.walk;
    if (!g.und[n].length || this.sys.inView(g.x[n], g.y[n], 60)) return false;
    this._init(p, g.x[n], g.y[n]);
    p.a = n; p.b = g.und[n][Math.floor(Math.random() * g.und[n].length)].to;
    return true;
  }

  _step(p, dt) {
    const g = this.world.walk;
    switch (p.state) {
      case 'walk': {
        p.think -= dt;
        if (p.think <= 0) { p.think = 0.15; this._threats(p); if (p.state !== 'walk') return; }
        const bx = g.x[p.b], by = g.y[p.b];
        let dx = bx - g.x[p.a], dy = by - g.y[p.a];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const tx = bx - dy * p.side, ty = by + dx * p.side;
        const ex = tx - p.x, ey = ty - p.y, d = Math.hypot(ex, ey);
        if (d < 10 + p.speed * dt) {
          const nb = g.und[p.b];
          let pick = -1, tries = 0;
          while (tries++ < 4) { pick = nb[Math.floor(Math.random() * nb.length)].to; if (pick !== p.a || nb.length === 1) break; }
          p.a = p.b; p.b = pick < 0 ? p.a : pick;
        } else {
          p.x += (ex / d) * p.speed * dt; p.y += (ey / d) * p.speed * dt;
          p.angle = Math.atan2(ey, ex);
        }
        break;
      }
      case 'flee': {
        if (p.fleePlayer) { p.fx = this.ctx.player.px; p.fy = this.ctx.player.py; }
        let ax = p.x - p.fx, ay = p.y - p.fy;
        const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
        p.x += ax * p.speed * dt; p.y += ay * p.speed * dt;
        const res = this.world.pushOut(p.x, p.y, 0.5 * PX);
        p.x = res.x; p.y = res.y;
        if (this.world.isWater(p.x, p.y)) { p.x -= ax * p.speed * dt * 2; p.y -= ay * p.speed * dt * 2; }
        p.angle = Math.atan2(ay, ax);
        p.t -= dt;
        if (p.t <= 0) { p.fleePlayer = false; if (!this._resume(p)) { p.state = 'dying'; p.t = 0; } }
        break;
      }
      case 'down': {
        p.x += p.vx * dt; p.y += p.vy * dt;
        const k = Math.exp(-3 * dt); p.vx *= k; p.vy *= k;
        const res = this.world.pushOut(p.x, p.y, 0.5 * PX);
        p.x = res.x; p.y = res.y;
        p.t -= dt;
        if (p.t <= 0) {
          if (p.killed) { p.state = 'dying'; p.t = 3; } else { p.sprite.clearTint(); p.state = 'flee'; p.t = 3; p.speed = rand(T.PED_FLEE[0], T.PED_FLEE[1]) * PX; p.fx = p.x - p.vx; p.fy = p.y - p.vy; }
        }
        break;
      }
      case 'dying':
        p.t -= dt;
        p.sprite.setAlpha(clamp(p.t / 3, 0, 1));
        break;
      default: break;
    }
  }

  /** Flee from fast cars heading our way. */
  _threats(p) {
    const list = this.sys.vehHash.query(p.x, p.y, 14 * PX, this.tmp);
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v.driver === null) continue;
      const sp = v.speed / PX;
      if (sp < 6.5) continue;
      const rx = p.x - v.x, ry = p.y - v.y, d = Math.hypot(rx, ry);
      if (d > (3 + sp * 0.9) * PX) continue;
      if (rx * v.vx + ry * v.vy <= 0) continue;
      // flee sideways off the car's path
      const cross = v.vx * ry - v.vy * rx;
      const s = cross >= 0 ? 1 : -1;
      const inv = PX / v.speed;
      this.flee(p, p.x + s * v.vy * inv, p.y - s * v.vx * inv, 1.8);
      return;
    }
  }

  destroy() {
    for (const p of this.list) { p.visual.destroy(); p.sprite.destroy(); }
    for (const p of this.free) { p.visual.destroy(); p.sprite.destroy(); }
    this.list.length = 0; this.free.length = 0;
  }
}
