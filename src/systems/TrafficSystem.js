/**
 * TrafficSystem: AI traffic, parked cars and pedestrians.   OWNER: traffic specialist
 *
 * Cars follow the directed drive graph in the right-hand lane (lane offset from
 * road width), car-follow with braking distance, slow for and take turns at
 * intersections (straight preferred, biased towards the player when far away),
 * stop for the player / pedestrians, honk, reverse out of jams, and react when
 * rammed ('flee' or 'angry' stop). They spawn off-screen in a ring around the
 * player and are recycled (the same Vehicle is repositioned) when too far.
 * AI off-screen thinks at 6 Hz, on screen at 30 Hz. Neighbour queries use spatial hashes.
 * Parked cars (driver null) sit on wide streets; pedestrians walk `world.walk`.
 * Cyclists (def.cyclist: bike, cargobike) are a separate pool (T.CYC_*), up to ~26 in central Aarhus: they ride
 * the map's cycleway graph (map.bike, via traffic/BikeGraph.js) or the kerb-side of streets, wobble, ding a bell
 * (TRAFFIC_EV.HONK + 'ding!') and fall off when hit (EV.CRIME pedestrianHit if the player did it). Bike racks with
 * 3-8 parked, stealable bikes spawn near RACK_SITES (Aarhus H, Dokk1, Latinerkvarteret, university, Streget, Radhus).
 *
 * ---- Public API (ctx.systems.traffic) ----
 *  spawnParked(type, x, y, angle, opts)     -> Vehicle (parked, tracked for recycling; GameScene calls it)
 *  spawnVehicle(type, pos, opts)            -> Vehicle|null. pos {x,y,angle?}. opts.mode 'parked' (default,
 *                                              snapped to nearest kerb spot unless opts.exact) | 'traffic'
 *                                              (AI car on nearest road). opts.color, opts.tag, opts.owned.
 *                                              'tram' / non-stealable types are refused (returns null).
 *  ensureVehicleNear(type, x, y, maxDist)   -> existing stealable vehicle of that type within maxDist px,
 *                                              else a newly parked one near (x,y). For "steal a <model>" missions.
 *  getVehicles(filter?)                     -> live Vehicle[] (ctx.vehicles) optionally filtered by fn
 *  getNearestVehicle(x, y, opts?)           -> Vehicle|null; opts { type, types[], maxDist, parkedOnly,
 *                                              trafficOnly, stealable=true, untaggedOnly }
 *  getTrafficCars() / getParkedCars()       -> arrays of Vehicle (do not mutate)
 *  isTrafficCar(v) / isParked(v)
 *  releaseVehicle(v)                        -> stop managing v (no recycle/despawn); missions call this for targets
 *  pedestrians (array of ped objects, read-only), getPedestrians(), getNearestPedestrian(x, y, maxDist)
 *  scarePedestrians(x, y, radiusPx, seconds)
 *  setDensity(mult)                         -> scales car/parked/ped targets (0..1.5)
 *  tuning                                   -> the live config object (core/config.js T)
 *  signals                                  -> TrafficSignals (traffic/Signals.js): approach(from,to), stateOf(ap) 0 green|1 amber|2 red,
 *                                              redAge(ap), nearby(x,y,r,out); AI cars and cyclists stop at red/amber stop lines
 *  limits                                   -> EdgeLimits: get(a,b) km/h of a drive edge; AI cruise = posted limit * 0.82..1.02
 *
 * Listens: EV.DRIVER_EJECTED, EV.HORN, EV.CRIME, EV.VEHICLE_DESTROYED, EV.VEHICLE_DAMAGED
 * Emits:   EV.CRIME { type:'pedestrianHit', severity:1|2 } (player ran someone over; mayhem ON only),
 *          TRAFFIC_EV.INJURY { severity, byPlayer, killed, x, y, vehicle } (same hits when mayhem is OFF, instead of CRIME),
 *          EV.CRIME { type:'vehicleHit', severity:1 } (player rammed a civilian car, throttled),
 *          TRAFFIC_EV.HONK / PED_DOWN / CAR_PANIC (systems/traffic/events.js)
 */
