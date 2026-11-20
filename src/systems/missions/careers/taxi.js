// Taxi career: sign up in the job app, start a shift, drive a company taxi. OWNER: JOBS specialist.
//
// A shift spawns a company taxi (`jobVehicle`) at the nearest real taxi stand (world.getTaxiStands()). While you sit in it
// and are idle, passengers hail at stands or along streets: a fare offer (auto-accepts after 8 s, [N] refuses) that is a normal
// MissionSystem order (pickup -> dropoff, passenger = fragile cargo). The fare is a METER: base + per km + per minute,
// shown live as job.reward on the HUD card. Tip = f(smoothness, speed). Passengers dislike crashes (VEHICLE_DAMAGED) and very
// hard braking (decel above TAXI.hardBrake m/s^2 costs patience; at 0 the passenger bails out).
// The shift ends when you return the taxi to the stand after the shift time, via "End shift" in the app, or automatically
// after leaving the taxi for TAXI.awaySeconds (penalty).
import { PX } from '../../../config.js';
import { bus, EV, pager } from '../../../core/events.js';
import { TUNING, LEVELS, TAXI, CHAIN_RE } from '../../../data/missions.js';
import { MISSION_EV, JOBS_EV } from '../events.js';
import { rnd, pick, dist, clamp, levelInfo, addXp, routeMetres, streetName, roadAngle, spawnJobVehicle } from './shared.js';

let nextFare = 1;
const PLACE_LANDMARKS = ['dokk1', 'aros', 'radhus', 'domkirke', 'gamleby', 'godsbanen', 'salling', 'bruuns', 'train', 'friheden', 'ceres', 'aarhuso', 'havnebad', 'trojborg', 'osterpar', 'kon', 'streetfood', 'latiner', 'hospital'];

export class Taxi {
  constructor(careers) {
    this.careers = careers;
    this.ctx = careers.ctx;
    this.st = careers.ctx.state.jobs.taxi;
    this.shift = null;
    this.parked = null; // vehicle to remove once the player gets out
    const w = this.ctx.world;
    const seen = new Set();
    this.places = [];
    for (const id of PLACE_LANDMARKS) { const l = w.landmark(id); if (l) this.places.push({ x: l.x, y: l.y, name: l.n }); }
    for (const p of w.pois) if (['culture', 'hotel'].includes(p.k) && p.n && !CHAIN_RE.test(p.n) && !seen.has(p.n) && seen.add(p.n)) this.places.push({ x: p.x, y: p.y, name: p.n });
    this._spd = [0, 0]; this._spdT = 0; this._brakeCd = 0;
  }

  get level() { return levelInfo(this.ctx.state, 'taxi').level; }
  get signed() { return this.st.signed; }
  signUp() {
    if (this.st.signed) return;
    this.st.signed = true;
    pager(`Welcome to ${TAXI.company}. Start a shift in the job app (J) and a taxi waits at the nearest stand.`, 'job', 'Jobs');
    bus.emit(JOBS_EV.SIGNED_UP, { career: 'taxi' });
  }

  stands() {
    const w = this.ctx.world;
    return w.getTaxiStands().map((s) => ({ ...s, label: `Taxi stand, ${streetName(w, s.x, s.y) || w.districtAt(s.x, s.y) || 'Aarhus'}` }));
  }

