// Player: on-foot movement, entering/exiting/stealing vehicles, health.
// Driving input is written into the current vehicle's `input`.
import Phaser from 'phaser';
import { WalkingVisual } from './WalkingVisual.js';
import { PX, TEX_RES, DEPTH } from '../config.js';
import { bus, EV, listen, pager } from '../core/events.js';
import { skillLevel } from '../core/state.js';

const WALK = 4.2 * PX;
const RUN = 7.5 * PX;
const ENTER_RANGE = 2.2 * PX; // extra reach beyond the vehicle body

export class Player {
  constructor(scene, world, state, x, y) {
    this.scene = scene;
    this.world = world;
    this.state = state;
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.radius = 0.55 * PX;
    this.vehicle = null;
    this.lastVehicle = null;
    this._refreshFx();
    listen(scene, EV.SKILL_UPGRADED, () => this._refreshFx());
    this.maxHealth = 100 + 15 * skillLevel(state, 'stamina');
    this.health = Math.min(state.player.health || this.maxHealth, this.maxHealth);
    this.dead = false;
    this.sprite = scene.add.image(x, y, `char-${state.characterId}`).setScale(1 / TEX_RES).setDepth(DEPTH.playerFoot);
    this.visual = new WalkingVisual(scene, this.sprite);
    this.keys = scene.input.keyboard.addKeys({
      up: 'W', down: 'S', left: 'A', right: 'D',
      up2: 'UP', down2: 'DOWN', left2: 'LEFT', right2: 'RIGHT',
      run: 'SHIFT', handbrake: 'SPACE', enter: 'E', horn: 'H',
    });
  }

  /** Skill multipliers come from EconomySystem (single source of truth); fall back to 1. */
  _refreshFx() {
    const e = this.scene.systems?.economy?.getEffects?.();
    this.fx = { topSpeed: e?.topSpeed ?? 1, handling: e?.handling ?? 1, runSpeed: e?.runSpeed ?? 1 };
  }

  /** The object the camera should follow. */
  get focus() { return this.vehicle ? this.vehicle.sprite : this.sprite; }
  get px() { return this.vehicle ? this.vehicle.x : this.x; }
  get py() { return this.vehicle ? this.vehicle.y : this.y; }
  get vx() { return this.vehicle ? this.vehicle.vx : this._vx || 0; }
  get vy() { return this.vehicle ? this.vehicle.vy : this._vy || 0; }
  /** cargo capacity available right now (on foot = backpack) */
  get capacity() { return this.vehicle ? this.vehicle.def.capacity : 1; }

  update(dt, vehicles) {
    if (this.dead) return;
    if (!this._fxReady && this.scene.systems?.economy?.getEffects) { this._fxReady = true; this._refreshFx(); }
    const k = this.keys;
    const up = k.up.isDown || k.up2.isDown, down = k.down.isDown || k.down2.isDown;
    const left = k.left.isDown || k.left2.isDown, right = k.right.isDown || k.right2.isDown;

    if (Phaser.Input.Keyboard.JustDown(k.enter)) {
      if (this.vehicle) this.exitVehicle();
      else this.tryEnter(vehicles);
    }
    if (Phaser.Input.Keyboard.JustDown(k.horn)) bus.emit(EV.HORN, { x: this.px, y: this.py });

    if (this.vehicle) {
      const v = this.vehicle;
      v.input.throttle = (up ? 1 : 0) - (down ? 1 : 0);
      v.input.steer = (right ? 1 : 0) - (left ? 1 : 0);
      v.input.handbrake = k.handbrake.isDown;
      v.mods.speed = v.def.staminaSpeed ? this.fx.runSpeed : this.fx.topSpeed; // pedal power comes from Stamina
      v.mods.grip = this.fx.handling;
      v.mods.steer = this.fx.handling;
      if (!v.drivable) v.input.throttle = 0;
      return;
    }

    // ---- on foot ----
    let mx = (right ? 1 : 0) - (left ? 1 : 0), my = (down ? 1 : 0) - (up ? 1 : 0);
    const ml = Math.hypot(mx, my);
    let speed = (k.run.isDown ? RUN : WALK) * this.fx.runSpeed;
    if (this.world.isWater(this.x, this.y)) speed *= 0.35; // swimming
    if (ml > 0) {
      mx /= ml; my /= ml;
      this.angle = Math.atan2(my, mx);
    }
    this._vx = mx * speed; this._vy = my * speed;
    this.x += this._vx * dt;
    this.y += this._vy * dt;
    const res = this.world.pushOut(this.x, this.y, this.radius);
    this.x = res.x; this.y = res.y;
    // get shoved by vehicles
    for (const v of vehicles) {
      if (v.state === 'sunk') continue;
      if ((v.x - this.x) ** 2 + (v.y - this.y) ** 2 > (v.boundR + this.radius) ** 2) continue;
      for (let i = 0; i < v.offsets.length; i++) {
        const [cx, cy] = v.circle(i);
        const dx = this.x - cx, dy = this.y - cy, rr = v.radius + this.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
        this.x += nx * (rr - d); this.y += ny * (rr - d);
        const hitSpeed = (v.vx * nx + v.vy * ny) / PX; // vehicle speed towards player, m/s
        if (hitSpeed > 4 && this.scene.time.now > (this._hitCooldown || 0)) {
          this._hitCooldown = this.scene.time.now + 700;
          this.damage(hitSpeed * 2.5, 'vehicle');
          this.x += nx * hitSpeed * 0.3 * PX; this.y += ny * hitSpeed * 0.3 * PX;
        }
      }
    }
    this.visual.update(this.x, this.y, this.angle, dt, ml > 0, k.run.isDown);
  }