import { PX, TEX_RES, DEPTH, FONT } from '../config.js';
import { listen, bus, EV } from '../core/events.js';
import { opt } from '../core/options.js';
import { PAINT } from '../data/vehicles.js';
import { VEHICLES } from '../data/vehicles.js';
import { weightedPick, pick, clamp } from '../core/math.js';
import { SpatialHash } from './traffic/SpatialHash.js';
import { CarBrain, makeAi, bikeLaneFor } from './traffic/CarBrain.js';
import { buildBikeGraph } from './traffic/BikeGraph.js';
import { Pedestrians } from './traffic/Pedestrians.js';
import { TRAFFIC_EV } from './traffic/events.js';
import { T, TYPE_COLORS, RACK_SITES } from './traffic/config.js';
import { TrafficSignals } from './traffic/Signals.js';
import { EdgeLimits } from './traffic/Limits.js';
import { simNow } from '../core/timescale.js';

const MIX_CACHE = {};
function mixList(mix) {
  const src = mix === 'park' ? T.PARK_MIX : mix === 'cycle' ? T.CYCLE_MIX : T.TRAFFIC_MIX;
  return MIX_CACHE[mix] || (MIX_CACHE[mix] = Object.entries(src).map(([type, weight]) => ({ type, weight })));
}

export class TrafficSystem {
  /** @param {import('../scenes/GameScene.js').GameCtx} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.world = ctx.world;
    this.tuning = T;
    this.density = 1;
    this.cars = [];
    this.parked = [];
    this.vehHash = new SpatialHash(256);
    this.limits = new EdgeLimits(ctx.world); // km/h per drive edge
    this.signals = new TrafficSignals(ctx); // traffic lights (intersection controllers + pooled lamps)
    this.brain = new CarBrain(this);
    this.peds = new Pedestrians(this);
    this.pedestrians = this.peds.list;
    this._tmp = [];
    this._init = false;
    this._carT = 0; this._parkT = 0; this._pedT = 0; this._cycT = 0; this._rackT = 0;
    this.cycCount = 0;
    this.bikeGraph = buildBikeGraph(ctx.world.map.bike); // cycleways from the map (null if absent)
    this.racks = []; // bike-rack clusters near landmarks (see RACK_SITES)
    this._rackImgs = [];
    this._vw = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this._spot = { x: 0, y: 0, a: 0 };
    this._ramCd = new WeakMap();
    // honk bubbles (small pool)
    this._bubbles = [];
    for (let i = 0; i < 5; i++) {
      const t = ctx.scene.add.text(0, 0, 'BEEP!', { fontFamily: FONT, fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5).setDepth(DEPTH.label).setVisible(false);
      this._bubbles.push({ t, life: 0 });
    }

    const sc = ctx.scene;
    listen(sc, EV.DRIVER_EJECTED, ({ vehicle, x, y }) => {
      if (vehicle) this._dropCar(vehicle);
      this.peds.spawnFleeing(x, y, true, 8);
    });
    listen(sc, EV.HORN, ({ x, y }) => this.peds.scare(x, y, 14 * PX, 1.6));
    listen(sc, EV.CRIME, ({ type, severity = 1, x, y }) => {
      if (type === 'pedestrianHit' || x == null) return;
      this.peds.scare(x, y, clamp(18 + severity * 12, 18, 60) * PX, 4 + severity);
    });
    listen(sc, EV.VEHICLE_DESTROYED, ({ vehicle, x, y, cause }) => {
      if (cause === 'explosion') this.peds.scare(x, y, 35 * PX, 6);
      if (vehicle.ai && vehicle.ai.kind === 'traffic') this._abandon(vehicle);
    });
    listen(sc, EV.VEHICLE_BROKEN, ({ vehicle }) => { if (vehicle.ai && vehicle.ai.kind === 'traffic') this._abandon(vehicle); }); // mayhem OFF: broken down, not exploded
    listen(sc, EV.VEHICLE_DAMAGED, ({ vehicle, impact, other }) => this._onDamaged(vehicle, impact, other));
  }

  // ======================= public API =======================
  spawnParked(type, x, y, angle = 0, opts = {}) {
    const v = this.ctx.spawnVehicle(type, x, y, { angle, color: this._colorFor(type), ...opts, driver: null });
    if (opts.track !== false && !v.owned && v.tag == null) this.parked.push(v);
    return v;
  }

  spawnVehicle(type, pos, opts = {}) {
    const def = VEHICLES[type];
    if (!def || def.stealable === false || def.rails) { console.warn('traffic.spawnVehicle refused', type); return null; }
    const mode = opts.mode || 'parked';
    if (mode === 'traffic') {
      const v = this._spawnCar(type, pos.x, pos.y, true);
      if (v && opts.tag != null) { v.tag = opts.tag; this._dropCar(v, false); }
      return v;
    }
    let s = null;
    if (!opts.exact) s = this.findKerbSpotNear(pos.x, pos.y, type);
    const x = s ? s.x : pos.x, y = s ? s.y : pos.y, a = s ? s.a : (pos.angle || 0);
    const free = s ? { x, y } : this.world.findFreeSpot(x, y);
    return this.spawnParked(type, free.x, free.y, a, opts);
  }

  ensureVehicleNear(type, x, y, maxDist = 60 * PX) {
    const v = this.getNearestVehicle(x, y, { type, maxDist, parkedOnly: true, untaggedOnly: true });
    return v || this.spawnVehicle(type, { x, y });
  }

  getVehicles(filter) { return filter ? this.ctx.vehicles.filter(filter) : this.ctx.vehicles; }
  getTrafficCars() { return this.cars; }
  getParkedCars() { return this.parked; }
  isTrafficCar(v) { return this.cars.includes(v); }
  isParked(v) { return this.parked.includes(v); }

  getNearestVehicle(x, y, o = {}) {
    const types = o.types || (o.type ? [o.type] : null);
    const maxD2 = (o.maxDist ?? Infinity) ** 2;
    let best = null, bd = maxD2;
    for (const v of this.ctx.vehicles) {
      if (!v.drivable || v.driver === 'player') continue;
      if (types && !types.includes(v.type)) continue;
      if (o.stealable !== false && v.def.stealable === false) continue;
      if (o.parkedOnly && v.driver) continue;
      if (o.trafficOnly && v.driver !== 'ai') continue;
      if (o.untaggedOnly && v.tag != null) continue;
      const d = (v.x - x) ** 2 + (v.y - y) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  releaseVehicle(v) { this._dropCar(v, false); const i = this.parked.indexOf(v); if (i >= 0) this.parked.splice(i, 1); }
  getPedestrians() { return this.peds.list; }
  getNearestPedestrian(x, y, maxDist) { return this.peds.nearest(x, y, maxDist); }
  scarePedestrians(x, y, r, s = 4) { this.peds.scare(x, y, r, s); }
  setDensity(m) { this.density = clamp(m, 0, 1.5); }

  // ======================= helpers =======================
  inView(x, y, m = 0) {
    const w = this._vw;
    return x > w.x0 - m && x < w.x1 + m && y > w.y0 - m && y < w.y1 + m;
  }

  _colorFor(type) {
    const c = TYPE_COLORS[type];
    return c ? pick(c) : pick(PAINT);
  }

  honk(v) {
    bus.emit(TRAFFIC_EV.HONK, { x: v.x, y: v.y, vehicle: v });
    if (!this.inView(v.x, v.y, 0)) return;
    for (const b of this._bubbles) {
      if (b.life > 0) continue;
      b.life = 0.8; b.t.setText(v.def.cyclist ? 'ding!' : 'BEEP!').setPosition(v.x, v.y - 26).setVisible(true).setAlpha(1);
      return;
    }
  }

  _dropCar(v, clearAi = true) {
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    if (clearAi && v.ai && v.ai.kind === 'traffic') v.ai = null;
  }

  /** Driver bails out of a wrecked/burning car. */
  _abandon(v) {
    this._dropCar(v);
    if (v.driver === 'ai') {
      const p = v.exitPoint();
      v.driver = null;
      v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true;
      this.peds.spawnFleeing(p.x, p.y, true, 7);
    }
  }

