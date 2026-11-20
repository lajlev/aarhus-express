// Bus career: sign up in the job app, pick a REAL Aarhus bus route (world.getBusRoutes(), 45 routes), drive a shift. OWNER: JOBS specialist.
//
// A shift spawns a city bus (jobVehicle, 'bus' vehicle type, see ensureBusType) at the route's first stop. The state.job of a
// shift is `{ kind: 'shift', career: 'bus', shift: true, stages: [enter, stop 1..n-1] }`, so the HUD card and arrow work.
// Stop at each stop: be inside the stop zone (BUS.stopRadiusM) slower than BUS.stopSpeed for BUS.boardSeconds (progress goes out
// as MISSION_EV.LOADING). Drive past without stopping and the stop is skipped (penalty). A schedule (route metres / BUS.avgMps +
// dwell per stop) gives ahead/behind: job.timeLeft = seconds to the scheduled arrival at the next stop (0 when late).
// Pay (once, at the end of the shift): per stop + punctuality bonus per stop + completion bonus (+ perfect bonus when every stop
// was punctual), minus skipped-stop and damage penalties; scaled by career level. Leaving the bus for BUS.awaySeconds ends the
// shift with a penalty.
import { PX, TEX_RES } from '../../../config.js';
import { bus, EV, pager } from '../../../core/events.js';
import { VEHICLES } from '../../../data/vehicles.js';
import { BUS } from '../../../data/missions.js';
import { MISSION_EV, JOBS_EV } from '../events.js';
import { rnd, clamp, levelInfo, addXp, routeMetres, roadAngle, spawnJobVehicle, dist } from './shared.js';

/** Registers VEHICLES.bus (heavy, 12 m) when data/vehicles.js does not define it yet, plus a fallback texture. */
export function ensureBusType(scene) {
  if (!VEHICLES.bus) VEHICLES.bus = { ...BUS.vehicle };
  const def = VEHICLES.bus;
  if (scene && !scene.textures.exists(def.tex)) {
    const L = Math.ceil(def.length * PX * TEX_RES), W = Math.ceil(def.width * PX * TEX_RES);
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xe5b51d, 1).fillRoundedRect(0, 0, L, W, 10);
    g.fillStyle(0x3a4350, 1).fillRect(L * 0.1, W * 0.14, L * 0.8, W * 0.72);
    g.fillStyle(0x1b2430, 1).fillRect(L * 0.9, W * 0.1, L * 0.06, W * 0.8);
    g.generateTexture(def.tex, L, W);
    g.destroy();
  }
  return def;
}

let nextShift = 1;

export class BusCareer {
  constructor(careers) {
    this.careers = careers;
    this.ctx = careers.ctx;
    this.st = careers.ctx.state.jobs.bus;
    this.shift = null;
    this.parked = null;
    this._dwellEmit = 0;
  }

  get level() { return levelInfo(this.ctx.state, 'bus').level; }
  get signed() { return this.st.signed; }
  maxStops() { return BUS.stopsPerShift[this.level - 1]; }

  signUp() {
    if (this.st.signed) return;
    this.st.signed = true;
    pager(`Welcome to ${BUS.company}. Pick a route in the job app (J); a bus waits at its first stop.`, 'job', 'Jobs');
    bus.emit(JOBS_EV.SIGNED_UP, { career: 'bus' });
  }

  /** Real routes usable for a shift, nearest first stop first: [{ idx, ref, name, from, to, stopCount, shiftStops, first:{name,x,y}, firstM }]. */
  routes() {
    const w = this.ctx.world, pl = this.ctx.player, stops = w.getBusStops(), cap = this.maxStops();
    const out = [];
    w.getBusRoutes().forEach((r, idx) => {
      const list = [];
      for (const si of r.stops) { const s = stops[si]; if (s && (!list.length || list[list.length - 1] !== s)) list.push(s); }
      if (list.length < BUS.minRouteStops) return;
      const first = list[0];
      out.push({
        idx, ref: r.ref, name: r.name, from: r.from, to: r.to, stopCount: list.length, shiftStops: Math.min(list.length, cap),
        first: { name: first.name, x: first.x, y: first.y }, firstM: pl ? Math.round(Math.hypot(first.x - pl.px, first.y - pl.py) / PX) : 0,
      });
    });
    out.sort((a, b) => a.firstM - b.firstM);
    return out;
  }