  startShift() {
    const ctx = this.ctx, m = this.careers.missions, pl = ctx.player;
    if (!this.st.signed) return { ok: false, reason: 'Sign up first' };
    if (this.careers.shiftActive()) return { ok: false, reason: 'You are already on a shift' };
    if (m.job || m.offer) return { ok: false, reason: 'Finish your current job first' };
    const stands = this.stands();
    if (!stands.length) return { ok: false, reason: 'No taxi stand on this map' };
    stands.sort((a, b) => Math.hypot(a.x - pl.px, a.y - pl.py) - Math.hypot(b.x - pl.px, b.y - pl.py));
    const s = stands[0];
    const v = spawnJobVehicle(ctx, 'taxi', s.x, s.y, roadAngle(ctx.world, s.node, s.x, s.y), 0xf2cf3a);
    this.shift = {
      career: 'taxi', stage: 'toTaxi', vehicle: v, stand: { x: s.x, y: s.y, name: s.label }, timeLeft: TAXI.shiftSeconds[this.level - 1],
      total: TAXI.shiftSeconds[this.level - 1], fares: 0, earned: 0, fails: 0, awayT: 0, nextHail: rnd(3, 6), pay: 0, level: this.level,
    };
    this.st.shifts++;
    pager(`${TAXI.company}: your taxi waits at ${s.label}. Get in and wait for fares.`, 'job', 'Dispatch');
    bus.emit(JOBS_EV.SHIFT_STARTED, { career: 'taxi', shift: this.shift });
    return { ok: true };
  }

  /** From the app: finish up and return the taxi to the stand. */
  endShift() {
    const s = this.shift;
    if (!s || s.stage === 'return') return false;
    s.stage = 'return';
    s.timeLeft = 0;
    pager(`Return the taxi to ${s.stand.name} to end the shift.`, 'job', 'Dispatch');
    return true;
  }

  _finish(ok, reason) {
    const s = this.shift, ctx = this.ctx, m = this.careers.missions;
    if (!s) return;
    if (m.job?.career === 'taxi') m._fail(reason || 'shift ended');
    if (m.offer && m.offer.job?.career === 'taxi') m.decline('busy');
    let pay = 0;
    if (ok) {
      pay = Math.round(TAXI.shiftBonus * LEVELS[clamp(Math.ceil(s.level / 2), 1, 3) - 1].payMul);
      bus.emit(EV.REQUEST_PAY, { amount: pay, reason: 'taxi shift bonus' });
      addXp(ctx, 'taxi', TAXI.shiftXp + s.fares * 4);
      this.st.best = Math.max(this.st.best, s.earned + pay);
      pager(`Shift done: ${s.fares} fares, ${s.earned + pay} kr (incl. ${pay} kr bonus).`, 'job', TAXI.company);
    } else {
      bus.emit(EV.REQUEST_PAY, { amount: -TAXI.abandonPenalty, reason: 'taxi not returned' });
      pager(`Shift ended: ${reason}. ${TAXI.abandonPenalty} kr charged.`, 'warn', TAXI.company);
    }
    const v = s.vehicle;
    if (ctx.player.vehicle === v) this.parked = v; else if (v && ctx.vehicles.includes(v)) ctx.removeVehicle(v);
    s.stage = 'done';
    this.shift = null;
    bus.emit(JOBS_EV.SHIFT_ENDED, { career: 'taxi', ok, reason: reason || 'completed', pay, shift: s });
  }

  // ---------------------------------------------------------------- fares
  _pickupPoint() {
    const ctx = this.ctx, w = ctx.world, pl = ctx.player, g = w.drive;
    if (Math.random() < TAXI.standOnly) {
      const near = this.stands().filter((s) => { const d = Math.hypot(s.x - pl.px, s.y - pl.py) / PX; return d > 120 && d < 1400; });
      if (near.length) { const s = pick(near); return { x: s.x, y: s.y, name: s.label, where: 'stand' }; }
    }
    for (let k = 0; k < 8; k++) {
      const n = g.randomNodeInRing(pl.px, pl.py, 220 * PX, 850 * PX);
      if (n < 0) continue;
      const street = streetName(w, g.x[n], g.y[n]);
      if (street) return { x: g.x[n], y: g.y[n], name: `Hailing on ${street}`, where: 'street' };
    }
    return null;
  }