  _onDamaged(v, impact, other) {
    const ai = v.ai;
    if (!ai || ai.kind !== 'traffic' || v.driver !== 'ai') return;
    if (v.state !== 'ok') { this._abandon(v); return; }
    if (v.def.cyclist) { this._cyclistHit(v, other, impact); return; }
    if (!other || impact < 2.5) return;
    const byPlayer = other.driver === 'player';
    if (!byPlayer && other.driver !== 'police') return;
    if (ai.rammedCd > 0) return;
    ai.rammedCd = 3;
    const mode = v.def.bike || Math.random() < 0.55 ? 'flee' : 'angry';
    ai.panic = mode === 'flee' ? 4 : 2.5; ai.panicMode = mode;
    if (mode === 'angry') this.honk(v);
    bus.emit(TRAFFIC_EV.CAR_PANIC, { vehicle: v, mode });
    if (byPlayer) {
      const now = simNow();
      if (now > (this._ramCd.get(v) || 0)) {
        this._ramCd.set(v, now + 6000);
        bus.emit(EV.CRIME, { type: 'vehicleHit', severity: 1, x: v.x, y: v.y });
      }
    }
  }

  /** A cyclist is hit by something heavy: thrown off, lies on the road, bike stays behind (stealable). */
  _cyclistHit(v, other, impact) {
    if (!other || impact < 1.2 || (other.mass < 5 && other.driver !== 'player')) return;
    const byPlayer = other.driver === 'player';
    const killed = impact > 9;
    this._dropCar(v);
    v.driver = null; v.ai = null;
    v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true;
    if (v.type === 'bike') v.sprite.setTexture(v.def.tex);
    v._ridden = false;
    this.parked.push(v);
    const p = this.peds.dropRider(v.x, v.y, other.vx, other.vy, killed);
    if (!opt('mayhem')) bus.emit(TRAFFIC_EV.INJURY, { severity: killed ? 2 : 1, byPlayer, killed, x: p.x, y: p.y, vehicle: other }); // fines module, not a CRIME
    else if (byPlayer) bus.emit(EV.CRIME, { type: 'pedestrianHit', severity: killed ? 2 : 1, x: p.x, y: p.y });
    bus.emit(TRAFFIC_EV.PED_DOWN, { x: p.x, y: p.y, killed, byPlayer, vehicle: other });
    this.peds.scare(p.x, p.y, 22 * PX, 4);
  }

