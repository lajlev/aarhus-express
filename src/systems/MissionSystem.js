/**
 * MissionSystem: delivery orders + side missions from contacts.   OWNER: missions specialist
 *
 * ===================== PUBLIC API (ctx.systems.missions) =====================
 *   job                    active job (state.job) or null (state 'active')
 *   offer                  pending offer ({ job, contact, ... }) or null
 *   accept() / decline()   respond to the pending offer (same as the [Y] / [N] keys, handled here)
 *   abandon()              fail the active job ('abandoned')
 *   targetPoint()          { x, y, name, action } for the arrow / minimap, or null
 *   completedLevels(tpl)   completed level count of a contact template
 *   contactMarkers()       [{ id, name, x, y, legal }] for the minimap
 *
 * FLOW (state machine, job.state): offered -> active -> (success | failed)
 *   Stages (job.stages[stageIndex].action): 'enter' (get in the given vehicle), 'pickup' (stop inside
 *   the marker 1.5 s to load), 'dropoff', 'steal' (steal a car of vehicleType), 'lose' (get heat to 0).
 *
 * DECISIONS
 *   - Every VEHICLE_STOLEN with no active job and no pending offer creates a delivery ORDER offer.
 *     Orders auto-accept after 8 s (press [N] to refuse, [Y] to accept at once). Contact missions
 *     need [Y] (walk up to the contact marker, offer withdrawn when you leave).
 *   - Stealing a car while a job is active KEEPS the current job (pager note); no swap prompt.
 *   - The timer starts when the stage `job.timerFrom` is reached (for orders: once loaded).
 *   - Fragile cargo / passengers lose integrity from VEHICLE_DAMAGED; ruined at 0 (fail), payout shrinks before.
 *   - Payout = base(distance) * (0.7 + 0.5 * timeLeft/timeLimit) * integrity factor, scaled by
 *     economy.scalePayout (Charm), plus a tip (economy getEffects().tips) for clean fast jobs.
 *   - Contact mission levels (1-3) unlock in sequence: state.missions.levels[template] = completed count.
 *

 * CAREERS (careers/): courier "Bybud" offers, taxi shifts and bus shifts live in missions/careers/*; MissionSystem exposes
 *   careers (public API in careers/index.js), startJob(job), shiftStage(i), finishShift(job, {...}). Job fields added: career,
 *   requireVehicle, payoutFn, shift (bus). Taxi fares and bus shifts set state.job so the HUD card works.
 *
 * OPTIONS: steal-triggered orders only when options.theft is on; criminal contacts (legal:false) only when
 *   options.criminalMissions is on (core/options.js). Vehicles supplied by a legal job are marked `jobVehicle`.
 *
 * Listens: VEHICLE_STOLEN, PLAYER_ENTERED_VEHICLE, VEHICLE_DAMAGED, VEHICLE_DESTROYED, BUSTED, PLAYER_DIED
 * Emits:   EV.JOB_OFFERED { job, contact?, auto, expiresIn }, EV.JOB_STARTED, EV.JOB_STAGE, EV.JOB_COMPLETED
 *          { job, payout, tip, base }, EV.JOB_FAILED { job, reason }, EV.REQUEST_PAY, EV.CRIME, EV.PAGER,
 *          EV.BANNER, plus MISSION_EV.* (systems/missions/events.js).
 * State:   state.jobs = { courier, taxi, bus } (saved, see careers/index.js), state.job (transient), state.contactCooldowns, state.missions = { levels: { [template]: n } },
 *          stats.deliveries / stats.missions.
 *
 * Job shape (read by HUD):
 *  { id, kind: 'order'|'mission', template?, level, title, legal, contactId?, state,
 *    stages: [{ action, x, y, name, radius, requires?: { capacity } }], stageIndex,
 *    timeLeft: seconds|null, timeLimit, reward, metres, cargo: { size, fragile, name }, damage, loaded }
 */
