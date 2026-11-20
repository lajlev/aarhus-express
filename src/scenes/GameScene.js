// GameScene: owns the world, the player, the vehicle registry, the camera and
// the per-frame loop. Specialist systems are constructed with a shared `ctx`
// and updated from here; they talk to each other only via the event bus.
import Phaser from 'phaser';
import { GameAudio } from '../audio/GameAudio.js';
import { PX } from '../config.js';
import { bus, EV, listen, pager } from '../core/events.js';
import { opt, REALISTIC } from '../core/options.js';
import { session, writeSave } from '../core/state.js';
import { clamp, lerp, pick } from '../core/math.js';
import { getCity } from '../data/cities.js';
import { getHomeConfig } from '../data/home.js';
import { PAINT, VEHICLES } from '../data/vehicles.js';
import { World } from '../world/World.js';
import { MapRenderer } from '../world/MapRenderer.js';
import { HomeMarker } from '../world/HomeMarker.js';
import { Effects, EXPLOSION_RADIUS } from '../world/effects.js';
import { Vehicle, collideVehicles } from '../entities/Vehicle.js';
import { Player } from '../entities/Player.js';
import { TrafficSystem } from '../systems/TrafficSystem.js';
import { PoliceSystem } from '../systems/PoliceSystem.js';
import { MissionSystem } from '../systems/MissionSystem.js';
import { EconomySystem } from '../systems/EconomySystem.js';

/**
 * @typedef {object} GameCtx
 * @property {GameScene} scene
 * @property {World} world
 * @property {object} state        session.state (see core/state.js)
 * @property {object} city         entry from data/cities.js
 * @property {Player} player
 * @property {Vehicle[]} vehicles  live registry (read-only outside GameScene; use spawn/remove)
 * @property {(type:string,x:number,y:number,opts?:object)=>Vehicle} spawnVehicle
 * @property {(v:Vehicle)=>void} removeVehicle
 * @property {object} systems      { traffic, police, missions, economy }
 * @property {object|null} home    world.home: { id, name, street, district, x, y (door), bx, by, angle, parkX, parkY } (data/home.js)
 * @property {object} options      state.options { theft, criminalMissions, mayhem } (read through core/options.js)
 * @property {Effects} effects
 */

const AUTOSAVE_MS = 30000;