  // ======================= spawning: cars =======================
  _typeOk(t) { return VEHICLES[t] && VEHICLES[t].stealable !== false && !VEHICLES[t].rails; }

  /** Find a free lane spot on the drive graph; fills this._spot. */
  _findCarSpot(cx, cy, rMin, rMax, needOffscreen, bike = false) {
    const onPath = bike && this.bikeGraph && Math.random() < T.CYC_PATH_SHARE;
    const g = onPath ? this.bikeGraph : this.world.drive;
    for (let tries = 0; tries < 8; tries++) {
      const n = g.randomNodeInRing(cx, cy, rMin, rMax, 6);
      if (n < 0) continue;
      const outs = g.out[n];
      if (!outs.length) continue;
      const e = outs[Math.floor(Math.random() * outs.length)];
      const ax = g.x[n], ay = g.y[n];
      const dx = g.x[e.to] - ax, dy = g.y[e.to] - ay, l = Math.hypot(dx, dy);
      if (l < 6 * PX) continue;
      const ux = dx / l, uy = dy / l;
      const s = Math.random() * Math.min(l * 0.5, 20 * PX);
      const lane = bike ? bikeLaneFor(e.w) : clamp(e.w / 2 - 2.4 * PX, 1.1 * PX, 2.2 * PX);
      const x = ax + ux * s - uy * lane, y = ay + uy * s + ux * lane;
      if (needOffscreen && this.inView(x, y, 90)) continue;
      if (this.world.isBuilding(x, y) || this.world.isWater(x, y)) continue;
      if (this._crowded(x, y, 7 * PX)) continue;
      const sp = this._spot; sp.x = x; sp.y = y; sp.a = Math.atan2(dy, dx); sp.n = n; sp.to = e.to; sp.g = g;
      return sp;
    }
    return null;
  }

  _crowded(x, y, r) {
    const list = this.vehHash.query(x, y, r + 40, this._tmp);
    const p = this.ctx.player;
    if (!p.vehicle && (p.x - x) ** 2 + (p.y - y) ** 2 < r * r) return true;
    for (let i = 0; i < list.length; i++) if ((list[i].x - x) ** 2 + (list[i].y - y) ** 2 < r * r) return true;
    return false;
  }

  _spawnCar(type, x, y, snap, recycle) {
    const g = this.world.drive;
    let sp;
    if (snap) {
      const n = g.nearest(x, y, 800);
      if (n < 0 || !g.out[n].length) return null;
      const e = g.out[n][0];
      const dx = g.x[e.to] - g.x[n], dy = g.y[e.to] - g.y[n], l = Math.hypot(dx, dy) || 1;
      const lane = VEHICLES[type].cyclist ? bikeLaneFor(e.w) : clamp(e.w / 2 - 2.4 * PX, 1.1 * PX, 2.2 * PX);
      sp = this._spot; sp.x = g.x[n] - (dy / l) * lane; sp.y = g.y[n] + (dx / l) * lane; sp.a = Math.atan2(dy, dx); sp.n = n; sp.to = e.to;
    } else sp = this._lastSpot;
    if (!sp) return null;
    let v = recycle;
    const color = this._colorFor(type);
    if (v) {
      v.x = sp.x; v.y = sp.y; v.angle = sp.a; v.vx = 0; v.vy = 0; v.spin = 0;
      v.health = v.maxHealth; v.state = 'ok'; v.burnT = 0; v.sprite.setAlpha(1);
      if (v.def.tint) v.sprite.setTint(color);
      v.sprite.setPosition(v.x, v.y).setRotation(v.angle);
    } else {
      v = this.ctx.spawnVehicle(type, sp.x, sp.y, { angle: sp.a, color, driver: 'ai' });
      this.cars.push(v);
    }
    v.driver = 'ai';
    v.owned = false;
    v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = false;
    const ai = v.ai && v.ai.kind === 'traffic' ? Object.assign(v.ai, makeAi(v)) : makeAi(v);
    v.ai = ai;
    this.brain.setRoute(ai, sp.n, sp.to, false, snap ? this.world.drive : (sp.g || this.world.drive));
    const cruise = v.def.cyclist ? 4 : 7;
    v.vx = Math.cos(sp.a) * cruise * PX; v.vy = Math.sin(sp.a) * cruise * PX;
    this.vehHash.insert(v);
    return v;
  }