import Phaser from 'phaser';
import { PX } from '../config.js';
import { listen, EV, bus, pager } from '../core/events.js';
import { getContacts } from '../data/contacts.js';
import { opt, contactEnabled } from '../core/options.js';
import { TUNING, TEMPLATES } from '../data/missions.js';
import { POLICE_EV } from './police/tuning.js';
import { MISSION_EV } from './missions/events.js';
import { MarkerLayer } from './missions/markers.js';
import { buildOrder, buildMission } from './missions/builders.js';
import { Careers } from './missions/careers/index.js';

export class MissionSystem {
  constructor(ctx) {
    this.ctx = ctx;
    const st = ctx.state;
    st.job = null;
    st.missions = st.missions || {};
    st.missions.levels = st.missions.levels || {};
    st.contactCooldowns = st.contactCooldowns || {};
    const now = ctx.scene.time.now;
    for (const k of Object.keys(st.contactCooldowns)) if (st.contactCooldowns[k] > now + 3e5) st.contactCooldowns[k] = 0; // stale clock from an older session

    this.offer = null;
    // Criminal contacts (Ravn, Sille) are hidden and disabled unless the criminalMissions option is on.
    this.contacts = getContacts(ctx.city?.id || st.cityId).filter(contactEnabled).map((c) => {
      const lm = ctx.world.landmark(c.at);
      return lm ? { ...c, x: lm.x, y: lm.y } : null;
    }).filter(Boolean);
    this.markers = new MarkerLayer(ctx.scene);
    this.careers = new Careers(this); // courier / taxi / bus careers (state.jobs), see missions/careers/index.js
    this._loadT = 0;
    this._timerEmit = 0;
    this._targetKey = '';
    this._hintAt = 0;
    this._loseT = 0;
    this._heatSeen = false;
    this._clock = 0;

    const kb = ctx.scene.input.keyboard;
    this.keys = kb ? kb.addKeys({ yes: 'Y', no: 'N' }) : null;

    listen(ctx.scene, EV.VEHICLE_STOLEN, (e) => this._onStolen(e));
    listen(ctx.scene, EV.PLAYER_ENTERED_VEHICLE, () => {});
    listen(ctx.scene, EV.VEHICLE_DAMAGED, (e) => this._onDamaged(e));
    listen(ctx.scene, EV.VEHICLE_DESTROYED, (e) => this._onDestroyed(e));
    listen(ctx.scene, POLICE_EV.ESCAPED, () => { if (this.job?.stages[this.job.stageIndex]?.action === 'lose') this._advance(); });
    listen(ctx.scene, EV.BUSTED, () => this._failActive('busted'));
    listen(ctx.scene, EV.PLAYER_DIED, () => this._failActive('you died'));
  }

  get job() { return this.ctx.state.job; }

