// Vehicle: arcade top-down car physics + building/vehicle collisions + damage.
// Any controller (player keys, traffic AI, police AI) drives a vehicle by
// writing `vehicle.input = { throttle: -1..1, steer: -1..1, handbrake: bool }`.
import { PX, TEX_RES, DEPTH } from '../config.js';
import { VEHICLES } from '../data/vehicles.js';
import { bus, EV } from '../core/events.js';
import { clamp } from '../core/math.js';
import { opt, playerMayUse } from '../core/options.js';

let nextId = 1;

export class Vehicle {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../world/World.js').World} world
   * @param {string} type key of VEHICLES
   * @param {object} [opts] { angle, color, parked, owned, tag, rentedBy: 'player'|null, jobVehicle }
   */
  constructor(scene, world, type, x, y, opts = {}) {
    const def = VEHICLES[type];
    if (!def) throw new Error(`Unknown vehicle type ${type}`);
    this.id = nextId++;
    this.scene = scene;
    this.world = world;
    this.type = type;
    this.def = def;
    this.len = def.length * PX;
    this.wid = def.width * PX;
    this.x = x;
    this.y = y;
    this.angle = opts.angle ?? 0;
    this.vx = 0;
    this.vy = 0;
    this.spin = 0;
    this.health = def.health;
    this.maxHealth = def.health;
    this.mass = def.mass;
    /** 'ok' | 'burning' | 'wreck' | 'sunk' | 'broken' (mayhem OFF: 0 health, smoking, undriveable until towed) */
    this.state = 'ok';
    this.burnT = 0;
    /** who is driving: null | 'player' | 'ai' | 'police' */
    this.driver = opts.driver ?? null;
    /** free slot for the controlling system (traffic/police AI state) */
    this.ai = null;
    this.owned = !!opts.owned;
    /** 'player' while the player rents it (HOME & VEHICLES specialist); usable with theft off. */
    this.rentedBy = opts.rentedBy ?? null;
    /** true for a vehicle supplied by a job (bus, taxi, mission van); usable with theft off. */
    this.jobVehicle = !!opts.jobVehicle;
    this.tag = opts.tag ?? null; // e.g. mission target marker
    this.input = { throttle: 0, steer: 0, handbrake: false };
    /** per-vehicle multipliers set by skills etc. */
    this.mods = { speed: 1, accel: 1, steer: 1, grip: 1 };
    this.surface = 'road';
    this.color = opts.color ?? 0xffffff;
    this.sprite = scene.add.image(x, y, def.tex).setScale(1 / TEX_RES).setRotation(this.angle).setDepth(DEPTH.vehicle);
    if (def.tint && opts.color != null) this.sprite.setTint(opts.color);
    // collision circles along the long axis
    const r = this.wid / 2;
    const n = Math.max(1, Math.round(this.len / this.wid));
    this.radius = r;
    this.offsets = [];
    for (let i = 0; i < n; i++) this.offsets.push(n === 1 ? 0 : -this.len / 2 + r + (i * (this.len - 2 * r)) / (n - 1));
    this.boundR = this.len / 2;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  /** speed in m/s */
  get speedMps() { return this.speed / PX; }
  get forwardSpeed() { return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle); }
  get alive() { return this.state === 'ok' || this.state === 'burning'; }
  get drivable() { return this.state === 'ok' || this.state === 'burning'; }
  /** May the player get in? (theft off: only owned / rented / job vehicles; see core/options.js) */
  get playerUsable() { return playerMayUse(this); }

  /** World position of collision circle i. */
  circle(i) {
    const o = this.offsets[i];
    return [this.x + Math.cos(this.angle) * o, this.y + Math.sin(this.angle) * o];
  }

