/**
 * PoliceSystem: crime -> heat (levels 1-5), pursuit, roadblocks, officers, busting.   OWNER: police specialist
 *
 * HEAT
 *  - `state.heat` is 0..5.99, level = floor(heat). Crimes add weighted heat (see police/tuning.js `crimeHeat`).
 *    Sources: EV.CRIME { type, severity }, EV.VEHICLE_STOLEN (carjack / parked), ramming traffic or police
 *    (EV.VEHICLE_DAMAGED), destroying vehicles (EV.VEHICLE_DESTROYED), carjacking a police car.
 *    If a CRIME carries `severity` the heat is severity * severityScale[type] (default 1; pedestrianHit 0.5,
 *    vehicleHit 0.25 because traffic reports severity 1|2), otherwise crimeHeat[type] (default 0.5).
 *  - streetSmarts via ctx.systems.economy.getEffects(): heatGain multiplies gain, heatDecay multiplies decay rate and
 *    divides the search delay (both fall back to 1).
 *  - Decay only happens while no police unit has line of sight (within 50 m). After `searchDelay` s unseen the
 *    system enters the SEARCHING phase and heat falls; each level drop is followed by a shorter pause (one level
 *    at a time). Being seen or committing a crime aborts the search.
 *
 * PURSUIT
 *  - Cars per level [0,1,2,3,4,6]; roadblocks (2 parked cars across the road ahead) 1 at level 4, 2 at level 5.
 *    Cars spawn off-screen on the drive graph, chase via world.drive.path() (A*), switch to direct seek with LOS,
 *    ram (level 2+), PIT at level 3+, and shadow the player's speed at level 1 (pull-over style).
 *    Flashing red/blue light bars on every active car. Officers hop out and chase a walking player.
 *  - Busted: police within 7 m and player slower than 1.5 m/s for 2 s (or an officer catching a player on foot,
 *    ~0.8 s). Fine = 60 + 50*level + 8% of money (capped by money) via EV.REQUEST_PAY, heat cleared, and
 *    GameScene respawns the player at the police HQ on EV.BUSTED.
 *
 * OPTIONS (core/options.js): heat, pursuit, roadblocks and busting run ONLY when pursuitEnabled() (= theft or
 *  criminalMissions is on). Otherwise addHeat() is a no-op, no unit ever spawns and update() only ticks
 *  `this.trafficRules` (police/traffic/: the fines hook, see its README). The code paths below stay intact.
 *
 * PUBLIC API (ctx.systems.police)
 *  getHeat()            -> number 0..5.99
 *  getLevel()           -> integer 0..5
 *  addHeat(amount, reason)  raise heat (positive amounts get the streetSmarts reduction; negative lowers it)
 *  clearHeat(reason)    set heat to 0, police stand down (no ESCAPED event)
 *  isPursuit()          -> true while level >= 1 and police still see / recently saw the player
 *  isSearching()        -> true while police lost the player and heat is decaying
 *  isBusted()           -> true during the short post-bust grace window
 *  getLicence()         -> { clips, maxClips, banned, banLeft }  (traffic-rules module, police/traffic/; also state.licence)
 *  isLicenceBanned()    -> true while the player may not drive cars (Player.tryEnter should refuse non-bike vehicles)
 *  nearestUnitDistance() -> metres to the nearest active police car / officer (Infinity if none)
 *  Missions "escape the police": start by addHeat(), succeed on POLICE_EV.ESCAPED (or getLevel() === 0).
 *
 * Listens: EV.CRIME, EV.VEHICLE_STOLEN, EV.VEHICLE_DAMAGED, EV.VEHICLE_DESTROYED, EV.PLAYER_DIED, EV.PLAYER_RESPAWNED
 * Traffic rules (all modes): fines via REQUEST_PAY 'fine' + POLICE_EV.TICKET / POLICE_EV.LICENCE, see police/traffic/index.js
 * Emits:   EV.HEAT_CHANGED { heat, level, prevLevel, reason }, EV.BUST_PROGRESS { t }, EV.BUSTED { fine, level },
 *          EV.REQUEST_PAY { amount: -fine, reason: 'busted' }, EV.PAGER,
 *          POLICE_EV.SEARCHING { active, t, level, delay }, POLICE_EV.PURSUIT { active, level, units },
 *          POLICE_EV.ESCAPED { level }   (import POLICE_EV from './police/tuning.js')
 * State:   owns `state.heat`.
 */