  startShift(routeIdx) {
    const ctx = this.ctx, m = this.careers.missions, w = ctx.world;
    if (!this.st.signed) return { ok: false, reason: 'Sign up first' };
    if (this.careers.shiftActive()) return { ok: false, reason: 'You are already on a shift' };
    if (m.job || m.offer) return { ok: false, reason: 'Finish your current job first' };
    const route = w.getBusRoutes()[routeIdx];
    if (!route) return { ok: false, reason: 'Unknown route' };
    const all = w.getBusStops();
    const list = [];
    for (const si of route.stops) { const s = all[si]; if (s && (!list.length || list[list.length - 1] !== s)) list.push(s); }
    const stops = list.slice(0, this.maxStops());
    if (stops.length < BUS.minRouteStops) return { ok: false, reason: 'Route too short' };
    ensureBusType(ctx.scene);
    const first = stops[0];
    const v = spawnJobVehicle(ctx, 'bus', first.x, first.y, roadAngle(w, first.node, first.x, first.y, stops[1]), 0xffffff);
    // schedule: offsets in seconds from leaving the first stop
    const sched = [0];
    for (let i = 1; i < stops.length; i++) sched.push(sched[i - 1] + routeMetres(w, stops[i - 1], stops[i]) / BUS.avgMps + BUS.dwellSeconds);
    const level = this.level;
    const job = {
      id: `bus${nextShift++}`, kind: 'shift', career: 'bus', shift: true, title: `Linje ${route.ref}: ${route.from} - ${route.to}`, legal: true, level: clamp(Math.ceil(level / 2), 1, 3),
      state: 'offered', stageIndex: 0, timeLeft: null, timeLimit: Math.round(sched[sched.length - 1]), timerFrom: 1e9, timerTo: 1e9, reward: 0, metres: 0,
      cargo: { size: 0, fragile: false, name: 'Passengers' }, damage: 0, loaded: true,
      stages: [
        { action: 'enter', vehicle: v, x: first.x, y: first.y, name: `Bus at ${first.name}`, radius: 90 },
        ...stops.slice(1).map((s) => ({ action: 'busstop', x: s.x, y: s.y, name: s.name, radius: BUS.stopRadiusM * PX })),
      ],
    };
    this.shift = {
      career: 'bus', route: { ref: route.ref, name: route.name, from: route.from, to: route.to }, vehicle: v, stops, sched, job, level,
      clock: 0, dwell: 0, entered: false, awayT: 0, served: 0, skipped: 0, punctual: 0, pay: 0, damage: 0, onboard: 0, lastLate: 0, lastStop: '',
    };
    this.st.shifts++;
    m.startJob(job);
    pager(`${BUS.company}: bus ${route.ref} waits at ${first.name}. ${stops.length - 1} stops, follow the schedule.`, 'job', 'Dispatch');
    bus.emit(JOBS_EV.SHIFT_STARTED, { career: 'bus', shift: this.shift });
    return { ok: true };
  }

  /** The shift job was failed by MissionSystem (death, busted): settle without finishing the job again. */
  externalEnd(reason) { if (this.shift) this._finish(false, reason, true); }

  /** From the app: abort the shift (pays what you earned minus the abandon penalty once under way). */
  endShift() { if (this.shift) this._finish(false, 'shift ended by you'); }

  onDamaged(amount) { if (this.shift) this.shift.damage += amount; }

  /** Scheduled seconds minus clock for the next stop (positive = ahead of schedule), or null. */
  aheadBehind() {
    const s = this.shift;
    if (!s || s.job.stageIndex < 1) return null;
    return s.sched[s.job.stageIndex] - s.clock;
  }

  dwellFrac() { return this.shift ? clamp(this.shift.dwell / BUS.boardSeconds, 0, 1) : 0; }

  _finish(ok, reason, external = false) {
    const s = this.shift, m = this.careers.missions, ctx = this.ctx;
    if (!s) return;
    const pm = BUS.levelPay[s.level - 1];
    const lastIdx = s.stops.length - 1;
    const dmgFrac = clamp(s.damage / s.vehicle.maxHealth, 0, 1);
    let payout = s.pay;
    const started = s.job.stageIndex >= 1;
    if (ok) {
      payout += BUS.completeBonus * pm + (s.skipped === 0 && s.punctual === lastIdx ? BUS.perfectBonus * pm : 0);
      payout -= BUS.damagePenalty * dmgFrac;
    } else if (started) {
      payout -= BUS.damagePenalty * dmgFrac + BUS.abandonPenalty;
    }
    payout = Math.max(0, Math.round(payout));
    this.st.stops += s.served;
    this.st.punctual += s.punctual;
    this.st.earned += payout;
    if (started) addXp(ctx, 'bus', s.served * BUS.stopXp + s.punctual * BUS.punctualXp + (ok ? BUS.shiftXp : 0));
    if (payout > 0) bus.emit(EV.REQUEST_PAY, { amount: payout, reason: 'bus shift' });
    if (!external) m.finishShift(s.job, { ok, payout, reason, notes: `${s.served}/${lastIdx} stops, ${s.punctual} punctual${s.skipped ? `, ${s.skipped} skipped` : ''}${dmgFrac > 0.05 ? `, damage -${Math.round(BUS.damagePenalty * dmgFrac)} kr` : ''}` });
    const v = s.vehicle;
    if (ctx.player.vehicle === v) this.parked = v; else if (ctx.vehicles.includes(v)) ctx.removeVehicle(v);
    this.shift = null;
    bus.emit(JOBS_EV.SHIFT_ENDED, { career: 'bus', ok, reason: reason || 'completed', pay: payout, shift: s });
  }