  _fillCar(recycle, initial) {
    const p = this.ctx.player;
    const type = recycle ? recycle.type : weightedPick(mixList('traffic')).type;
    return this._fillOf(type, recycle, initial);
  }

  _fillCyclist(recycle, initial) {
    const type = recycle ? recycle.type : weightedPick(mixList('cycle')).type;
    return this._fillOf(type, recycle, initial);
  }

  _fillOf(type, recycle, initial) {
    const p = this.ctx.player, cyc = !!VEHICLES[type].cyclist;
    const rMin = initial ? 25 * PX : cyc ? T.CYC_SPAWN_MIN : T.CAR_SPAWN_MIN;
    const spot = this._findCarSpot(p.px, p.py, rMin, cyc ? T.CYC_SPAWN_MAX : T.CAR_SPAWN_MAX, !initial, cyc);
    if (!spot) return false;
    this._lastSpot = spot;
    return !!this._spawnCar(type, 0, 0, false, recycle);
  }

  _updateCars(dt) {
    const p = this.ctx.player, cars = this.cars;
    const dsp2 = T.CAR_DESPAWN * T.CAR_DESPAWN, cd2 = (T.CYC_SPAWN_MAX * 1.35) ** 2;
    let cyc = 0;
    for (let i = cars.length - 1; i >= 0; i--) {
      const v = cars[i];
      if (v.destroyed) { cars.splice(i, 1); continue; }
      if (v.driver !== 'ai' || !v.ai || v.ai.kind !== 'traffic') { cars.splice(i, 1); continue; } // stolen etc.
      if (v.state !== 'ok') { this._abandon(v); continue; }
      const ai = v.ai;
      const near = this.inView(v.x, v.y, T.NEAR_MARGIN);
      const far = (v.x - p.px) ** 2 + (v.y - p.py) ** 2 > (ai.cyc ? cd2 : dsp2);
      if ((far || ai.dead) && !this.inView(v.x, v.y, 100)) {
        if (!v.tag && v.health > v.maxHealth * 0.6 && (ai.cyc ? this._fillCyclist(v, false) : this._fillCar(v, false))) continue;
        this.ctx.removeVehicle(v); cars.splice(i, 1); continue;
      }
      if (ai.cyc) cyc++;
      ai.acc += dt;
      if (ai.acc >= (near ? T.TICK_NEAR : T.TICK_FAR)) {
        const d = ai.acc; ai.acc = 0;
        this.brain.step(v, ai, d, this.peds);
      }
    }
    this.cycCount = cyc;
    for (const b of this._bubbles) {
      if (b.life <= 0) continue;
      b.life -= dt; b.t.y -= 12 * dt;
      b.t.setAlpha(clamp(b.life / 0.4, 0, 1));
      if (b.life <= 0) b.t.setVisible(false);
    }
  }

  // ======================= parked cars =======================
  /** Kerb spot on a wide-enough street; fills this._spot (x,y,a). */
  _findParkSpot(cx, cy, rMin, rMax, type, minW = T.PARK_MIN_ROAD) {
    const g = this.world.drive;
    const def = VEHICLES[type];
    for (let tries = 0; tries < 8; tries++) {
      const n = g.randomNodeInRing(cx, cy, rMin, rMax, 6);
      if (n < 0) continue;
      const sp = this._kerbOnNode(n, def, minW);
      if (sp) return sp;
    }
    return null;
  }