  _destination(from) {
    const w = this.ctx.world, g = w.drive, L = this.level, maxM = TAXI.maxMetres[L - 1];
    for (let k = 0; k < 8; k++) {
      if (Math.random() < 0.6) {
        const c = this.places.filter((p) => { const d = dist(p, from) / PX; return d >= TAXI.minMetres * 0.8 && d <= maxM * 0.75; });
        if (c.length) {
          const p = pick(c), metres = routeMetres(w, from, p);
          if (metres >= TAXI.minMetres && metres <= maxM) return { x: p.x, y: p.y, name: p.name, metres };
        }
      } else {
        const n = g.randomNodeInRing(from.x, from.y, TAXI.minMetres * 0.8 * PX, maxM * 0.72 * PX);
        if (n < 0) continue;
        const street = streetName(w, g.x[n], g.y[n]);
        if (!street) continue;
        const metres = routeMetres(w, from, { x: g.x[n], y: g.y[n] });
        if (metres >= TAXI.minMetres && metres <= maxM) return { x: g.x[n], y: g.y[n], name: `${street} ${1 + Math.floor(Math.random() * 79)}`, metres };
      }
    }
    return null;
  }

  meterFare(km, minutes, level = this.level) {
    return (TAXI.base + TAXI.perKm * km + TAXI.perMin * minutes) * TAXI.levelSurcharge[level - 1];
  }

  _hail() {
    const s = this.shift, m = this.careers.missions, ctx = this.ctx;
    const from = this._pickupPoint();
    const to = from && this._destination(from);
    if (!to) { s.nextHail = 5; return; }
    const lvl = clamp(Math.ceil(s.level / 2), 1, 3);
    const nav = ctx.systems?.economy?.getEffects?.().timeLimit ?? 1;
    const est = to.metres / 1000;
    const limit = Math.round(((to.metres / TUNING.speedMps) * TUNING.timeSlack * 1.1 + TUNING.timeBase + TUNING.stopSeconds) * LEVELS[lvl - 1].timeMul * nav);
    const job = {
      id: `taxi${nextFare++}`, kind: 'order', career: 'taxi', title: `Taxa: ${to.name}`, legal: true, level: lvl, state: 'offered',
      stageIndex: 0, timeLeft: null, timeLimit: limit, timerFrom: 1, timerTo: 2, reward: Math.round(this.meterFare(est, est * 1000 / 11 / 60 * 1.3)), metres: Math.round(to.metres),
      cargo: { size: 1, fragile: true, name: 'Passenger' }, passenger: true, damage: 0, loaded: false, requireVehicle: s.vehicle,
      meter: { km: 0, minutes: 0, fare: 0, hardBrakes: 0 },
      stages: [
        { action: 'pickup', x: from.x, y: from.y, name: from.name, radius: TUNING.pickupRadius, loadTime: TUNING.loadSeconds },
        { action: 'dropoff', x: to.x, y: to.y, name: to.name, radius: TUNING.dropRadius },
      ],
      payoutFn: (c, j, { frac, integ }) => {
        const base = Math.round(this.meterFare(j.meter.km, j.meter.minutes, s.level));
        const tipMul = c.systems?.economy?.getEffects?.().tips ?? 1;
        const tip = !j.ticketed && integ > 0.6 && frac > 0.1 ? Math.round(base * TAXI.tipMax * integ * integ * Math.min(1, frac * 1.5) * tipMul * (0.6 + Math.random() * 0.4)) : 0;
        return { base, tip };
      },
    };
    m._makeOffer(job, null, true);
    bus.emit(JOBS_EV.FARE_HAIL, { job, where: from.where });
    s.nextHail = rnd(...TAXI.hailEvery);
  }

  /** A taxi fare (or the Kaj contact's taxi job) ended. */
  onJobEnd(j, ok, info = {}) {
    const s = this.shift;
    if (j.career !== 'taxi') { if (ok && j.template === 'taxiFare') addXp(this.ctx, 'taxi', 12 + j.metres / 50); return; }
    if (s) s.nextHail = rnd(...TAXI.hailEvery);
    if (ok) {
      this.st.fares++;
      this.st.earned += info.payout || 0;
      if (s) { s.fares++; s.earned += info.payout || 0; }
      addXp(this.ctx, 'taxi', TAXI.perFareXp + j.metres / 50);
      bus.emit(JOBS_EV.FARE, { job: j, fare: info.base, tip: info.tip, km: j.meter.km, minutes: j.meter.minutes, hardBrakes: j.meter.hardBrakes });
    } else if (s) s.fails++;
  }

