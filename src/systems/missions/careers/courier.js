// Courier career: "Bybud" order feed. OWNER: JOBS specialist.
//
// Offers (restaurants/cafes -> a home address on a real street) are generated from real Aarhus POIs, chains filtered
// out, busy hubs (Latinerkvarteret, Jaegergaardsgade, Aarhus Street Food, ...) weighted up. The player accepts or
// declines in the job app. An accepted offer becomes a normal MissionSystem order (pickup -> dropoff, timer, capacity,
// fragile cargo, economy.scalePayout + tips), so the HUD card and all JOB_* events work unchanged.
//
// Rating 1..5 (state.jobs.courier.rating): mean of the last 20 delivery scores (on time, fast, damage) blended with the
// accept/decline rate. A higher rating gives more offers (2..5), better pay (+8% per star above 3) and bigger tips.
import { PX } from '../../../config.js';
import { bus } from '../../../core/events.js';
import { TUNING, LEVELS, COURIER, CHAIN_RE } from '../../../data/missions.js';
import { JOBS_EV } from '../events.js';
import { rnd, pick, dist, clamp, levelInfo, addXp, routeMetres, streetName } from './shared.js';

let nextOfferId = 1;

export class Courier {
  constructor(careers) {
    this.careers = careers;
    this.ctx = careers.ctx;
    this.st = careers.ctx.state.jobs.courier;
    this.offers = [];
    this._t = 0; // seconds until the next offer may appear
    this._boot = true;
    const w = this.ctx.world;
    const seen = new Set();
    this.pool = w.pois.filter((p) => (p.k === 'food' || p.k === 'cafe') && p.n && !CHAIN_RE.test(p.n) && !seen.has(p.n) && seen.add(p.n));
    this.hubs = COURIER.hubs.map((id) => w.landmark(id)).filter(Boolean);
    this._dmg = 0;
  }

  get level() { return levelInfo(this.ctx.state, 'courier').level; }
  get rating() { return this.st.rating; }
  targetCount() { const r = this.st.rating; return r >= 4.5 ? 5 : r >= 3.5 ? 4 : r >= 2.5 ? 3 : 2; }

  /** Reward of an order: base + distance, career level, rating, size and fragility. */
  rewardFor(metres, size, fragile) {
    const L = this.level;
    const r = (TUNING.payBase + metres * TUNING.payPerMetre) * COURIER.payMul * COURIER.levelPay[L - 1] * (1 + 0.08 * (this.st.rating - 3)) * (size > 1 ? 1.2 : 1) * (fragile ? 1.1 : 1);
    return Math.round(r);
  }

  _gen() {
    const ctx = this.ctx, w = ctx.world, pl = ctx.player, g = w.drive;
    if (!pl || !this.pool.length || !g) return null;
    const L = this.level, maxM = COURIER.maxMetres[L - 1];
    const used = new Set(this.offers.map((o) => o.from.name));
    for (let attempt = 0; attempt < 6; attempt++) {
      const widen = 1 + attempt * 0.6;
      const lo = COURIER.pickupRangeM[0] * PX, hi = COURIER.pickupRangeM[1] * widen * PX;
      const cand = [];
      let tot = 0;
      for (const p of this.pool) {
        if (used.has(p.n)) continue;
        const d = Math.hypot(p.x - pl.px, p.y - pl.py);
        if (d < lo || d > hi) continue;
        let wgt = 1;
        for (const h of this.hubs) if (Math.hypot(p.x - h.x, p.y - h.y) < COURIER.hubRadiusM * PX) { wgt = 3; break; }
        cand.push([p, wgt]);
        tot += wgt;
      }
      if (!cand.length) continue;
      let r = Math.random() * tot, from = cand[0][0];
      for (const [p, wgt] of cand) { r -= wgt; if (r <= 0) { from = p; break; } }
      for (let k = 0; k < 6; k++) {
        const n = g.randomNodeInRing(from.x, from.y, COURIER.minMetres * 0.8 * PX, maxM * 0.72 * PX);
        if (n < 0) continue;
        const dx = g.x[n], dy = g.y[n];
        const street = streetName(w, dx, dy);
        if (!street) continue;
        const metres = Math.round(routeMetres(w, from, { x: dx, y: dy }));
        if (metres < COURIER.minMetres || metres > maxM) continue;
        const addr = `${street} ${1 + Math.floor(Math.random() * 79)}`;
        const item = pick(COURIER.items);
        const size = L >= 3 && Math.random() < 0.3 ? 2 + Math.floor(Math.random() * (COURIER.sizeMax[L - 1] - 1)) : 1;
        const fragile = COURIER.fragile.includes(item);
        return {
          id: nextOfferId++, from: { x: from.x, y: from.y, name: from.n, kind: from.k },
          to: { x: dx, y: dy, name: addr, street }, item, size, fragile, metres,
          reward: this.rewardFor(metres, size, fragile), life: rnd(...COURIER.offerLife),
        };
      }
    }
    return null;
  }

  /** Straight-line metres from the player to an offer's pickup (for the list). */
  pickupMetres(o) {
    const pl = this.ctx.player;
    return pl ? Math.round(Math.hypot(o.from.x - pl.px, o.from.y - pl.py) / PX) : 0;
  }