  _kerbOnNode(n, def, minW) {
    const g = this.world.drive, outs = g.out[n];
    if (!outs.length) return null;
    const e = outs[Math.floor(Math.random() * outs.length)];
    if (e.w < minW) return null;
    const ax = g.x[n], ay = g.y[n];
    const dx = g.x[e.to] - ax, dy = g.y[e.to] - ay, l = Math.hypot(dx, dy);
    if (l < 22 * PX) return null;
    const ux = dx / l, uy = dy / l;
    const s = (9 + Math.random() * (l / PX - 18)) * PX;
    const off = e.w / 2 - (def.bike ? 0.5 : 0.15) * PX;
    const x = ax + ux * s - uy * off, y = ay + uy * s + ux * off;
    const hl = def.length * PX * 0.5, hw = def.width * PX * 0.5 + 0.25 * PX;
    const w = this.world;
    if (w.isBuilding(x, y) || w.isBuilding(x + ux * hl, y + uy * hl) || w.isBuilding(x - ux * hl, y - uy * hl)) return null;
    if (w.isBuilding(x - uy * hw, y + ux * hw) || w.isWater(x, y)) return null;
    if (this._crowded(x, y, 6 * PX)) return null;
    const sp = this._spot; sp.x = x; sp.y = y; sp.a = Math.atan2(dy, dx);
    return sp;
  }

  findKerbSpotNear(x, y, type) {
    const g = this.world.drive, def = VEHICLES[type];
    const n0 = g.nearest(x, y, 1000);
    if (n0 < 0) return null;
    const seen = [n0];
    for (let i = 0; i < seen.length && i < 25; i++) {
      for (let k = 0; k < 4; k++) {
        const sp = this._kerbOnNode(seen[i], def, 5 * PX);
        if (sp) return { x: sp.x, y: sp.y, a: sp.a };
      }
      for (const e of g.out[seen[i]]) if (!seen.includes(e.to)) seen.push(e.to);
    }
    return null;
  }

  _fillParked(recycle, rMin, rMax) {
    const p = this.ctx.player;
    const type = recycle ? recycle.type : weightedPick(mixList('park')).type;
    const sp = this._findParkSpot(p.px, p.py, rMin, rMax, type);
    if (!sp) return false;
    if (recycle) {
      const v = recycle;
      v.x = sp.x; v.y = sp.y; v.angle = sp.a; v.vx = 0; v.vy = 0; v.spin = 0;
      v.sprite.setPosition(v.x, v.y).setRotation(v.angle);
      if (v.def.tint) v.sprite.setTint(this._colorFor(type));
      this.vehHash.insert(v);
      return true;
    }
    const v = this.spawnParked(type, sp.x, sp.y, sp.a);
    this.vehHash.insert(v);
    return true;
  }