  /** Nearest enterable vehicle in reach, or null. */
  nearestVehicle(vehicles) {
    let best = null, bd = Infinity;
    for (const v of vehicles) {
      if (!v.drivable || v.driver === 'player' || (v.def.stealable === false && !v.jobVehicle) || v.fotovogn) continue;
      const d = Math.hypot(v.x - this.x, v.y - this.y) - v.len / 2;
      if (d < ENTER_RANGE && d < bd) { bd = d; best = v; }
    }
    return best;
  }

  tryEnter(vehicles) {
    const v = this.nearestVehicle(vehicles);
    if (!v) return false;
    // Theft OFF: only owned / rented / job vehicles may be used. No ejection, no VEHICLE_STOLEN.
    if (!v.playerUsable) {
      pager('Not your vehicle.', 'warn');
      return false;
    }
    if (!v.def.bike && this.scene.ctx?.systems?.police?.isLicenceBanned?.()) {
      pager('Licence suspended: no driving cars.', 'warn');
      return false;
    }
    let method = 'parked';
    const mine = v.owned || v.rentedBy === 'player' || v.jobVehicle;
    if (mine || v === this.lastVehicle) method = mine ? 'own' : 'abandoned';
    const hadDriver = v.driver === 'ai' || v.driver === 'police'; // a ridden bike: the cyclist is knocked off (DRIVER_EJECTED)
    if (hadDriver) {
      method = 'carjack';
      const p = v.exitPoint();
      bus.emit(EV.DRIVER_EJECTED, { vehicle: v, x: p.x, y: p.y, police: v.driver === 'police' });
    }
    v.driver = 'player';
    v.ai = null;
    v.input = { throttle: 0, steer: 0, handbrake: false };
    this.vehicle = v;
    this.sprite.setVisible(false);
    this.visual.setVisible(false);
    const stolen = method === 'carjack' || method === 'parked';
    if (stolen) {
      this.state.stats.stolen++;
      bus.emit(EV.VEHICLE_STOLEN, { vehicle: v, method, driverEjected: hadDriver, quick: !!v.def.quickSteal });
    }
    bus.emit(EV.PLAYER_ENTERED_VEHICLE, { vehicle: v, stolen, method });
    return true;
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    const p = v.exitPoint();
    this.x = p.x; this.y = p.y;
    this.angle = v.angle;
    v.driver = null;
    v.input = { throttle: 0, steer: 0, handbrake: true };
    this.lastVehicle = v;
    this.vehicle = null;
    this.sprite.setVisible(true).setPosition(this.x, this.y);
    this.visual.reset(this.x, this.y, this.angle);
    bus.emit(EV.PLAYER_EXITED_VEHICLE, { vehicle: v });
  }

  damage(amount, source) {
    if (this.dead || amount <= 0) return;
    this.health -= amount;
    bus.emit(EV.PLAYER_DAMAGED, { amount, source });
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (this.vehicle) this.exitVehicle();
      this.visual.setVisible(false);
      this.sprite.setTint(0x777777).setRotation(this.angle + Math.PI / 2);
      bus.emit(EV.PLAYER_DIED, { x: this.x, y: this.y, cause: source });
    }
  }

  /** Teleport on foot (respawn, busted). */
  respawn(x, y) {
    if (this.vehicle) this.exitVehicle();
    const p = this.world.findFreeSpot(x, y);
    this.x = p.x; this.y = p.y;
    this.dead = false;
    this.maxHealth = 100 + 15 * skillLevel(this.state, 'stamina');
    this.health = this.maxHealth;
    this.sprite.clearTint().setVisible(true).setPosition(this.x, this.y);
    this.visual.reset(this.x, this.y, this.angle);
  }
}
