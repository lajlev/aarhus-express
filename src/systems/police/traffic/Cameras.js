// "Fotovogn": parked speed-camera vans on main roads, plus occasional patrol cars that ticket on sight.
import Phaser from 'phaser';
import { PX, DEPTH } from '../../../config.js';
import { RULES as R } from './config.js';

const PREFS = [/^Randersvej/, /^Viborgvej/, /^Åboulevarden/, /Ringgade$/, /^Silkeborgvej/, /^Skanderborgvej/, /^Oddervej/, /^Grenåvej/,
  /^Paludan-Müllers Vej/, /^Marselis Boulevard/, /^Jyllands Allé/, /^Frederiks Allé/, /^Strandvejen/, /^Nørrebrogade/, /^Bernhardt Jensens Boulevard/];

/** Choose camera spots: round-robin over the preferred main roads that exist in the map, kerb-side, away from junctions. */
export function planCameraSpots(world, count = R.CAMERA_COUNT) {
  const m = world.map, names = world.streetNames || m.streets || [];
  const cands = PREFS.map(() => []);
  const sigs = world.getTrafficSignals();
  for (let r = 0; r < m.roads.length; r++) {
    const f = m.roads[r], si = m.roadStreet[r];
    if (!si || f[0] > 2 || f[1] < R.CAMERA_MIN_ROAD * PX) continue;
    const name = names[si];
    const pi = PREFS.findIndex((re) => re.test(name));
    if (pi < 0) continue;
    for (let i = 3; i + 3 < f.length; i += 2) {
      const dx = f[i + 2] - f[i], dy = f[i + 3] - f[i + 1], len = Math.hypot(dx, dy);
      if (len < 32 * PX) continue;
      cands[pi].push({ x: f[i] + dx / 2, y: f[i + 1] + dy / 2, a: Math.atan2(dy, dx), w: f[1], len, street: name });
    }
  }
  for (const c of cands) c.sort((a, b) => b.len - a.len);
  const out = [], space = R.CAMERA_SPACING * PX;
  const okFor = (c) => {
    for (const o of out) if (Math.hypot(o.x - c.x, o.y - c.y) < space) return false;
    for (const s of sigs) if (Math.hypot(s.x - c.x, s.y - c.y) < 40 * PX) return false;
    return true;
  };
  for (let pass = 0; pass < 6 && out.length < count; pass++) {
    for (let p = 0; p < PREFS.length && out.length < count; p++) {
      const list = cands[p];
      for (let k = 0; k < list.length; k++) {
        const c = list[k];
        if (c.used || !okFor(c)) continue;
        const spot = placeVan(world, c);
        c.used = true;
        if (!spot) continue;
        out.push(spot);
        break;
      }
    }
  }
  return out;
}

function placeVan(world, c) {
  const ux = Math.cos(c.a), uy = Math.sin(c.a), rx = -uy, ry = ux;
  const hl = 2.7 * PX, hw = 1.1 * PX;
  const tryOff = (off) => {
    const x = c.x + rx * off, y = c.y + ry * off;
    for (const [a, b] of [[0, 0], [hl, 0], [-hl, 0], [0, hw], [0, -hw]]) {
      const px = x + ux * a + rx * b, py = y + uy * a + ry * b;
      if (world.isBuilding(px, py) || world.isWater(px, py)) return null;
    }
    return { x, y, a: c.a, street: c.street, v: null, cd: 0, warnCd: 0, led: null, flash: null };
  };
  const side = c.w / 2 + 1.4 * PX;
  return tryOff(side) || tryOff(-side) || (c.w >= 96 ? tryOff(c.w / 2 - 1.5 * PX) : null);
}

export class CameraVans {
  constructor(ctx) {
    this.ctx = ctx;
    this.spots = planCameraSpots(ctx.world);
  }