  update(dt) {
    const d = this.def, inp = this.input, m = this.mods;
    const world = this.world;
    const prevX = this.x, prevY = this.y;
    this.surface = world.surfaceAt(this.x, this.y);
    const inWater = world.isWater(this.x, this.y);
    let maxS = d.maxSpeed * PX * m.speed;
    let accel = d.accel * PX * m.accel;
    let extraDrag = 0;
    // Unclassified ground includes paved plazas: bicycles retain road speed there.
    if (this.surface === 'green' || (this.surface === 'ground' && !d.cyclist)) { maxS *= d.offroad; extraDrag = 0.8; }
    else if (this.surface === 'foot' && !d.bike) { maxS *= 0.75; }
    if (inWater) { maxS *= 0.15; extraDrag = 3; this.damage(25 * dt, null, 0); }
    const controllable = this.drivable && this.driver;
    const throttle = controllable ? inp.throttle : 0;
    const steer = controllable ? inp.steer : 0;
    const hb = controllable ? inp.handbrake : (this.state === 'wreck' || this.state === 'broken');

    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    let vf = this.vx * cos + this.vy * sin;
    let vr = -this.vx * sin + this.vy * cos;

    if (throttle > 0) {
      if (vf < -PX) vf += d.brake * PX * dt;
      else if (vf < maxS) vf += throttle * accel * dt * (1 - 0.6 * clamp(vf / maxS, 0, 1));
    } else if (throttle < 0) {
      if (vf > PX) vf -= d.brake * PX * dt * -throttle;
      else if (vf > -d.reverse * PX) vf -= accel * 0.6 * dt * -throttle;
    } else {
      vf *= Math.exp(-0.5 * dt);
      const roll = 1.2 * PX * dt;
      vf = Math.abs(vf) < roll ? 0 : vf - Math.sign(vf) * roll;
    }
    if (vf > maxS) vf -= (vf - maxS) * 2.5 * dt;
    vf *= Math.exp(-(d.drag * 0.1 + extraDrag) * dt);
    if (hb) vf *= Math.exp(-1.1 * dt);

    // lateral grip: lower with handbrake, slightly lower once already sliding
    const slip = Math.abs(vr) / PX;
    let grip = d.grip * m.grip;
    if (hb) grip *= 0.13;
    else if (slip > 4) grip *= 0.55;
    vr *= Math.exp(-grip * dt);

    // steering scales up from standstill and tightens at speed
    const spd = Math.abs(vf) / PX;
    const lowSpeed = clamp(spd / 5, 0, 1);
    const highSpeed = 1 - 0.42 * clamp(spd / (d.maxSpeed * 1.1), 0, 1);
    const dir = vf >= 0 ? 1 : -1;
    const turn = steer * d.steer * m.steer * lowSpeed * highSpeed * dir * (hb ? 1.4 : 1);
    this.angle += (turn + this.spin) * dt;
    this.spin *= Math.exp(-4 * dt);

    // recompose in the old frame: rotation alone does not redirect momentum,
    // grip pulls it into line next frame -> natural drift
    this.vx = cos * vf - sin * vr;
    this.vy = sin * vf + cos * vr;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this._collideWorld(prevX, prevY);

    // burning / explosion
    if (this.state === 'burning') {
      this.burnT -= dt;
      if (this.burnT <= 0) this.explode();
    }
    if (d.riderTex && this.state === 'ok') { // show the cyclist only while somebody is riding
      const ridden = !!this.driver;
      if (ridden !== this._ridden) { this._ridden = ridden; this.sprite.setTexture(ridden ? d.riderTex : d.tex); }
    }
    this.sprite.setPosition(this.x, this.y).setRotation(this.angle);
  }