import { listen, EV, bus, pager } from '../core/events.js';
import { clamp } from '../core/math.js';
import { PX } from '../config.js';
import { pursuitEnabled } from '../core/options.js';
import { POLICE_EV, TUNING as T } from './police/tuning.js';
import { createTrafficRules } from './police/traffic/index.js';
import { steerToward, pathTarget } from './police/chase.js';
import { SirenPool } from './police/Siren.js';
import { OfficerPool } from './police/Officer.js';

export { POLICE_EV };

export class PoliceSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.units = []; // police cars: { v, mode: 'chase'|'block'|'leave', ... }
    this.byVehicle = new Map();
    this.sirens = new SirenPool(ctx.scene);
    this.officers = new OfficerPool(ctx.scene, ctx.world);
    this.unseenT = 0;
    this.searching = false;
    this.searchEmitT = 0;
    this.pursuit = false;
    this.bustT = 0;
    this.bustLock = 0;
    this.spawnT = 0.5;
    this.blockT = 0;
    this.pathBudget = 1;
    this.sightT = 0;
    this.pNode = -1;
    this.pNodeT = 0;
    this.hitCd = 0;
    this.lastBustEmit = 0;
    this.P = { x: 0, y: 0 };
    this.trafficRules = createTrafficRules(ctx); // fines hook; runs in every game mode

    const sc = ctx.scene;
    listen(sc, EV.CRIME, (c) => {
      const k = T.severityScale[c.type]; // traffic reports severity 1|2: scale per type
      this.addHeat(c.severity != null ? c.severity * (k ?? 1) : T.crimeHeat[c.type] ?? T.crimeHeat.default, c.type);
    });
    listen(sc, EV.VEHICLE_STOLEN, (e) => this._onStolen(e));
    listen(sc, EV.VEHICLE_DAMAGED, (e) => this._onDamaged(e));
    listen(sc, EV.VEHICLE_DESTROYED, (e) => this._onDestroyed(e));
    listen(sc, EV.PLAYER_DIED, () => this._reset('died'));
    listen(sc, EV.PLAYER_RESPAWNED, () => { this.bustT = 0; });
  }

  get level() { return Math.floor(this.ctx.state.heat); }

  // ---------------- public API ----------------
  getHeat() { return this.ctx.state.heat; }
  getLevel() { return this.level; }
  isPursuit() { return this.level >= 1 && !this.searching && (this.officers.active.length > 0 || this.units.some((u) => u.mode !== 'leave')); }
  isSearching() { return this.searching; }
  isBusted() { return this.bustLock > 0; }
  /** Driving licence ("klip"): { clips, maxClips, banned, banLeft (s) }. Three clips = temporary ban on cars (bikes allowed). */
  getLicence() { return this.trafficRules.getLicence(); }
  isLicenceBanned() { return this.trafficRules.isBanned(); }

  nearestUnitDistance() {
    const P = this._playerPos();
    let best = Infinity;
    for (const u of this.units) if (u.v.alive) best = Math.min(best, Math.hypot(u.v.x - P.x, u.v.y - P.y));
    for (const o of this.officers.active) best = Math.min(best, Math.hypot(o.x - P.x, o.y - P.y));
    return best / PX;
  }

  /** Raise (or lower with negative) heat. Positive amounts are scaled by the economy heatGain multiplier. */
  addHeat(amount, reason) {
    if (!amount || !pursuitEnabled()) return;
    if (amount > 0) {
      if (this.bustLock > 0 || this.ctx.player.dead) return;
      amount *= this._fx('heatGain');
      this.unseenT = 0;
      this._setSearching(false);
    }
    this._setHeat(this.ctx.state.heat + amount, reason);
  }

  clearHeat(reason = 'cleared') { this._reset(reason); }

  // ---------------- internals: heat ----------------
  /** Economy multiplier (heatGain / heatDecay); 1 when the economy is unavailable. */
  _fx(key) {
    try {
      const f = this.ctx.systems?.economy?.getEffects?.();
      const v = f && f[key];
      return Number.isFinite(v) && v > 0 ? v : 1;
    } catch (e) { return 1; }
  }

  _setHeat(h, reason) {
    const st = this.ctx.state;
    const prev = this.level;
    st.heat = clamp(h, 0, T.maxHeat);
    const lvl = this.level;
    if (lvl === prev) return;
    bus.emit(EV.HEAT_CHANGED, { heat: st.heat, level: lvl, prevLevel: prev, reason });
    if (lvl > prev) {
      if (prev === 0) { this.spawnT = 1.2; pager('Police have been alerted. Get out of sight!', 'crime', 'Dispatch'); }
      else if (lvl >= 4 && prev < 4) pager(`Heat ${lvl}: roadblocks are going up!`, 'crime', 'Dispatch');
      else pager(`Heat ${lvl}: more units on the way.`, 'crime', 'Dispatch');
      for (const u of this.units) if (u.mode === 'leave' && u.dist < 700) { u.mode = 'chase'; u.path = null; }
    } else if (lvl === 0) {
      pager('The police have lost you.', 'info', 'Dispatch');
    }
  }

  _reset(reason) {
    const st = this.ctx.state;
    const prev = this.level;
    st.heat = 0;
    this.unseenT = 0;
    this.bustT = 0;
    this._setSearching(false);
    this._setPursuit(false);
    if (prev !== 0) bus.emit(EV.HEAT_CHANGED, { heat: 0, level: 0, prevLevel: prev, reason });
    for (const u of this.units) this._leave(u);
    this.officers.active.forEach((o) => { o.mode = 'leave'; });
    this._emitBust(0);
  }

  _setSearching(active, t = 0) {
    if (active !== this.searching) {
      this.searching = active;
      this.searchEmitT = 0;
      bus.emit(POLICE_EV.SEARCHING, { active, t, level: this.level, delay: this._delay() });
    }
  }

  _setPursuit(active) {
    if (active === this.pursuit) return;
    this.pursuit = active;
    bus.emit(POLICE_EV.PURSUIT, { active, level: this.level, units: this.units.length });
  }

  _delay() { return Math.max(T.searchDelayMin, T.searchDelay / this._fx('heatDecay')); }

  _emitBust(t) {
    if (t === this.lastBustEmit) return;
    this.lastBustEmit = t;
    bus.emit(EV.BUST_PROGRESS, { t });
  }

  // ---------------- internals: crime detection ----------------
  _onStolen({ vehicle, method }) {
    const u = this.byVehicle.get(vehicle);
    if (u) { this._dropUnit(u, false); this.addHeat(T.crimeHeat.policeCarjack, 'policeCarjack'); return; }
    this.addHeat(method === 'carjack' ? T.crimeHeat.carjack : T.crimeHeat.parkedTheft, method === 'carjack' ? 'carjack' : 'parkedTheft');
  }

  _onDamaged({ vehicle, other, impact }) {
    const pv = this.ctx.player.vehicle;
    if (!pv) return;
    const uA = this.byVehicle.get(vehicle), uB = other ? this.byVehicle.get(other) : null;
    const unit = uA || uB;
    if (unit && (vehicle === pv || other === pv)) {
      if (unit.backT <= 0 && impact > 2) unit.backT = 0.8;
      if (this.hitCd <= 0 && pv.input.throttle > 0.3) { this.hitCd = T.rammingCooldown; this.addHeat(T.crimeHeat.policeHit, 'policeHit'); }
    }
  }

  _onDestroyed({ vehicle, x, y }) {
    if (vehicle.driver === 'player') return;
    const near = Math.hypot(this.ctx.player.px - x, this.ctx.player.py - y) < 40 * PX;
    const u = this.byVehicle.get(vehicle);
    if (u) { this._dropUnit(u, false); if (near) this.addHeat(T.crimeHeat.policeDestroyed, 'policeDestroyed'); return; }
    if (vehicle.driver === 'ai' && near) this.addHeat(T.crimeHeat.vehicleDestroyed, 'vehicleDestroyed');
  }

  // ---------------- internals: units ----------------
  _playerPos() { const p = this.ctx.player; this.P.x = p.px; this.P.y = p.py; return this.P; }

  _inView(x, y, pad = 60) {
    const w = this.ctx.scene.cameras.main.worldView;
    return x > w.x - pad && x < w.right + pad && y > w.y - pad && y < w.bottom + pad;
  }

  _newUnit(v, mode) {
    const u = { v, mode, path: null, pi: 0, repathT: 0, los: false, losT: Math.random() * 0.3, dist: 9999, side: Math.random() < 0.5 ? -1 : 1,
      backT: 0, reverseT: 0, reverseSteer: 1, stuckT: 0, stuckCount: 0, leaveT: 0, officer: null, lights: null, block: null };
    v.driver = 'police';
    v.tag = 'police';
    v.ai = u;
    this.byVehicle.set(v, u);
    this.units.push(u);
    this.sirens.attach(u);
    return u;
  }

  /** Remove a unit from our list; destroy the vehicle only when `remove` is true. */
  _dropUnit(u, remove) {
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    this.byVehicle.delete(u.v);
    this.sirens.detach(u);
    if (u.officer) { u.officer.home = null; u.officer = null; }
    if (remove && !u.v.destroyed) this.ctx.removeVehicle(u.v);
    else if (u.v.driver === 'police') { u.v.driver = null; u.v.ai = null; }
  }

  _leave(u) {
    if (u.mode === 'leave') return;
    u.mode = 'leave';
    u.leaveT = 0;
    u.path = null;
    const g = this.ctx.world.drive, v = u.v;
    const a = g.nearest(v.x, v.y, 300), b = g.randomNodeInRing(v.x, v.y, 1200, 2400);
    if (a >= 0 && b >= 0) { u.path = g.path(a, b, 2500); u.pi = 0; }
  }

  _spawnChaser() {
    const w = this.ctx.world, g = w.drive, P = this.P;
    for (let t = 0; t < 10; t++) {
      const n = g.randomNodeInRing(P.x, P.y, T.spawnRingMin, T.spawnRingMax);
      if (n < 0) continue;
      const x = g.x[n], y = g.y[n];
      if (this._inView(x, y, 120) || w.isBuilding(x, y)) continue;
      const nb = g.und[n][0];
      const ang = nb ? Math.atan2(g.y[nb.to] - y, g.x[nb.to] - x) : 0;
      const v = this.ctx.spawnVehicle('police', x, y, { angle: ang, driver: 'police' });
      this._newUnit(v, 'chase');
      return true;
    }
    return false;
  }

  _spawnRoadblock() {
    const w = this.ctx.world, g = w.drive, P = this.P, pl = this.ctx.player;
    const sp = Math.hypot(pl.vx, pl.vy);
    for (let t = 0; t < 8; t++) {
      let ax = Math.random() * Math.PI * 2;
      if (sp > 3 * PX) ax = Math.atan2(pl.vy, pl.vx) + (Math.random() - 0.5) * 0.8;
      const d = 560 + Math.random() * 260;
      const n = g.nearest(P.x + Math.cos(ax) * d, P.y + Math.sin(ax) * d, 250);
      if (n < 0) continue;
      const x = g.x[n], y = g.y[n];
      if (this._inView(x, y, 100) || Math.hypot(x - P.x, y - P.y) < 450 || g.und[n].length === 0) continue;
      const nb = g.und[n][0].to;
      const road = Math.atan2(g.y[nb] - y, g.x[nb] - x);
      const px = -Math.sin(road), py = Math.cos(road);
      const cars = [];
      for (const s of [-1, 1]) {
        const cx = x + px * s * 18, cy = y + py * s * 18;
        if (w.isBuilding(cx, cy)) continue;
        const v = this.ctx.spawnVehicle('police', cx, cy, { angle: road + Math.PI / 2 + s * 0.25, driver: 'police' });
        const u = this._newUnit(v, 'block');
        u.v.input.handbrake = true;
        cars.push(u);
      }
      if (cars.length) { cars.forEach((u) => { u.block = cars; }); return true; }
    }
    return false;
  }

  _countMode(mode) { let n = 0; for (const u of this.units) if (u.mode === mode) n++; return n; }

  _manageSpawns(dt) {
    const lvl = this.level, P = this.P;
    const wantCars = T.carsPerLevel[lvl], wantBlocks = T.roadblocksPerLevel[lvl];
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = T.spawnInterval;
    const chasers = this._countMode('chase');
    if (lvl >= 1 && chasers < wantCars && !this.bustLock) { this._spawnChaser(); return; }
    if (chasers > wantCars) { // stand surplus units down, farthest first
      let far = null;
      for (const u of this.units) if (u.mode === 'chase' && (!far || u.dist > far.dist)) far = u;
      if (far) this._leave(far);
    }
    let blocks = 0;
    const seen = new Set();
    for (const u of this.units) if (u.mode === 'block' && u.block && !seen.has(u.block)) { seen.add(u.block); blocks++; }
    if (blocks < wantBlocks && !this.bustLock && Math.hypot(P.x, P.y) > 0) this._spawnRoadblock();
    else if (blocks > wantBlocks) for (const u of this.units) if (u.mode === 'block') this._leave(u);
  }

  _repath(u) {
    const g = this.ctx.world.drive, v = u.v;
    const a = g.nearest(v.x, v.y, 300);
    u.path = a >= 0 && this.pNode >= 0 ? g.path(a, this.pNode, 2500) : null;
    u.pi = 0;
    u.repathT = 1.2 + Math.random() * 0.6;
  }

  _driveUnit(u, dt) {
    const v = u.v, pl = this.ctx.player, pv = pl.vehicle, P = this.P, w = this.ctx.world, lvl = this.level;
    const inp = v.input;
    const dx = P.x - v.x, dy = P.y - v.y;
    u.dist = Math.hypot(dx, dy);
    u.losT -= dt;
    if (u.losT <= 0) { u.losT = 0.25 + Math.random() * 0.1; u.los = w.lineOfSight(v.x, v.y, P.x, P.y, 16); }

    if (u.mode === 'block') {
      inp.throttle = 0; inp.steer = 0; inp.handbrake = true;
      if (u.dist < 150 && sp(pl) > 2 * PX) { u.mode = 'chase'; u.block = null; }
      return;
    }
    if (u.mode === 'leave') {
      u.leaveT += dt;
      v.mods.speed = 0.8;
      const tgt = pathTarget(u, w.drive);
      if (tgt) steerToward(v, tgt.x, tgt.y, 0.6); else steerToward(v, v.x - dx, v.y - dy, 0.6);
      return;
    }
    v.mods.speed = 1 + 0.03 * lvl + clamp((u.dist - 320) / 1500, 0, 0.25);
    v.mods.accel = 1.1;
    if (u.reverseT > 0) { u.reverseT -= dt; inp.throttle = -1; inp.steer = u.reverseSteer; inp.handbrake = false; return; }
    if (u.backT > 0) { u.backT -= dt; inp.throttle = -0.8; inp.steer = u.side * 0.5; inp.handbrake = false; return; }
    if (!pv && u.dist < 24 * PX && u.los) { // player on foot nearby: park up and send an officer
      inp.throttle = 0; inp.steer = 0; inp.handbrake = true;
      if (!u.officer && this.officers.active.length < T.maxOfficers) {
        const e = v.exitPoint();
        u.officer = this.officers.spawn(e.x, e.y, u);
      }
      return;
    }
    let tx, ty, cap = 1;
    const direct = u.los && u.dist < 300;
    if (direct) {
      tx = P.x + pl.vx * 0.35; ty = P.y + pl.vy * 0.35;
      if (pv && lvl >= 3 && u.dist < 16 * PX) { // PIT: aim at the player's rear quarter
        const c = Math.cos(pv.angle), s = Math.sin(pv.angle);
        tx = pv.x - c * pv.len * 0.45 - s * u.side * pv.wid * 0.5;
        ty = pv.y - s * pv.len * 0.45 + c * u.side * pv.wid * 0.5;
      }
    } else {
      u.repathT -= dt;
      if ((u.repathT <= 0 || !u.path) && this.pathBudget > 0) { this.pathBudget--; this._repath(u); }
      const tgt = pathTarget(u, w.drive);
      if (tgt) { tx = tgt.x; ty = tgt.y; } else { tx = P.x; ty = P.y; }
    }
    steerToward(v, tx, ty, cap);
    if (lvl <= 1 && pv && direct && u.dist < 14 * PX) { // level 1: shadow the player, pull-over style
      const want = Math.max(3, pv.speedMps * 0.95);
      inp.throttle = v.speedMps < want ? 0.7 : -0.2;
      inp.handbrake = false;
    }
    if (v.speedMps < 1 && u.dist > 9 * PX) u.stuckT += dt; else u.stuckT = Math.max(0, u.stuckT - dt);
    if (u.stuckT > 1.3) {
      u.stuckT = 0; u.stuckCount++; u.reverseT = 0.9; u.reverseSteer = Math.random() < 0.5 ? -1 : 1; u.path = null;
    }
  }

  _updateUnits(dt, time) {
    this.pathBudget = 1;
    const P = this.P;
    this.pNodeT -= dt;
    if (this.pNodeT <= 0) { this.pNodeT = 0.4; this.pNode = this.ctx.world.drive.nearest(P.x, P.y, 600); }
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i], v = u.v;
      if (v.destroyed || v.state === 'wreck' || v.state === 'sunk' || v.driver === 'player') { this._dropUnit(u, false); continue; }
      this._driveUnit(u, dt);
      const view = this._inView(v.x, v.y, 80);
      this.sirens.update(u, time, u.mode !== 'leave' || this.level > 0, view);
      // recycle
      if (u.mode === 'leave' && ((u.leaveT > 4 && !view && u.dist > 600) || u.leaveT > 25)) this._dropUnit(u, true);
      else if (u.mode === 'chase' && !view && (u.dist > T.despawnDist || u.stuckCount >= 4)) this._dropUnit(u, true);
      else if (u.mode === 'block' && (u.dist > 1300 || this.level < 4)) { if (this.level < 4) this._leave(u); else this._dropUnit(u, true); }
    }
  }

  _updateOfficers(dt) {
    const pl = this.ctx.player, P = this.P, onFoot = !pl.vehicle;
    const stand = this.level < 1 || this.bustLock > 0 || pl.dead;
    for (const o of this.officers.active) o.mode = onFoot && !stand ? 'chase' : 'leave';
    this.officers.update(dt, P.x, P.y, (5 + 0.35 * this.level) * PX, true);
    for (let i = this.officers.active.length - 1; i >= 0; i--) {
      const o = this.officers.active[i];
      const homeGone = !o.home || o.home.v.destroyed || o.home.v.state === 'wreck';
      if (o.mode === 'leave' && (homeGone || Math.hypot(o.home.v.x - o.x, o.home.v.y - o.y) < 2.5 * PX || o.leaveT > 8)) {
        if (o.home) o.home.officer = null;
        this.officers.release(o);
      }
    }
  }

  // ---------------- internals: sight, decay, bust ----------------
  _seenByPolice() {
    const P = this.P, w = this.ctx.world;
    for (const u of this.units) {
      if (u.mode === 'leave' || !u.v.alive) continue;
      if (u.dist < T.sightRange && u.los) return true;
    }
    for (const o of this.officers.active) {
      if (o.mode !== 'leave' && Math.hypot(o.x - P.x, o.y - P.y) < T.sightRange && w.lineOfSight(o.x, o.y, P.x, P.y, 16)) return true;
    }
    return false;
  }

  _updateHeat(dt) {
    const st = this.ctx.state;
    if (st.heat <= 0) { this.unseenT = 0; this._setSearching(false); this._setPursuit(false); return; }
    this.sightT -= dt;
    if (this.sightT <= 0) {
      this.sightT = 0.2;
      this._seen = this._seenByPolice();
    }
    if (this._seen) { this.unseenT = 0; this._setSearching(false); this._setPursuit(this.level >= 1); return; }
    this.unseenT += dt;
    const delay = this._delay();
    if (this.unseenT < delay) { this._setPursuit(this.level >= 1); return; }
    this._setPursuit(false);
    const prevLevel = this.level;
    this._setSearching(true);
    const rate = T.decayPerSec * this._fx('heatDecay');
    let h = st.heat - rate * dt;
    if (h <= 0) {
      this._setHeat(0, 'decay');
      this.unseenT = 0;
      this._setSearching(false);
      if (prevLevel >= 1) bus.emit(POLICE_EV.ESCAPED, { level: prevLevel });
      return;
    }
    if (prevLevel >= 1 && Math.floor(h) < prevLevel) { // one level at a time, then pause again
      this._setHeat(prevLevel - 1 + 0.999, 'decay');
      this.unseenT = delay * (1 - T.levelPause);
      this._setSearching(false);
      return;
    }
    this._setHeat(h, 'decay');
    this.searchEmitT -= dt;
    if (this.searchEmitT <= 0) {
      this.searchEmitT = 0.25;
      bus.emit(POLICE_EV.SEARCHING, { active: true, t: 1 - (st.heat - Math.floor(st.heat)), level: this.level, delay });
    }
  }

  _updateBust(dt) {
    const pl = this.ctx.player, P = this.P, pv = pl.vehicle;
    if (this.level < 1 || this.bustLock > 0 || pl.dead) {
      if (this.bustT > 0) { this.bustT = 0; this._emitBust(0); }
      return;
    }
    const spd = pv ? pv.speedMps : Math.hypot(pl.vx, pl.vy) / PX;
    let near = false, caught = false, touching = false;
    for (const u of this.units) {
      if (u.mode === 'leave' || !u.v.alive) continue;
      if (u.dist < T.bustRange) near = true;
      if (u.dist < 5 * PX) touching = true; // a car shoving the player around still counts as stopped
    }
    for (const o of this.officers.active) {
      if (o.mode === 'leave') continue;
      const d = Math.hypot(o.x - P.x, o.y - P.y);
      if (d < T.bustRange) near = true;
      if (d < T.officerCatchRange) caught = true;
    }
    if (caught && !pv) this.bustT += (T.officerCatchRate / T.bustTime) * dt;
    else if (near && spd < (touching && pv && pv.input.throttle < 0.1 ? 99 : T.bustSlow)) this.bustT += dt / T.bustTime;
    else this.bustT = Math.max(0, this.bustT - 1.5 * dt);
    const t = clamp(this.bustT, 0, 1);
    this._emitBust(Math.round(t * 50) / 50);
    if (t >= 1) this._bust();
  }

  _bust() {
    const st = this.ctx.state, lvl = this.level;
    const fine = Math.max(0, Math.min(st.money, Math.round(T.fineBase + T.fineLevel * lvl + T.finePct * st.money)));
    bus.emit(EV.BUSTED, { fine, level: lvl });
    if (fine > 0) bus.emit(EV.REQUEST_PAY, { amount: -fine, reason: 'busted' });
    pager(`Busted! Fine: ${fine} kr. You are released at the police station.`, 'warn', 'Police');
    this._reset('busted');
    this.bustLock = T.bustLock;
    const pv = this.ctx.player.vehicle;
    if (pv) { pv.input.throttle = 0; pv.input.handbrake = true; }
  }

  // ---------------- frame update ----------------
  update(dt, time) {
    this.trafficRules.update(dt, time);
    if (!pursuitEnabled()) return; // realistic game: no heat, no pursuit, no busting
    this._playerPos();
    if (this.bustLock > 0) this.bustLock -= dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    if (!this.ctx.player.dead) this._updateHeat(dt);
    this._manageSpawns(dt);
    this._updateUnits(dt, time);
    this._updateOfficers(dt);
    this._updateBust(dt);
  }

  destroy() {
    try { this.trafficRules.destroy(); this.officers.destroy(); this.sirens.destroy(); } catch (e) { /* scene already shut down */ }
    this.units = [];
    this.byVehicle.clear();
  }
}

function sp(pl) { return Math.hypot(pl.vx, pl.vy); }