  update(dt) {
    if (!this.ctx.player) return;
    let changed = false;
    for (let i = this.offers.length - 1; i >= 0; i--) {
      this.offers[i].life -= dt;
      if (this.offers[i].life <= 0) { this.offers.splice(i, 1); changed = true; }
    }
    this._t -= dt;
    const want = this.targetCount();
    if (this._boot) {
      this._boot = false;
      for (let i = 0; i < Math.min(3, want); i++) { const o = this._gen(); if (o) { this.offers.push(o); changed = true; } }
      this._t = rnd(...COURIER.offerEvery);
    } else if (this._t <= 0) {
      this._t = rnd(...COURIER.offerEvery);
      if (this.offers.length < want) { const o = this._gen(); if (o) { this.offers.push(o); changed = true; } }
      else if (this.offers.length > want) { this.offers.shift(); changed = true; }
    }
    if (changed) bus.emit(JOBS_EV.OFFERS, { offers: this.offers });
  }

  _decide(accepted) {
    const d = this.st.decisions;
    d.push(accepted ? 1 : 0);
    while (d.length > COURIER.ratingWindow) d.shift();
    this._recompute();
  }

  _recompute() {
    const s = this.st.scores;
    const avg = (s.reduce((a, b) => a + b, 0) + COURIER.startRating * 2) / (s.length + 2);
    const d = this.st.decisions;
    const acc = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 1;
    const before = this.st.rating;
    this.st.rating = Math.round(clamp(0.8 * avg + 0.2 * (1 + 4 * acc), 1, 5) * 100) / 100;
    if (this.st.rating !== before) bus.emit(JOBS_EV.RATING, { rating: this.st.rating });
  }

  decline(id) {
    const i = this.offers.findIndex((o) => o.id === id);
    if (i < 0) return false;
    this.offers.splice(i, 1);
    this.st.declined++;
    this._decide(false);
    bus.emit(JOBS_EV.OFFERS, { offers: this.offers });
    return true;
  }

  /** Accept an offer: becomes the active order. Returns { ok, reason }. */
  accept(id) {
    const m = this.careers.missions;
    const i = this.offers.findIndex((o) => o.id === id);
    if (i < 0) return { ok: false, reason: 'That order is gone' };
    if (m.job || m.offer) return { ok: false, reason: 'Finish your current job first' };
    if (this.careers.shiftActive()) return { ok: false, reason: 'End your shift first' };
    const o = this.offers[i];
    this.offers.splice(i, 1);
    this._decide(true);
    this._dmg = 0;
    m.startJob(this.buildJob(o));
    bus.emit(JOBS_EV.OFFERS, { offers: this.offers });
    return { ok: true };
  }

  buildJob(o) {
    const ctx = this.ctx, L = this.level;
    const lvl = clamp(Math.ceil(L / 2), 1, 3);
    const veh = ctx.player.vehicle;
    const speed = Math.max(3.5, (veh?.def?.maxSpeed ?? 6) * 0.7);
    const nav = ctx.systems?.economy?.getEffects?.().timeLimit ?? 1;
    const limit = Math.round(((o.metres / speed) * TUNING.timeSlack + TUNING.timeBase + TUNING.stopSeconds) * LEVELS[lvl - 1].timeMul * nav);
    return {
      id: `bybud${o.id}`, kind: 'order', career: 'courier', title: `Bybud: ${o.item}`, legal: true, level: lvl, state: 'offered',
      stageIndex: 0, timeLeft: null, timeLimit: limit, timerFrom: 1, timerTo: 2, reward: o.reward, metres: o.metres,
      cargo: { size: o.size, fragile: o.fragile, name: o.item }, damage: 0, loaded: false, offerId: o.id,
      stages: [
        { action: 'pickup', x: o.from.x, y: o.from.y, name: o.from.name, radius: TUNING.pickupRadius, requires: { capacity: o.size }, loadTime: TUNING.loadSeconds },
        { action: 'dropoff', x: o.to.x, y: o.to.y, name: o.to.name, radius: TUNING.dropRadius },
      ],
    };
  }

  onDamaged(amount) { this._dmg += amount; }

  /** A courier job (or a lunch-rush contact job) ended. */
  onJobEnd(j, ok, info = {}) {
    if (j.career !== 'courier') { if (ok && j.template === 'foodRush') addXp(this.ctx, 'courier', 12 + j.metres / 60); return; }
    const st = this.st, maxHp = this.ctx.player.vehicle?.maxHealth ?? 30;
    let score;
    if (ok) {
      const frac = clamp(info.frac ?? 0.5, 0, 1);
      score = 3.5 + 1.5 * Math.min(1, frac * 1.6) - Math.min(2, (this._dmg / (maxHp * 0.5)) * 2);
      if (j.cargo.fragile) score -= 2 * (1 - clamp(info.integ ?? 1, 0, 1));
      st.done++;
      st.earned += info.payout || 0;
      addXp(this.ctx, 'courier', 10 + j.metres / 60 + (j.cargo.size > 1 ? 6 : 0));
    } else {
      st.failed++;
      score = /time/.test(info.reason || '') ? 1.5 : /abandon/.test(info.reason || '') ? 1 : 2;
    }
    st.scores.push(Math.round(clamp(score, 1, 5) * 10) / 10);
    while (st.scores.length > COURIER.ratingWindow) st.scores.shift();
    this._recompute();
  }
}