  _collideWorld(prevX, prevY) {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    for (let i = 0; i < this.offsets.length; i++) {
      const o = this.offsets[i];
      const cx = this.x + cos * o, cy = this.y + sin * o;
      const res = this.world.pushOut(cx, cy, this.radius);
      if (!res.hit) continue;
      this.x += res.x - cx;
      this.y += res.y - cy;
      const nx = res.nx, ny = res.ny;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        const rest = 0.25;
        this.vx -= (1 + rest) * vn * nx;
        this.vy -= (1 + rest) * vn * ny;
        // scrape friction
        this.vx *= 0.97; this.vy *= 0.97;
        // torque: hitting with the nose/tail spins the car
        const lever = o / (this.len / 2 || 1);
        const cross = cos * ny - sin * nx;
        this.spin += lever * cross * (-vn / PX) * 0.35;
        const impact = -vn / PX;
        if (impact > 3) this.damage((impact - 3) * 2.2, null, impact);
      }
    }
    if (this.world.isBuilding(this.x, this.y)) {
      // tunnelled into a building: restore last good position
      this.x = prevX; this.y = prevY; this.vx *= -0.2; this.vy *= -0.2;
    }
  }

  damage(amount, other = null, impact = 0) {
    if (!this.alive || amount <= 0) return;
    this.health -= amount;
    bus.emit(EV.VEHICLE_DAMAGED, { vehicle: this, amount, impact, other });
    if (this.health <= 0 && this.state === 'ok') {
      this.health = 0;
      if (this.world.isWater(this.x, this.y)) return this.sink();
      if (!opt('mayhem')) return this.breakDown();
      this.state = 'burning';
      this.burnT = 4;
    }
  }

  /** Mayhem OFF: instead of burning and exploding the vehicle is "broken down" (smoking, undriveable).
   *  GameScene handles the tow (EV.VEHICLE_BROKEN -> fee -> EV.VEHICLE_TOWED). */
  breakDown() {
    this.state = 'broken';
    this.vx *= 0.5; this.vy *= 0.5;
    bus.emit(EV.VEHICLE_BROKEN, { vehicle: this, mine: !!(this.owned || this.rentedBy === 'player' || this.jobVehicle || this.driver === 'player') });
  }

  /** Back to a fresh repaired state (used by the tow). */
  repair() {
    this.state = 'ok';
    this.health = this.maxHealth;
    this.burnT = 0;
    this.vx = 0; this.vy = 0; this.spin = 0;
    this.input = { throttle: 0, steer: 0, handbrake: true };
    this.sprite.setTexture(this.def.tex).clearTint();
    if (this.def.tint && this.color != null) this.sprite.setTint(this.color);
    this._ridden = false;
  }

  explode() {
    this.state = 'wreck';
    this.vx *= 0.3; this.vy *= 0.3;
    this.sprite.setTexture(this.def.bike ? this.def.tex : 'veh-wreck').clearTint();
    if (this.def.bike) this.sprite.setTint(0x333333);
    bus.emit(EV.VEHICLE_DESTROYED, { vehicle: this, x: this.x, y: this.y, cause: 'explosion' });
  }

  sink() {
    this.state = 'sunk';
    this.sprite.setAlpha(0.35);
    bus.emit(EV.VEHICLE_DESTROYED, { vehicle: this, x: this.x, y: this.y, cause: 'sunk' });
  }

  /** Point where a driver gets out (left side, DK driver seat), free of buildings. */
  exitPoint() {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const side = this.wid / 2 + 0.9 * PX;
    const candidates = [
      [this.x + sin * side, this.y - cos * side], // left
      [this.x - sin * side, this.y + cos * side], // right
      [this.x - cos * (this.len / 2 + PX), this.y - sin * (this.len / 2 + PX)], // behind
      [this.x + cos * (this.len / 2 + PX), this.y + sin * (this.len / 2 + PX)], // front
    ];
    for (const [x, y] of candidates) if (!this.world.isBuilding(x, y)) return { x, y };
    return this.world.findFreeSpot(this.x, this.y);
  }

  destroy() {
    this.sprite.destroy();
    this.destroyed = true;
  }
}

/**
 * Resolve vehicle-vs-vehicle collisions (impulses + damage). O(n^2) over the
 * given list with a cheap bounding check; fine for ~60 vehicles.
 */
export function collideVehicles(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.state === 'sunk') continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.state === 'sunk') continue;
      const R = a.boundR + b.boundR;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > R * R) continue;
      let done = false;
      for (let ia = 0; ia < a.offsets.length && !done; ia++) {
        const [ax, ay] = a.circle(ia);
        for (let ib = 0; ib < b.offsets.length && !done; ib++) {
          const [bx, by] = b.circle(ib);
          const rr = a.radius + b.radius;
          const dx = ax - bx, dy = ay - by, d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const dd = Math.sqrt(d2), nx = dx / dd, ny = dy / dd;
          const overlap = rr - dd;
          const ima = 1 / a.mass, imb = 1 / b.mass, sum = ima + imb;
          a.x += nx * overlap * (ima / sum); a.y += ny * overlap * (ima / sum);
          b.x -= nx * overlap * (imb / sum); b.y -= ny * overlap * (imb / sum);
          const rvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rvn < 0) {
            const jimp = (-(1 + 0.3) * rvn) / sum;
            a.vx += jimp * ima * nx; a.vy += jimp * ima * ny;
            b.vx -= jimp * imb * nx; b.vy -= jimp * imb * ny;
            const impact = -rvn / PX;
            const thr = a.def.cyclist || b.def.cyclist ? 1.2 : 2.5; // cyclists come off easily
            if (impact > thr) {
              a.damage((impact - thr) * 1.6 * (b.mass / (a.mass + b.mass)) * 2, b, impact);
              b.damage((impact - thr) * 1.6 * (a.mass / (a.mass + b.mass)) * 2, a, impact);
            }
            const ca = Math.cos(a.angle), sa = Math.sin(a.angle), cb = Math.cos(b.angle), sb = Math.sin(b.angle);
            a.spin += (a.offsets[ia] / (a.len / 2 || 1)) * (ca * ny - sa * nx) * impact * 0.25 * (imb / sum);
            b.spin -= (b.offsets[ib] / (b.len / 2 || 1)) * (cb * ny - sb * nx) * impact * 0.25 * (ima / sum);
          }
          done = true;
        }
      }
    }
  }
}