  /** Spawn/despawn vans around the player. */
  update(dt, time) {
    const p = this.ctx.player, act = (R.CAMERA_ACTIVATE * PX) ** 2, des = (R.CAMERA_DESPAWN * PX) ** 2;
    for (const s of this.spots) {
      s.cd -= dt; s.warnCd -= dt;
      const d2 = (s.x - p.px) ** 2 + (s.y - p.py) ** 2;
      if (!s.v && d2 < act) this._spawn(s);
      else if (s.v && (s.v.destroyed || s.v.state !== 'ok')) this._despawn(s);
      else if (s.v && d2 > des) this._despawn(s);
      if (s.v && s.led) {
        const v = s.v, c = Math.cos(v.angle), sn = Math.sin(v.angle);
        s.led.setPosition(v.x - c * v.len * 0.42, v.y - sn * v.len * 0.42).setAlpha(0.55 + 0.35 * Math.sin(time / 260 + s.x));
      }
    }
  }

  _spawn(s) {
    const sc = this.ctx.scene;
    const v = this.ctx.spawnVehicle('van', s.x, s.y, { angle: s.a, color: 0xaab3bd, driver: null, tag: 'fotovogn' });
    if (!v) return;
    v.mass = 90; v.fotovogn = true;
    s.v = v;
    s.led = sc.add.image(s.x, s.y, 'soft').setTint(0xff3b30).setBlendMode(Phaser.BlendModes.ADD).setScale(0.45).setDepth(DEPTH.vehicle + 2);
  }

  _despawn(s) {
    if (s.v && !s.v.destroyed) this.ctx.removeVehicle(s.v);
    s.v = null;
    if (s.led) { s.led.destroy(); s.led = null; }
  }

  /** Nearest active van within r px of (x, y) whose cooldown is over (or null). */
  nearVan(x, y, r) {
    let best = null, bd = r * r;
    for (const s of this.spots) {
      if (!s.v) continue;
      const d = (s.v.x - x) ** 2 + (s.v.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  flash(s) {
    const sc = this.ctx.scene;
    if (!s.v) return;
    const img = sc.add.image(s.v.x, s.v.y, 'soft').setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setScale(2.6).setDepth(DEPTH.effects);
    sc.tweens.add({ targets: img, alpha: 0, scale: 4, duration: 260, onComplete: () => img.destroy() });
  }

  destroy() {
    for (const s of this.spots) { if (s.led) s.led.destroy(); s.led = null; s.v = null; }
  }
}

/** One or two AI police cars in the normal traffic flow (TrafficSystem recycles them like any car). They ticket on sight. */
export class Patrols {
  constructor(ctx) {
    this.ctx = ctx;
    this.cars = [];
    this.spawnT = 12;
  }

  _traffic() { return this.ctx.systems.traffic; }

  update(dt) {
    const tr = this._traffic();
    if (!tr || !tr._init) return;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.destroyed || v.driver !== 'ai' || v.state !== 'ok') { this.cars.splice(i, 1); this.spawnT = R.PATROL_RESPAWN[0] + Math.random() * (R.PATROL_RESPAWN[1] - R.PATROL_RESPAWN[0]); }
    }
    if (this.cars.length >= R.PATROL_COUNT) return;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 3;
    const p = this.ctx.player, g = this.ctx.world.drive;
    for (let k = 0; k < 6; k++) {
      const n = g.randomNodeInRing(p.px, p.py, R.PATROL_SPAWN_MIN * PX, R.PATROL_SPAWN_MAX * PX, 6);
      if (n < 0 || tr.inView(g.x[n], g.y[n], 90)) continue;
      const v = tr.spawnVehicle('police', { x: g.x[n], y: g.y[n] }, { mode: 'traffic' });
      if (v) { v.patrol = true; this.cars.push(v); return; }
    }
  }

  /** Is a patrol car within sight range (with line of sight) of (x, y)? */
  sees(x, y) {
    const r2 = (R.PATROL_SIGHT * PX) ** 2, w = this.ctx.world;
    for (const v of this.cars) {
      if ((v.x - x) ** 2 + (v.y - y) ** 2 < r2 && w.lineOfSight(v.x, v.y, x, y)) return v;
    }
    return null;
  }

  destroy() { this.cars.length = 0; }
}