  // ---------------------------------------------------------------- loop
  update(dt) {
    const ctx = this.ctx, pl = ctx.player, m = this.careers.missions;
    if (this.parked && pl.vehicle !== this.parked) {
      if (ctx.vehicles.includes(this.parked)) ctx.removeVehicle(this.parked);
      this.parked = null;
    }
    const s = this.shift;
    if (!s) return;
    const v = s.vehicle;
    if (!ctx.vehicles.includes(v) || v.state === 'wreck' || v.state === 'sunk') { this._finish(false, 'the taxi was lost'); return; }
    const inTaxi = pl.vehicle === v;
    if (s.stage === 'toTaxi') {
      if (inTaxi) { s.stage = 'work'; bus.emit(EV.BANNER, { text: 'TAXI SHIFT STARTED', color: '#F2B134', ms: 1800 }); }
      return;
    }
    s.awayT = inTaxi ? 0 : s.awayT + dt;
    if (s.awayT > TAXI.awaySeconds) { this._finish(false, 'you left the taxi'); return; }
    if (s.stage === 'work') {
      s.timeLeft -= dt;
      const busy = m.job || m.offer;
      if (s.timeLeft <= 0 && !busy) { s.stage = 'return'; pager(`Shift time is up: return the taxi to ${s.stand.name}.`, 'job', 'Dispatch'); }
      else if (!busy && inTaxi) { s.nextHail -= dt; if (s.nextHail <= 0) this._hail(); }
    } else if (s.stage === 'return') {
      if (inTaxi && Math.hypot(pl.px - s.stand.x, pl.py - s.stand.y) < TAXI.returnRadiusM * PX && v.speedMps < 3) this._finish(true);
    }
    this._meter(dt, v);
  }

  _meter(dt, v) {
    const j = this.careers.missions.job;
    if (!j || j.career !== 'taxi' || !j.loaded || j.stageIndex !== 1 || this.ctx.player.vehicle !== v) { this._spdT = 0; this._spd[0] = v.speedMps; return; }
    const mt = j.meter;
    mt.km += (v.speed * dt) / PX / 1000;
    mt.minutes += dt / 60;
    j.reward = Math.round(this.meterFare(mt.km, mt.minutes, this.shift?.level || this.level));
    this._brakeCd -= dt;
    this._spdT += dt;
    if (this._spdT >= 0.25) {
      const cur = v.speedMps, prev = this._spd[0];
      const decel = (prev - cur) / this._spdT;
      this._spd[0] = cur;
      this._spdT = 0;
      if (prev > 6 && decel > TAXI.hardBrake && this._brakeCd <= 0) {
        this._brakeCd = 1.5;
        mt.hardBrakes++;
        j.damage += TAXI.hardBrakePenalty * v.maxHealth * 0.6;
        const integrity = Math.max(0, 1 - j.damage / (v.maxHealth * 0.6));
        bus.emit(MISSION_EV.CARGO, { job: j, damage: j.damage, integrity });
        this.careers.missions._hint('Easy on the brakes, the passenger is not happy');
        if (integrity <= 0.05) this.careers.missions._fail('the passenger bailed out');
      }
    }
  }

  // ---------------------------------------------------------------- UI helpers
  targetPoint() {
    const s = this.shift, m = this.careers.missions;
    if (!s || m.job || m.offer) return null;
    if (s.stage === 'toTaxi') return { x: s.vehicle.x, y: s.vehicle.y, name: 'Your taxi', action: 'enter' };
    if (s.stage === 'return') return { x: s.stand.x, y: s.stand.y, name: s.stand.name, action: 'dropoff' };
    return null;
  }

  draw(mk, time) {
    const t = this.targetPoint();
    if (t) mk.draw({ kind: t.action === 'enter' ? 'target' : 'dropoff', x: t.x, y: t.y, r: TAXI.returnRadiusM * PX, label: t.name }, time);
  }
}