  _stop(served) {
    const s = this.shift, j = s.job, k = j.stageIndex, pm = BUS.levelPay[s.level - 1];
    const stop = s.stops[k];
    const late = s.clock - s.sched[k];
    const onTime = served && late >= BUS.onTimeWindow[0] && late <= BUS.onTimeWindow[1];
    let boarded = 0, alighted = 0;
    if (served) {
      alighted = Math.min(s.onboard, Math.round(rnd(0, 9)));
      boarded = Math.round(rnd(1, 10));
      s.onboard += boarded - alighted;
      s.served++;
      if (onTime) s.punctual++;
      s.pay += BUS.payPerStop * pm + (onTime ? BUS.punctualBonus * pm : 0);
      pager(`${stop.name}: ${alighted} off, ${boarded} on. ${onTime ? 'On time' : late < 0 ? 'Early' : `${Math.round(late)} s late`}.`, 'job', 'Bus');
    } else {
      s.skipped++;
      s.pay -= BUS.skipPenalty;
      pager(`Skipped ${stop.name}: passengers left behind (-${BUS.skipPenalty} kr).`, 'warn', 'Bus');
    }
    s.lastLate = late;
    s.lastStop = stop.name;
    j.reward = Math.max(0, Math.round(s.pay));
    bus.emit(JOBS_EV.BUS_STOP, { index: k, name: stop.name, served, skipped: !served, lateness: Math.round(late), onTime, boarded, alighted });
    s.dwell = 0;
    s.entered = false;
    bus.emit(MISSION_EV.LOADING, { job: j, t: 0 });
    if (k >= j.stages.length - 1) { this._finish(true); return; }
    this.careers.missions.shiftStage(k + 1);
  }

  update(dt) {
    const ctx = this.ctx, pl = ctx.player;
    if (this.parked && pl.vehicle !== this.parked) {
      if (ctx.vehicles.includes(this.parked)) ctx.removeVehicle(this.parked);
      this.parked = null;
    }
    const s = this.shift;
    if (!s) return;
    const v = s.vehicle, j = s.job;
    if (this.careers.missions.job !== j) { this._finish(false, 'shift ended', true); return; } // job ended elsewhere
    if (!ctx.vehicles.includes(v) || v.state === 'wreck' || v.state === 'sunk') { this._finish(false, 'the bus was lost'); return; }
    const inBus = pl.vehicle === v;
    if (j.stageIndex === 0) {
      if (inBus) { s.clock = 0; this.careers.missions.shiftStage(1); bus.emit(EV.BANNER, { text: `BUS ${s.route.ref}: SHIFT STARTED`, color: '#F2B134', ms: 1800 }); }
      return;
    }
    s.clock += dt;
    s.awayT = inBus ? 0 : s.awayT + dt;
    if (s.awayT > BUS.awaySeconds) { this._finish(false, 'you left the bus'); return; }
    const k = j.stageIndex, stop = s.stops[k];
    j.timeLeft = Math.max(0, s.sched[k] - s.clock);
    const R = BUS.stopRadiusM * PX;
    const d = Math.hypot(v.x - stop.x, v.y - stop.y);
    if (d < R * 1.8) s.entered = true;
    if (d <= R && v.speedMps < BUS.stopSpeed && inBus) {
      s.dwell += dt;
      this._dwellEmit -= dt;
      if (this._dwellEmit <= 0) { this._dwellEmit = 0.1; bus.emit(MISSION_EV.LOADING, { job: j, t: this.dwellFrac() }); }
      if (s.dwell >= BUS.boardSeconds) {
        const early = s.sched[k] + BUS.onTimeWindow[0] - s.clock; // seconds until the punctual window opens
        if (early > 0 && s.dwell < BUS.boardSeconds + BUS.holdMax) this.careers.missions._hint(`Ahead of schedule: hold ${Math.ceil(early)} s`);
        else this._stop(true);
      }
      return;
    }
    if (s.dwell > 0) { s.dwell = Math.max(0, s.dwell - dt * 2); bus.emit(MISSION_EV.LOADING, { job: j, t: this.dwellFrac() }); }
    if (d <= R && v.speedMps >= BUS.stopSpeed) this.careers.missions._hint('Slow down to stop at the bus stop');
    const next = s.stops[k + 1];
    if ((s.entered && d > R * 2.4) || (next && dist(v, next) < R && d > R)) this._stop(false);
  }

  targetPoint() { return null; } // the shift job's stages drive the arrow
  draw() {}
}