export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.cityId = data.cityId || session.state?.cityId || 'aarhus';
    this.city = getCity(this.cityId);
  }

  preload() {
    const key = `map-${this.cityId}`;
    if (!this.cache.json.exists(key)) {
      const t = this.add.text(this.scale.width / 2, this.scale.height / 2, `Loading ${this.city.name}…`, { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5);
      this.load.on('progress', (p) => t.setText(`Loading ${this.city.name}… ${Math.round(p * 100)}%`));
      this.load.once('complete', () => t.destroy());
      this.load.json(key, this.city.mapUrl);
    }
  }

  create() {
    const state = session.state;
    if (!state) { this.scene.start('CharacterSelect', { cityId: this.cityId }); return; }
    const map = this.cache.json.get(`map-${this.cityId}`);
    this.world = new World(map);
    this.mapRenderer = new MapRenderer(this, this.world);
    this.minimap = this.mapRenderer.bakeMinimap('minimap', 1 / 32);
    this.effects = new Effects(this);
    this.vehicles = [];

    // ---- home (rented basement room): every game has one, realistic games also START there ----
    const home = this.world.resolveHome(getHomeConfig(this.cityId));
    this.homeMarker = home ? new HomeMarker(this, home) : null;
    const startAtHome = !opt('theft') && !!home; // no theft: you live at home and own a city bike
    if (!opt('theft') && !state.ownedVehicles.includes('bike')) state.ownedVehicles.push('bike');

    // ---- player ----
    const spawnLm = this.world.landmark(this.city.spawn) || { x: this.world.W / 2, y: this.world.H / 2 };
    let sx = state.player.x ?? (startAtHome ? home.x : spawnLm.x), sy = state.player.y ?? (startAtHome ? home.y : spawnLm.y);
    const free = this.world.findFreeSpot(sx, sy);
    this.player = new Player(this, this.world, state, free.x, free.y);

    // ---- camera ----
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.world.W, this.world.H);
    cam.setBackgroundColor('#cfc7b4');
    cam.startFollow(this.player.focus, true, 0.12, 0.12);
    cam.setZoom(1.4);
    this.followTarget = this.player.focus;
    this.lookX = 0; this.lookY = 0;

    // ---- shared ctx + systems ----
    /** @type {GameCtx} */
    this.ctx = {
      scene: this,
      world: this.world,
      state,
      city: this.city,
      player: this.player,
      vehicles: this.vehicles,
      spawnVehicle: (type, x, y, opts) => this.spawnVehicle(type, x, y, opts),
      removeVehicle: (v) => this.removeVehicle(v),
      home,
      options: state.options,
      effects: this.effects,
      systems: {},
    };
    const sys = this.ctx.systems;
    sys.economy = new EconomySystem(this.ctx);
    sys.police = new PoliceSystem(this.ctx);
    sys.missions = new MissionSystem(this.ctx);
    sys.traffic = new TrafficSystem(this.ctx);
    this.systems = sys;
    this.systemOrder = [sys.traffic, sys.police, sys.missions, sys.economy];

    this.audio = new GameAudio(this.ctx);
    if (startAtHome) this._spawnOwnedAtHome(home); else this._spawnStarterVehicle(free.x, free.y);
    this._wireEvents();
    this._bindKeys();

    this.scene.launch('HUD');
    this.mapRenderer.warm(cam);
    this.lastPrompt = undefined;
    this.saveTimer = this.time.addEvent({ delay: AUTOSAVE_MS, loop: true, callback: () => this.save() });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._shutdown());

    bus.emit(EV.GAME_READY, { scene: this });
    this.time.delayedCall(400, () => {
      if (startAtHome) {
        pager(`Welcome to ${this.city.name}! You rent a basement room${home.street ? ` by ${home.street}` : ''}. Your city bike is parked at the door: press E to get on.`, 'info', 'Dispatch');
        pager('Ride with WASD/arrows, E to get on or off. Esc pauses.', 'info', 'Dispatch');
      } else {
        pager(`Welcome to ${this.city.name}! Walk up to a vehicle and press E to get in.`, 'info', 'Dispatch');
        pager('Drive with WASD/arrows, Space to drift, E to get out. Esc pauses.', 'info', 'Dispatch');
      }
    });
  }

  // ---------------- vehicles ----------------
  spawnVehicle(type, x, y, opts = {}) {
    const color = opts.color ?? pick(PAINT);
    const v = new Vehicle(this, this.world, type, x, y, { ...opts, color });
    this.vehicles.push(v);
    return v;
  }

  removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (this.player.vehicle === v) this.player.exitVehicle();
    v.destroy();
  }

  /** One owned starter hatchback at a kerb near the spawn point. Other parked
   *  cars come from TrafficSystem (which also removes any stray placeholders). */
  _spawnStarterVehicle(x, y) {
    const g = this.world.drive;
    const start = g.nearest(x, y, 2000);
    if (start < 0) return;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift();
      for (const e of g.out[n]) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        queue.push(e.to);
        const ax = g.x[n], ay = g.y[n], bx = g.x[e.to], by = g.y[e.to];
        if (Math.hypot(bx - ax, by - ay) < 10 * PX) continue;
        const ang = Math.atan2(by - ay, bx - ax);
        const off = e.w / 2 - 1.3 * PX;
        const px = (ax + bx) / 2 - Math.sin(ang) * off, py = (ay + by) / 2 + Math.cos(ang) * off; // right-hand kerb
        if (this.world.isBuilding(px, py)) continue;
        this.spawnVehicle('smallcar', px, py, { angle: ang, owned: true });
        return;
      }
    }
  }

  /** Owned vehicles (state.ownedVehicles type ids) parked in a row along the street by the home door. */
  _spawnOwnedAtHome(home) {
    const types = this.ctx.state.ownedVehicles.filter((t) => VEHICLES[t]);
    const ang = home.angle + Math.PI / 2; // along the pavement
    let i = 0;
    for (const type of types) {
      const px = home.parkX + Math.cos(ang) * i * 2.4 * PX, py = home.parkY + Math.sin(ang) * i * 2.4 * PX;
      const spot = this.world.findFreeSpot(px, py, 120);
      const v = this.spawnVehicle(type, spot.x, spot.y, { angle: ang, owned: true });
      if (i === 0) this.homeVehicle = v;
      i++;
    }
  }

  // ---------------- events ----------------
  _wireEvents() {
    listen(this, EV.VEHICLE_BROKEN, (e) => this._onBroken(e));
    listen(this, EV.PLAYER_ENTERED_VEHICLE, ({ vehicle }) => this._follow(vehicle.sprite));
    listen(this, EV.PLAYER_EXITED_VEHICLE, () => this._follow(this.player.sprite));
    listen(this, EV.VEHICLE_DESTROYED, ({ vehicle, x, y, cause }) => {
      if (cause !== 'explosion') return;
      // splash damage
      for (const v of this.vehicles) {
        if (v === vehicle) continue;
        const d = Math.hypot(v.x - x, v.y - y);
        if (d < EXPLOSION_RADIUS * 1.5) v.damage(60 * (1 - d / (EXPLOSION_RADIUS * 1.5)), vehicle, 0);
      }
      const p = this.player;
      if (p.vehicle === vehicle) { p.exitVehicle(); p.damage(55, 'explosion'); }
      else {
        const d = Math.hypot(p.px - x, p.py - y);
        if (d < EXPLOSION_RADIUS) p.damage(70 * (1 - d / EXPLOSION_RADIUS), 'explosion');
      }
      // wrecks are cleaned up after a while
      this.time.delayedCall(30000, () => { if (!vehicle.destroyed && vehicle.driver !== 'player') this.removeVehicle(vehicle); });
    });
    listen(this, EV.PLAYER_DIED, () => {
      bus.emit(EV.BANNER, { text: 'KNOCKED OUT', ms: 2400 });
      session.state.stats.knockouts++;
      this.time.delayedCall(2500, () => this._respawnAt(this.city.hospital, 'hospital'));
    });
    listen(this, EV.BUSTED, () => {
      bus.emit(EV.BANNER, { text: 'CAUGHT!', ms: 2400 });
      session.state.stats.busted++;
      this.time.delayedCall(1500, () => this._respawnAt(this.city.policeStation, 'police'));
    });
    listen(this, EV.REQUEST_SAVE, () => this.save());
    listen(this, EV.OPEN_OVERLAY, ({ mode }) => this.openOverlay(mode));
  }

  /**
   * Mayhem OFF: a vehicle hit 0 health and is "broken down" (smoking, undriveable).
   *  - the player's own / rented / job vehicle: pager offers a tow; after REALISTIC.towDelaySec the fee
   *    REALISTIC.towFee is charged ONCE (REQUEST_PAY reason 'tow') and the vehicle is respawned repaired: at the
   *    home door if it is owned, otherwise next to the player. EV.VEHICLE_TOWED is emitted.
   *  - any other (AI/parked) vehicle just stays broken and is removed after 30 s, no fee.
   * HOME & VEHICLES specialist: replace the flat fee / timer with a proper tow service if wanted.
   */
  _onBroken({ vehicle: v, mine }) {
    if (!mine) {
      this.time.delayedCall(30000, () => { if (!v.destroyed && v.driver !== 'player' && v.state === 'broken') this.removeVehicle(v); });
      return;
    }
    if (v._towing) return; // fee charged once per breakdown
    if (v.jobVehicle) {
      // taxi / bus shift vehicle: the shift ends, the company deals with the vehicle
      this.systems.missions?.careers?.abortShift('vehicle broke down');
      pager('Your shift vehicle broke down. The company tows it away and the shift is over.', 'warn', 'Dispatch');
      this.time.delayedCall(6000, () => { if (!v.destroyed) { if (this.player.vehicle === v) this.player.exitVehicle(); this.removeVehicle(v); } });
      if (!v.owned && v.rentedBy !== 'player') return;
    }
    v._towing = true;
    const fee = REALISTIC.towFee, secs = REALISTIC.towDelaySec;
    pager(`Your ${v.def.name.toLowerCase()} broke down. A tow truck is on its way (kr ${fee}).`, 'warn', 'Tow service');
    this.time.delayedCall(secs * 1000, () => {
      if (v.destroyed || v.state !== 'broken') { v._towing = false; return; }
      const p = this.player;
      if (p.vehicle === v) p.exitVehicle();
      let x, y, angle = v.angle;
      const home = this.world.home;
      if (v.owned && home) {
        const s = this.world.findFreeSpot(home.parkX, home.parkY, 160); x = s.x; y = s.y; angle = home.angle + Math.PI / 2;
      } else {
        const g = this.world.drive, n = g.nearest(p.px, p.py, 120 * PX);
        const s = this.world.findFreeSpot(n >= 0 ? g.x[n] : p.px, n >= 0 ? g.y[n] : p.py, 160); x = s.x; y = s.y;
      }
      v.x = x; v.y = y; v.angle = angle;
      v.repair();
      v.sprite.setPosition(x, y).setRotation(angle);
      v._towing = false;
      bus.emit(EV.REQUEST_PAY, { amount: -fee, reason: 'tow' });
      bus.emit(EV.VEHICLE_TOWED, { vehicle: v, fee, x, y, home: !!(v.owned && home) });
      pager(v.owned && home ? 'Towed and repaired. It is back at your door.' : 'Towed and repaired. It is waiting nearby.', 'info', 'Tow service');
    });
  }

  _respawnAt(landmarkId, where) {
    const lm = this.world.landmark(landmarkId) || { x: this.world.W / 2, y: this.world.H / 2 };
    this.player.respawn(lm.x, lm.y);
    this._follow(this.player.sprite);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.mapRenderer.warm(this.cameras.main);
    bus.emit(EV.PLAYER_RESPAWNED, { x: this.player.x, y: this.player.y, where });
  }

  _follow(target) {
    this.followTarget = target;
    this.cameras.main.startFollow(target, true, 0.12, 0.12);
  }

  _bindKeys() {
    const kb = this.input.keyboard;
    kb.on('keydown-ESC', () => this.openOverlay('pause'));
    kb.on('keydown-P', () => this.openOverlay('pause'));
    kb.on('keydown-B', () => this.openOverlay('shop'));
    kb.on('keydown-K', () => this.openOverlay('skills'));
    kb.on('keydown-M', () => this.openOverlay('map'));
    kb.on('keydown-J', () => this.openOverlay('jobs')); // phone job board (JobAppScene, JOBS specialist)
    kb.on('keydown-R', (event) => { if (!event.repeat) this.audio.toggleRadio(); });
    kb.on('keydown-T', (event) => { if (!event.repeat) this.audio.nextStation(); });
    kb.on('keydown-V', (event) => { if (!event.repeat) this.audio.toggleMute(); });
  }

  openOverlay(mode) {
    if (this.scene.isActive('Overlay') || this.scene.isActive('JobApp')) return;
    this.scene.setVisible(false, 'HUD'); // HUD restores itself on OVERLAY_CLOSED
    this.scene.pause();
    this.scene.launch(mode === 'jobs' ? 'JobApp' : 'Overlay', { mode });
  }

  save() {
    const st = session.state;
    if (!st || !this.player) return;
    st.player.x = Math.round(this.player.px);
    st.player.y = Math.round(this.player.py);
    st.player.health = Math.round(this.player.health);
    if (writeSave(st)) bus.emit(EV.SAVED, {});
  }

  // ---------------- loop ----------------
  update(time, deltaMs) {
    if (!this.world) return;
    const dt = Math.min(deltaMs / 1000, 0.05);
    session.state.stats.playSeconds += dt;
    this.player.update(dt, this.vehicles);
    for (const v of this.vehicles) v.update(dt);
    collideVehicles(this.vehicles);
    this.audio.update(dt);
    for (const s of this.systemOrder) s.update(dt, time);
    this._updatePrompt();
    this._updateCamera(dt);
    this.mapRenderer.update(this.cameras.main);
    this.effects.update(dt, this.vehicles, this.cameras.main.worldView);
  }

  _updatePrompt() {
    const p = this.player;
    let text = null;
    if (p.dead) text = null;
    else if (p.vehicle) text = p.vehicle.speedMps < 3 ? `[E] Get out of the ${p.vehicle.def.name.toLowerCase()}` : null;
    else {
      const v = p.nearestVehicle(this.vehicles);
      if (v) {
        if (!v.playerUsable) text = `Not your vehicle: ${v.def.name}`;
        else {
          const mine = v.owned || v.rentedBy === 'player' || v.jobVehicle || v === p.lastVehicle;
          const verb = mine ? 'Get in' : v.driver ? 'Steal (driver gets out)' : 'Steal';
          text = `[E] ${verb}: ${v.def.name}`;
        }
      }
    }
    if (text !== this.lastPrompt) {
      this.lastPrompt = text;
      bus.emit(EV.PROMPT, { text });
    }
  }

  _updateCamera(dt) {
    const cam = this.cameras.main;
    const p = this.player;
    let zoom = 1.7, lx = 0, ly = 0;
    if (p.vehicle) {
      const v = p.vehicle;
      const f = clamp(v.speedMps / v.def.maxSpeed, 0, 1);
      zoom = v.def.bike ? lerp(1.35, 1.05, f) : lerp(1.15, 0.72, f);
      lx = v.vx * 0.45; ly = v.vy * 0.45; // look ahead in the direction of travel
    }
    const k = 1 - Math.exp(-2.2 * dt);
    cam.setZoom(lerp(cam.zoom, zoom, k));
    this.lookX = lerp(this.lookX, lx, k);
    this.lookY = lerp(this.lookY, ly, k);
    cam.setFollowOffset(-this.lookX, -this.lookY);
  }

  _shutdown() {
    this.audio?.destroy();
    this.save();
    for (const s of this.systemOrder || []) s.destroy?.();
    for (const v of this.vehicles || []) v.destroy();
    this.mapRenderer?.destroy();
    this.homeMarker?.destroy();
    this.scene.stop('HUD');
  }
}