  _updateParked() {
    const p = this.ctx.player, list = this.parked;
    const d2 = T.PARK_DESPAWN * T.PARK_DESPAWN;
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      if (v.destroyed) { list.splice(i, 1); continue; }
      if (v.driver || v.owned || v.tag != null) { list.splice(i, 1); continue; } // taken: no longer ours
      if ((v.x - p.px) ** 2 + (v.y - p.py) ** 2 < d2 || this.inView(v.x, v.y, 100)) continue;
      if (v.state === 'ok' && v.health >= v.maxHealth * 0.99 && v.speed < 4) {
        if (this._fillParked(v, T.PARK_MIN * 3, T.PARK_MAX)) continue;
      }
      this.ctx.removeVehicle(v); list.splice(i, 1);
    }
  }

  // ======================= pedestrians =======================
  _spawnPeds(initial) {
    const p = this.ctx.player, g = this.world.walk;
    const target = Math.min(T.PED_MAX, Math.round(T.PED_TARGET * this.density));
    let budget = initial ? 100 : 3;
    while (this.peds.count < target && budget-- > 0) {
      const n = g.randomNodeInRing(p.px, p.py, initial ? 12 * PX : T.PED_SPAWN_MIN, T.PED_SPAWN_MAX, 6);
      if (n < 0) continue;
      if (!initial && this.inView(g.x[n], g.y[n], 60)) continue;
      this.peds.spawnOnGraph(n);
    }
  }

  _hitPeds() {
    const vs = this.ctx.vehicles, ph = this.peds.hash;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.state === 'sunk' || v.speed < 2.5 * PX) continue;
      const list = ph.query(v.x, v.y, v.boundR + PX, this._tmp);
      for (let k = 0; k < list.length; k++) {
        const q = list[k];
        if (q.state === 'down' || q.state === 'dying') continue;
        for (let c = 0; c < v.offsets.length; c++) {
          const o = v.offsets[c];
          const cx = v.x + Math.cos(v.angle) * o, cy = v.y + Math.sin(v.angle) * o;
          const r = v.radius + 0.35 * PX;
          if ((q.x - cx) ** 2 + (q.y - cy) ** 2 < r * r) { this.peds.knock(q, v, v.driver === 'player'); break; }
        }
      }
    }
  }

  // ======================= parked bike racks =======================
  _siteXY(site) {
    const w = this.world;
    if (site.lm) { const l = w.landmark(site.lm); if (l) return { x: l.x, y: l.y }; }
    if (site.ll) {
      const b = w.map.bbox;
      return { x: ((site.ll[1] - b.west) / (b.east - b.west)) * w.W, y: ((b.north - site.ll[0]) / (b.north - b.south)) * w.H };
    }
    return null;
  }

  _rackFree(x, y, ux, uy) {
    const w = this.world;
    for (const k of [-3.2, -1.6, 0, 1.6, 3.2]) {
      const px = x + ux * k * PX, py = y + uy * k * PX;
      if (w.isBuilding(px, py) || w.isWater(px, py) || w.isRoad(px, py)) return false; // on the pavement, not the carriageway
      if (w.isBuilding(px - uy * 1.1 * PX, py + ux * 1.1 * PX) || w.isBuilding(px + uy * 1.1 * PX, py - ux * 1.1 * PX)) return false;
    }
    return true;
  }

  /** Plan all rack positions once: walk-graph nodes near each site, spaced out, with free ground. */
  _planRacks() {
    const g = this.world.walk;
    if (!g.count) return;
    for (const site of RACK_SITES) {
      const xy = this._siteXY(site);
      if (!xy) continue;
      const n0 = g.nearest(xy.x, xy.y, 1200);
      if (n0 < 0) continue;
      const seen = new Set([n0]), q = [n0], found = [];
      for (let i = 0; i < q.length && i < 400 && found.length < site.racks; i++) {
        const n = q[i];
        for (const e of g.und[n]) if (!seen.has(e.to) && Math.hypot(g.x[e.to] - xy.x, g.y[e.to] - xy.y) < site.spread * PX) { seen.add(e.to); q.push(e.to); }
        if (!g.und[n].length) continue;
        const e0 = g.und[n][0];
        const dx = g.x[e0.to] - g.x[n], dy = g.y[e0.to] - g.y[n], l = Math.hypot(dx, dy) || 1;
        const ux = dx / l, uy = dy / l;
        const off = (found.length % 2 ? 1 : -1) * 1.4 * PX; // beside the path, not on its centre line
        const x = g.x[n] - uy * off, y = g.y[n] + ux * off;
        if (found.some((f) => Math.hypot(f.x - x, f.y - y) < 16 * PX)) continue;
        if (!this._rackFree(x, y, ux, uy)) continue;
        found.push({ x, y, a: Math.atan2(uy, ux), n: T.RACK_SIZE[0] + Math.floor(Math.random() * (T.RACK_SIZE[1] - T.RACK_SIZE[0] + 1)), site: site.id });
      }
      for (const f of found) { f.active = false; f.bikes = []; f.img = null; this.racks.push(f); }
    }
  }

  _activateRack(r) {
    r.active = true;
    const img = this._rackImgs.pop() || this.ctx.scene.add.image(0, 0, 'prop-bikerack').setScale(1 / TEX_RES).setDepth(DEPTH.marker - 1);
    img.setPosition(r.x, r.y).setRotation(r.a).setVisible(true);
    r.img = img;
    const ux = Math.cos(r.a), uy = Math.sin(r.a), slot = T.RACK_SLOT * PX;
    for (let i = 0; i < r.n; i++) {
      const o = (i - (r.n - 1) / 2) * slot;
      const b = this.spawnParked('bike', r.x + ux * o, r.y + uy * o, r.a + Math.PI / 2 + (Math.random() - 0.5) * 0.12, { track: false });
      b.rack = r; b.slot = { x: b.x, y: b.y };
      r.bikes.push(b);
    }
  }

  _deactivateRack(r) {
    r.active = false;
    for (const b of r.bikes) {
      if (b.destroyed || b.driver || b.owned || b.tag != null || b.state !== 'ok' || (b.x - b.slot.x) ** 2 + (b.y - b.slot.y) ** 2 > PX * PX) continue;
      this.ctx.removeVehicle(b);
    }
    r.bikes.length = 0;
    if (r.img) { r.img.setVisible(false); this._rackImgs.push(r.img); r.img = null; }
  }

  _updateRacks() {
    const p = this.ctx.player, act = T.RACK_ACTIVATE ** 2, des = T.RACK_DESPAWN ** 2;
    for (const r of this.racks) {
      const d2 = (r.x - p.px) ** 2 + (r.y - p.py) ** 2;
      if (!r.active && d2 < act) this._activateRack(r);
      else if (r.active && d2 > des && !this.inView(r.x, r.y, 160)) this._deactivateRack(r);
    }
  }

  /** Full density in the centre of Aarhus, thinner out in the suburbs. */
  _cycTarget() {
    const c = this.world.landmark(T.CYC_CENTRE), p = this.ctx.player;
    const near = !c || (c.x - p.px) ** 2 + (c.y - p.py) ** 2 < T.CYC_CENTRE_R ** 2;
    return Math.min(T.CYC_MAX, Math.round(T.CYC_TARGET * this.density * (near ? 1 : T.CYC_OUTSKIRTS)));
  }

  // ======================= main loop =======================
  _firstFrame() {
    this._init = true;
    // remove the foundation's placeholder parked hatchbacks (keep the owned starter car)
    for (const v of this.ctx.vehicles.slice()) {
      if (v.type === 'smallcar' && !v.driver && !v.owned && !v.rentedBy && !v._rentalUid && !v.ai && v.tag == null) this.ctx.removeVehicle(v);
    }
    this._updateView();
    this.vehHash.clear();
    for (const v of this.ctx.vehicles) this.vehHash.insert(v);
    const target = Math.round(T.PARK_TARGET * this.density);
    for (let i = 0, tries = 0; this.parked.length < target && tries < 200; tries++) {
      const near = this.parked.length < 4;
      if (this._fillParked(null, near ? 8 * PX : 35 * PX, near ? 40 * PX : T.PARK_MAX)) i++;
    }
    const ct = Math.round(T.CAR_TARGET * this.density);
    for (let tries = 0; this.cars.length < ct && tries < 120; tries++) this._fillCar(null, true);
    this._planRacks();
    this._updateRacks();
    const cyt = this._cycTarget();
    for (let tries = 0, n = 0; n < cyt && tries < 160; tries++) if (this._fillCyclist(null, true)) n++;
    this.cycCount = this.cars.filter((c) => c.ai && c.ai.cyc).length;
    this._spawnPeds(true);
  }

  _updateView() {
    const w = this.ctx.scene.cameras.main.worldView, vw = this._vw;
    vw.x0 = w.x; vw.y0 = w.y; vw.x1 = w.x + w.width; vw.y1 = w.y + w.height;
  }

  update(dt) {
    if (!this.world.drive.count) return;
    this._updateView();
    if (!this._init) this._firstFrame();
    this.vehHash.clear();
    const vs = this.ctx.vehicles;
    for (let i = 0; i < vs.length; i++) if (vs[i].state !== 'sunk') this.vehHash.insert(vs[i]);

    this.signals.update(dt);
    this._updateCars(dt);
    this.peds.update(dt);
    this._hitPeds();

    this._carT += dt; this._parkT += dt; this._pedT += dt;
    if (this._carT > T.CAR_SPAWN_EVERY) {
      this._carT = 0;
      const target = Math.min(T.CAR_MAX, Math.round(T.CAR_TARGET * this.density));
      if (this.cars.length - this.cycCount < target) this._fillCar(null, false);
    }
    this._cycT += dt; this._rackT += dt;
    if (this._cycT > 0.2) {
      this._cycT = 0;
      if (this.cycCount < this._cycTarget() && this._fillCyclist(null, false)) this.cycCount++;
    }
    if (this._rackT > 0.5) { this._rackT = 0; this._updateRacks(); }
    if (this._parkT > T.PARK_EVERY) {
      this._parkT = 0;
      this._updateParked();
      if (this.parked.length < Math.round(T.PARK_TARGET * this.density)) {
        for (let k = 0; k < 3; k++) if (this._fillParked(null, 45 * PX, T.PARK_MAX)) break;
      }
    }
    if (this._pedT > T.PED_SPAWN_EVERY) { this._pedT = 0; this._spawnPeds(false); }
  }

  destroy() {
    this.peds.destroy();
    this.signals.destroy();
    for (const i of this._rackImgs) i.destroy();
    for (const r of this.racks) if (r.img) r.img.destroy();
    this.racks.length = 0; this._rackImgs.length = 0;
    for (const b of this._bubbles) b.t.destroy();
    this._bubbles.length = 0;
    this.cars.length = 0; this.parked.length = 0;
  }
}