  completedLevels(tpl) { return this.ctx.state.missions.levels[tpl] || 0; }
  contactMarkers() { return this.contacts.map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y, legal: c.legal })); }

  /** World point the player should head to, or null (used by HUD/minimap). */
  targetPoint() {
    const j = this.job;
    if (!j) return this.careers.targetPoint();
    const s = j.stages[j.stageIndex];
    if (!s) return null;
    const p = this._stagePos(s);
    return p ? { x: p.x, y: p.y, name: s.name, action: s.action } : null;
  }

  _stagePos(s) {
    if (s.action === 'enter' && s.vehicle && s.vehicle.state === 'ok') return { x: s.vehicle.x, y: s.vehicle.y };
    if (s.action === 'steal') {
      const v = s.vehicle || this._nearestOfType(s.vehicleType);
      return v ? { x: v.x, y: v.y } : s.x != null ? { x: s.x, y: s.y } : null;
    }
    return s.x == null ? null : { x: s.x, y: s.y };
  }

  _nearestOfType(type) {
    const p = this.ctx.player;
    let best = null, bd = Infinity;
    for (const v of this.ctx.vehicles) {
      if (v.type !== type || v.state !== 'ok' || v.driver) continue;
      const d = (v.x - p.px) ** 2 + (v.y - p.py) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ------------------------------------------------------------ offers
  _onStolen({ vehicle }) {
    const j = this.job;
    if (j && j.stages[j.stageIndex]?.action === 'steal' && vehicle.type === j.stages[j.stageIndex].vehicleType) {
      j.vehicle = vehicle;
      this._advance();
      return;
    }
    if (j) { if (j.stages[j.stageIndex]?.action !== 'enter') pager('Job still active, keeping it.', 'info', 'Dispatch'); return; }
    if (!opt('theft')) return; // steal-triggered orders exist only when theft is on
    if (this.offer || vehicle.type === 'police') return;
    const job = buildOrder(this.ctx, vehicle);
    if (!job) return;
    this._makeOffer(job, null, true);
  }

  _makeOffer(job, contact, auto) {
    this.offer = { job, contact, auto, t: 0, expires: auto ? TUNING.orderAutoAccept : null };
    job.state = 'offered';
    bus.emit(EV.JOB_OFFERED, { job, contact: contact ? { id: contact.id, name: contact.name, blurb: contact.blurb, legal: contact.legal } : null, auto, expiresIn: this.offer.expires });
    const cargo = job.cargo;
    pager(`${job.title}: ${job.stages[0].name} -> ${job.stages[job.stages.length - 1].name}, ${job.reward} kr${cargo.fragile ? ', fragile' : ''}. [Y] accept / [N] refuse`, job.legal ? 'job' : 'crime', contact?.name || 'Dispatch');
  }

  accept() {
    const o = this.offer;
    if (!o || this.job) return false;
    const j = o.job;
    this.offer = null;
    j.state = 'active';
    j.stageIndex = 0;
    this.ctx.state.job = j;
    this._prepareJob(j);
    bus.emit(MISSION_EV.ACCEPTED, { job: j });
    bus.emit(EV.JOB_STARTED, { job: j });
    bus.emit(EV.JOB_STAGE, { job: j, stageIndex: 0 });
    this._onStageEnter();
    return true;
  }

  decline(reason = 'declined') {
    const o = this.offer;
    if (!o) return;
    this.offer = null;
    if (o.contact) this.ctx.state.contactCooldowns[o.contact.id] = this.ctx.scene.time.now + TUNING.contactCooldownDecline;
    bus.emit(MISSION_EV.OFFER_CANCELLED, { job: o.job, reason });
  }

  abandon() { this._failActive('abandoned'); }

  /** Start an externally built job (careers: courier orders, bus shifts) at once. Returns false when busy. */
  startJob(job) {
    if (this.job || this.offer) return false;
    job.state = 'active';
    job.stageIndex = 0;
    this.ctx.state.job = job;
    this._prepareJob(job);
    bus.emit(MISSION_EV.ACCEPTED, { job });
    bus.emit(EV.JOB_STARTED, { job });
    bus.emit(EV.JOB_STAGE, { job, stageIndex: 0 });
    this._onStageEnter();
    return true;
  }

  /** Bus shifts move their own stage index (the careers module decides when a stop is done). */
  shiftStage(i) {
    const j = this.job;
    if (!j) return;
    j.stageIndex = i;
    bus.emit(EV.JOB_STAGE, { job: j, stageIndex: i });
    this._onStageEnter();
  }

  /** End a shift job. Pay was already requested by the careers module. { ok, payout, reason, notes } */
  finishShift(j, { ok, payout, reason, notes }) {
    if (this.job !== j) return;
    j.state = ok ? 'success' : 'failed';
    j.payout = payout;
    if (ok) bus.emit(EV.JOB_COMPLETED, { job: j, payout, tip: 0, base: payout });
    else bus.emit(EV.JOB_FAILED, { job: j, reason });
    pager(`${j.title}: ${ok ? 'shift done' : `shift ended (${reason})`}, ${payout} kr${notes ? ` (${notes})` : ''}`, ok ? 'job' : 'warn', 'Dispatch');
    this._end();
  }

  /** Spawn the vehicles a mission needs. */
  _prepareJob(j) {
    const ctx = this.ctx;
    const home = j.contactId ? this.contacts.find((c) => c.id === j.contactId) : null;
    const traffic = ctx.systems.traffic;
    const spawn = (type, x, y, legalVan = false) => {
      const f = ctx.world.findFreeSpot(x + 60, y + 60);
      let v = null;
      if (j.template === 'stealModel' && typeof traffic?.ensureVehicleNear === 'function') v = traffic.ensureVehicleNear(type, f.x, f.y, 40 * PX);
      if (!v) v = ctx.spawnVehicle(type, f.x, f.y, { tag: 'mission', jobVehicle: legalVan });
      v.tag = 'mission';
      if (legalVan) v.jobVehicle = true; // the moving-help van is supplied by the job: usable even with theft off
      if (typeof traffic?.releaseVehicle === 'function') traffic.releaseVehicle(v); // traffic must not recycle mission cars
      return v;
    };
    if (j.spawnVan && home) { j.stages[0].vehicle = spawn('van', home.x, home.y, true); j.stages[0].x = j.stages[0].vehicle.x; j.stages[0].y = j.stages[0].vehicle.y; }
    if (j.template === 'hotCar' && home) { j.stages[0].vehicle = spawn(j.spawnCar, home.x, home.y); }
    if (j.template === 'stealModel') {
      j.stages[0].vehicle = null;
      j.targetCar = spawn(j.spawnCar, j.spawnAt.x, j.spawnAt.y);
      j.stages[0].vehicle = j.targetCar;
    }
  }

  // ------------------------------------------------------------ stages
  _advance() {
    const j = this.job;
    if (!j) return;
    j.stageIndex++;
    this._loadT = 0;
    if (j.stageIndex >= j.stages.length) { this._succeed(); return; }
    if (j.stageIndex === j.timerFrom) { j.timeLeft = j.timeLimit; }
    bus.emit(EV.JOB_STAGE, { job: j, stageIndex: j.stageIndex });
    this._onStageEnter();
  }

  _onStageEnter() {
    const j = this.job, s = j.stages[j.stageIndex];
    if (j.stageIndex === j.timerFrom && j.timeLeft == null) j.timeLeft = j.timeLimit;
    if (s.action === 'lose') { this._loseT = 0; this._loseTotal = 0; this._heatSeen = this.ctx.state.heat >= 1; }
    const verb = { enter: 'Get in', pickup: 'Pick up at', dropoff: 'Deliver to', steal: 'Find', lose: '', busstop: 'Stop at' }[s.action];
    if (s.action === 'lose') pager('Lose the police: get your heat down to zero.', 'crime', j.contactName);
    else pager(`${verb} ${s.name}`, 'job', j.contactName || 'Dispatch');
    this._emitTarget(true);
  }

  _emitTarget(force) {
    const t = this.targetPoint();
    const key = t ? `${this.job?.stageIndex}:${Math.round(t.x / 40)}:${Math.round(t.y / 40)}` : 'none';
    if (!force && key === this._targetKey) return;
    this._targetKey = key;
    bus.emit(MISSION_EV.TARGET, t ? { ...t, stageIndex: this.job.stageIndex, job: this.job } : { job: null });
  }

  _hint(text) {
    const now = this.ctx.scene.time.now;
    if (now - this._hintAt < 2500) return;
    this._hintAt = now;
    bus.emit(MISSION_EV.HINT, { text });
  }

  _crime(c, x, y) {
    if (!c) return;
    bus.emit(EV.CRIME, { type: c.type, severity: c.severity, x, y });
  }

  _updateStage(dt) {
    const j = this.job, s = j.stages[j.stageIndex], pl = this.ctx.player;
    const px = pl.px, py = pl.py, veh = pl.vehicle;
    const speed = veh ? veh.speedMps : 0;
    const inside = s.x != null && Math.hypot(px - s.x, py - s.y) <= (s.radius || TUNING.dropRadius);
    if (j.requireVehicle && (s.action === 'pickup' || s.action === 'dropoff') && inside && veh !== j.requireVehicle) { this._hint('Use your taxi'); return; }

    if (s.action === 'enter') {
      if (s.vehicle && s.vehicle.state !== 'ok') { this._fail('vehicle destroyed'); return; }
      if (veh && s.vehicle && veh === s.vehicle) {
        if (j.template === 'hotCar') {
          const police = this.ctx.systems.police;
          if (police && typeof police.addHeat === 'function') police.addHeat(j.heatAmount, 'mission');
          this._crime({ type: 'mission', severity: 0.5 }, veh.x, veh.y);
          pager('The car is hot, police are on to you!', 'crime', j.contactName);
        }
        this._advance();
      }
    } else if (s.action === 'steal') {
      if (j.targetCar && j.targetCar.state !== 'ok' && !(veh === j.targetCar)) { this._fail('target car destroyed'); return; }
    } else if (s.action === 'pickup') {
      let ok = inside && speed < 3;
      if (inside && s.requires && pl.capacity < s.requires.capacity) {
        ok = false;
        this._hint(`Needs more room: capacity ${s.requires.capacity} (you have ${pl.capacity})`);
      } else if (inside && speed >= 3) this._hint('Stop inside the marker to load');
      if (ok) {
        this._loadT += dt;
        const t = Math.min(1, this._loadT / (s.loadTime || TUNING.loadSeconds));
        bus.emit(MISSION_EV.LOADING, { job: j, t });
        if (t >= 1) {
          j.loaded = true;
          bus.emit(MISSION_EV.LOADING, { job: j, t: 0 });
          this._crime(s.crime, s.x, s.y);
          if (j.stageIndex + 1 === j.timerFrom) pager(`Loaded ${j.cargo.name}. ${j.timeLimit}s on the clock!`, 'job', 'Dispatch');
          this._advance();
        }
      } else if (this._loadT > 0) { this._loadT = 0; bus.emit(MISSION_EV.LOADING, { job: j, t: 0 }); }
    } else if (s.action === 'dropoff') {
      if (!inside) return;
      if (j.heatLimit && Math.floor(this.ctx.state.heat) >= j.heatLimit) { this._fail('buyer spooked by the police heat'); return; }
      if (j.minHealth && veh && veh.health / veh.maxHealth < j.minHealth) { this._hint(`Too damaged: needs at least ${Math.round(j.minHealth * 100)}% health`); return; }
      if (j.template === 'stealModel' && (!veh || veh.type !== j.stages[0].vehicleType)) { this._hint('Bring the ordered car'); return; }
      if (j.template === 'hotCar' && !veh) { this._hint('Bring the hot car'); return; }
      this._crime(s.crime, s.x, s.y);
      this._advance();
    } else if (s.action === 'lose') {
      const pol = this.ctx.systems.police;
      const heat = typeof pol?.getLevel === 'function' ? pol.getLevel() : this.ctx.state.heat;
      this._loseTotal = (this._loseTotal || 0) + dt;
      if (this._loseTotal > TUNING.loseTimeout) { this._loseTotal = 0; this._loseT = 0; this._fail('could not shake the police'); return; }
      if (heat >= 1) this._heatSeen = true;
      if (heat < 0.5) { this._loseT += dt; if (this._loseT >= 3) this._advance(); } else this._loseT = 0;
    }
  }

  // ------------------------------------------------------------ outcome
  _integrity(j) {
    const v = this.ctx.player.vehicle;
    const maxHp = v ? v.maxHealth : 100;
    return Math.max(0, 1 - j.damage / (maxHp * 0.6));
  }

  _succeed() {
    const j = this.job, ctx = this.ctx, st = ctx.state;
    const frac = j.timeLimit ? Math.max(0, Math.min(1, (j.timeLeft ?? 0) / j.timeLimit)) : 0.5;
    const integ = j.cargo.fragile ? this._integrity(j) : 1;
    let amount = j.reward * (0.7 + 0.5 * frac) * (j.cargo.fragile ? 0.5 + 0.5 * integ : 1);
    const eco = ctx.systems.economy;
    let base = typeof eco?.scalePayout === 'function' ? eco.scalePayout(amount) : Math.round(amount);
    const tipMul = eco?.getEffects?.().tips ?? 1;
    let tip = j.legal && frac > 0.15 && integ > 0.6 ? Math.round(base * TUNING.baseTip * tipMul * (0.5 + Math.random() * 0.5)) : 0;
    if (j.payoutFn) ({ base, tip } = j.payoutFn(ctx, j, { frac, integ })); // taxi meter
    else if (j.career === 'courier') tip = j.legal && frac > 0.15 && integ > 0.6 ? Math.round(base * TUNING.baseTip * tipMul * (0.5 + Math.random() * 0.5) * (0.6 + 0.2 * (ctx.state.jobs.courier.rating - 1))) : 0;
    const payout = base + tip;
    j.state = 'success';
    j.payout = payout;
    bus.emit(EV.REQUEST_PAY, { amount: payout, reason: j.kind === 'order' ? 'delivery' : j.title });
    bus.emit(EV.JOB_COMPLETED, { job: j, payout, tip, base });
    pager(`${j.title} done: +${payout} kr${tip ? ` (tip ${tip})` : ''}`, 'job', j.contactName || 'Dispatch');
    if (j.kind === 'order') st.stats.deliveries++; else if (j.kind === 'mission') st.stats.missions++;
    this.careers.onJobEnd(j, true, { frac, integ, payout, base, tip });
    if (j.template) {
      const lv = st.missions.levels;
      lv[j.template] = Math.max(lv[j.template] || 0, Math.min(j.level, TUNING.maxLevel));
      st.contactCooldowns[j.contactId] = ctx.scene.time.now + TUNING.contactCooldownDone;
      if (j.level < TUNING.maxLevel && lv[j.template] === j.level) pager(`Level ${j.level + 1} unlocked: ${TEMPLATES[j.template].title}`, 'job', j.contactName);
    }
    this._end();
  }

  _fail(reason) {
    const j = this.job;
    if (!j) return;
    j.state = 'failed';
    bus.emit(EV.JOB_FAILED, { job: j, reason });
    pager(`${j.title} failed: ${reason}`, 'warn', j.contactName || 'Dispatch');
    if (j.contactId) this.ctx.state.contactCooldowns[j.contactId] = this.ctx.scene.time.now + TUNING.contactCooldownDecline;
    this.careers.onJobEnd(j, false, { reason });
    this._end();
  }

  _failActive(reason) {
    if (this.offer) this.decline('busy');
    if (this.job) this._fail(reason);
  }

  _end() {
    this._loseTotal = 0;
    this._loseT = 0;
    this.ctx.state.job = null;
    this._loadT = 0;
    this._targetKey = '';
    bus.emit(MISSION_EV.LOADING, { job: null, t: 0 });
    bus.emit(MISSION_EV.TARGET, { job: null });
  }

  _onDamaged({ vehicle, amount }) {
    const j = this.job;
    if (!j || !j.loaded || !j.cargo.fragile || vehicle !== this.ctx.player.vehicle) return;
    j.damage += amount;
    const integrity = this._integrity(j);
    bus.emit(MISSION_EV.CARGO, { job: j, damage: j.damage, integrity });
    if (integrity <= 0.05) this._fail(j.passenger ? 'the passenger bailed out' : 'cargo ruined');
  }

  _onDestroyed({ vehicle }) {
    const j = this.job;
    if (j && vehicle === this.ctx.player.vehicle && j.loaded && j.template !== 'stealModel') this._fail('vehicle destroyed');
  }

  // ------------------------------------------------------------ loop
  update(dt, time) {
    this._clock += dt;
    const ctx = this.ctx, pl = ctx.player;
    if (!pl) return;

    // offer handling
    const o = this.offer;
    if (o) {
      o.t += dt;
      if (this.keys) {
        if (Phaser.Input.Keyboard.JustDown(this.keys.yes)) this.accept();
        else if (Phaser.Input.Keyboard.JustDown(this.keys.no)) this.decline();
      }
      if (this.offer) {
        if (o.auto && o.t >= o.expires) this.accept();
        else if (o.contact && Math.hypot(pl.px - o.contact.x, pl.py - o.contact.y) > TUNING.contactRadius * 2.5) { this.decline('left'); ctx.state.contactCooldowns[o.contact.id] = time + 8000; }
      }
    }

    this.careers.update(dt, time);
    const j = this.job;
    if (j && j.shift) {
      this._emitTarget(false); // bus shift: the careers module drives the stages
    } else if (j) {
      if (j.timeLeft != null && j.stageIndex >= j.timerFrom && j.stageIndex < j.timerTo) {
        j.timeLeft -= dt;
        this._timerEmit -= dt;
        if (this._timerEmit <= 0) { this._timerEmit = 0.25; bus.emit(MISSION_EV.TIMER, { job: j, timeLeft: j.timeLeft, timeLimit: j.timeLimit }); }
        if (j.timeLeft <= 0) { j.timeLeft = 0; this._fail('out of time'); }
      }
      if (this.job) { this._updateStage(dt); }
      if (this.job) this._emitTarget(false);
    } else if (!this.offer) {
      this._checkContacts(time);
    }
    this._draw(time);
  }

  _checkContacts(time) {
    const pl = this.ctx.player, st = this.ctx.state;
    for (const c of this.contacts) {
      if ((st.contactCooldowns[c.id] || 0) > time) continue;
      if (Math.hypot(pl.px - c.x, pl.py - c.y) > TUNING.contactRadius) continue;
      const tpls = c.jobs.filter((t) => TEMPLATES[t]);
      if (!tpls.length) continue;
      // lowest unfinished level first, rotating across the contact's templates
      tpls.sort((a, b) => this.completedLevels(a) - this.completedLevels(b));
      const tpl = tpls[0];
      const level = Math.min(TUNING.maxLevel, this.completedLevels(tpl) + 1);
      const job = buildMission(this.ctx, c, tpl, level);
      if (!job) { st.contactCooldowns[c.id] = time + 15000; continue; }
      this._makeOffer(job, c, false);
      return;
    }
  }

  _draw(time) {
    const m = this.markers, pl = this.ctx.player;
    m.begin();
    for (const c of this.contacts) m.draw({ kind: 'contact', x: c.x, y: c.y, label: c.name, style: c.marker }, time);
    const j = this.job;
    let tgt = null;
    if (j) {
      const s = j.stages[j.stageIndex];
      const p = s && this._stagePos(s);
      if (s && p) {
        const kind = s.action === 'pickup' ? 'pickup' : s.action === 'dropoff' || s.action === 'busstop' ? 'dropoff' : 'target';
        m.draw({ kind, x: p.x, y: p.y, r: s.radius || 80, label: s.name, progress: s.action === 'pickup' ? this._loadT / (s.loadTime || TUNING.loadSeconds) : s.action === 'busstop' ? this.careers.bus.dwellFrac() : 0 }, time);
        tgt = p;
      }
    } else if (this.offer) {
      const s = this.offer.job.stages[0];
      m.draw({ kind: 'pickup', x: s.x, y: s.y, r: s.radius || 80, label: `${s.name} (offered)` }, time);
    } else this.careers.draw(m, time);
    m.end();
    if (tgt && pl) m.pointArrow(pl.px, pl.py, tgt.x, tgt.y);
    else m.pointArrow(0, 0, null);
  }

  destroy() {
    this.markers.destroy();
    this.careers.destroy();
    this.ctx.state.job = null;
    this.offer = null;
  }
}

