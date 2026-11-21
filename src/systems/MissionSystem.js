/**
 * MissionSystem: the ACTIVE task list (delivery orders, street gigs, quick challenges, side missions, shifts).   OWNER: missions specialist
 *
 * ===================== PUBLIC API (ctx.systems.missions) =====================
 *   jobs                   live array of accepted jobs (max TASKS.maxActive = 4); each has its own state machine and timer
 *   job                    the TRACKED job (= state.job) or null; the waypoint arrow, minimap line and HUD order card follow it
 *   offer                  pending offer ({ job, contact, gig?, auto }) or null
 *   accept() / decline()   respond to the pending offer (same as the [Y] / [N] keys, handled here)
 *   addJob(job, opts)      put a ready-made job on the list (gigs, challenges, events, courier orders). { track = true }
 *   canAccept(desc)        { ok, reason? } slot / shift rules (see RULES below). desc = job or { kind, career }
 *   track(idOrJob) / cycleTrack(dir=1)   choose the tracked job (the Tab key cycles)
 *   abandon(jobOrId?)      fail one job ('abandoned'); default the tracked one
 *   progress(job)          +1 on a 'count' stage (challenges); failJob(job, reason); completeJob(job) (tests/debug)
 *   targetPoint()          { x, y, name, action } of the TRACKED job for the arrow / minimap, or null
 *   taskList()             cached [{ id, type, title, short, x, y, timeLeft, tracked, progress, step, reward, job }] for the HUD
 *   board                  TaskBoard (available gigs, events, challenges, nearby list): see systems/missions/tasks/TaskBoard.js
 *   completedLevels(tpl)   completed level count of a contact template
 *   contactMarkers()       [{ id, name, x, y, legal }] for the minimap
 *
 * FLOW (state machine per job, job.state): offered -> active -> (success | failed)
 *   Stages (job.stages[stageIndex].action): 'enter' (get in the given vehicle), 'pickup' (stop inside the marker 1.5 s to
 *   load), 'dropoff', 'visit' (reach the marker), 'wait' (stay inside for loadTime seconds), 'hold' (survive until the timer ends),
 *   'count' (progress from events: s.count / s.goal), 'steal' (steal a car of vehicleType), 'lose' (get heat to 0), 'busstop'.
 *
 * RULES (slots, tracking, shifts, capacity)
 *   - Up to 4 jobs at once. A taxi shift without a running fare also takes one slot; a fare or bus shift is one job.
 *   - The newest accepted job becomes tracked (challenges and the "head to event" task only when nothing is tracked); Tab cycles;
 *     when the tracked job ends the next one with a target takes over.
 *   - Shifts are exclusive: a shift cannot start while orders or gigs are active, and no order or gig can be accepted during a shift.
 *     Challenges and event tasks are passive and always allowed (as long as a slot is free). Taxi fares of the running shift are fine.
 *   - Cargo capacity is shared: a pickup needs (vehicle capacity - cargo already loaded for other jobs) >= its size.
 *   - A timer failure or abandon fails only that job. Death and busting fail every job except challenges and event tasks.
 *   - Persistence: jobs with `persist: true` (courier orders, gigs, challenges, event tasks) are saved in state.tasks.active and
 *     restored on load. Contact missions, taxi/bus shifts and steal orders hold vehicle references and are not saved.
 *
 * DECISIONS
 *   - Every VEHICLE_STOLEN with a free slot and no pending offer creates a delivery ORDER offer (theft option only).
 *     Orders auto-accept after 8 s (press [N] to refuse, [Y] to accept at once). Contact missions
 *     need [Y] (walk up to the contact marker, offer withdrawn when you leave). Gig offers (E at a gig pin) need [Y] too.
 *   - The timer starts when the stage `job.timerFrom` is reached (for orders: once loaded; for gigs and challenges: at accept).
 *   - Fragile cargo / passengers lose integrity from VEHICLE_DAMAGED; ruined at 0 (fail), payout shrinks before.
 *   - Payout = base(distance) * (0.7 + 0.5 * timeLeft/timeLimit) * integrity factor, scaled by
 *     economy.scalePayout (Charm), plus a tip (economy getEffects().tips) for clean fast jobs. `fixed` jobs (gigs, challenges)
 *     pay job.reward * (0.9 + 0.2 * time fraction) with no tip, plus job.lq Life Quality.
 *   - Contact mission levels (1-3) unlock in sequence: state.missions.levels[template] = completed count.
 *
 * CAREERS (careers/): courier "Bybud" offers, taxi shifts and bus shifts live in missions/careers/*; MissionSystem exposes
 *   careers (public API in careers/index.js), startJob(job), shiftStage(i), finishShift(job, {...}). Job fields added: career,
 *   requireVehicle, payoutFn, shift (bus).
 *
 * OPTIONS: steal-triggered orders only when options.theft is on; criminal contacts (legal:false) only when
 *   options.criminalMissions is on (core/options.js). Vehicles supplied by a legal job are marked `jobVehicle`.
 *
 * Listens: VEHICLE_STOLEN, PLAYER_ENTERED_VEHICLE, VEHICLE_DAMAGED, VEHICLE_DESTROYED, BUSTED, PLAYER_DIED
 * Emits:   EV.JOB_OFFERED { job, contact?, auto, expiresIn }, EV.JOB_STARTED, EV.JOB_STAGE, EV.JOB_COMPLETED
 *          { job, payout, tip, base }, EV.JOB_FAILED { job, reason }, EV.REQUEST_PAY, EV.CRIME, EV.PAGER,
 *          EV.BANNER, plus MISSION_EV.* (systems/missions/events.js) and TASKS_EV.CHANGED / TRACKED.
 * State:   state.jobs = { courier, taxi, bus } (careers, saved), state.job (= the tracked job, transient),
 *          state.tasks = { tracked, active, events, cd } (saved), state.contactCooldowns, state.missions = { levels }, stats.deliveries / missions / gigs.
 *
 * Job shape (read by HUD):
 *  { id, kind: 'order'|'mission'|'gig'|'challenge'|'event'|'shift', template?, level, title, legal, contactId?, state,
 *    stages: [{ action, x, y, name, radius, requires?: { capacity } }], stageIndex,
 *    timeLeft: seconds|null, timeLimit, reward, metres, cargo: { size, fragile, name }, damage, loaded }
 */
import Phaser from 'phaser';
import { PX } from '../config.js';
import { listen, EV, bus, pager } from '../core/events.js';
import { getContacts } from '../data/contacts.js';
import { opt, contactEnabled } from '../core/options.js';
import { TUNING, TEMPLATES } from '../data/missions.js';
import { TASKS } from '../data/tasks.js';
import { POLICE_EV } from './police/tuning.js';
import { MISSION_EV, TASKS_EV } from './missions/events.js';
import { MarkerLayer } from './missions/markers.js';
import { buildOrder, buildMission } from './missions/builders.js';
import { Careers } from './missions/careers/index.js';
import { TaskBoard } from './missions/tasks/TaskBoard.js';
import { simNow } from '../core/timescale.js';

const MAX = TASKS.maxActive;
const isLight = (j) => j.kind === 'challenge' || j.kind === 'event'; // passive tasks: allowed alongside shifts, never blocked by them
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** HUD/map icon type of a job. */
export function taskType(j) {
  if (j.career === 'courier' || j.career === 'taxi' || j.career === 'bus') return j.career;
  if (j.kind === 'gig' || j.kind === 'challenge' || j.kind === 'event' || j.kind === 'mission') return j.kind;
  return 'courier';
}

export class MissionSystem {
  constructor(ctx) {
    this.ctx = ctx;
    const st = ctx.state;
    st.job = null;
    st.tasks = st.tasks || {};
    st.missions = st.missions || {};
    st.missions.levels = st.missions.levels || {};
    st.contactCooldowns = st.contactCooldowns || {};
    const now = simNow();
    for (const k of Object.keys(st.contactCooldowns)) if (st.contactCooldowns[k] > now + 3e5) st.contactCooldowns[k] = 0; // stale clock from an older session

    this.offer = null;
    this.jobs = []; // accepted jobs; state.job is the tracked one
    this.trackedId = null;
    // Criminal contacts (Ravn, Sille) are hidden and disabled unless the criminalMissions option is on.
    this.contacts = getContacts(ctx.city?.id || st.cityId).filter(contactEnabled).map((c) => {
      const lm = ctx.world.landmark(c.at);
      return lm ? { ...c, x: lm.x, y: lm.y } : null;
    }).filter(Boolean);
    this.markers = new MarkerLayer(ctx.scene);
    this.careers = new Careers(this); // courier / taxi / bus careers (state.jobs), see missions/careers/index.js
    this.board = new TaskBoard(this); // available gigs, events, challenges
    this._timerEmit = 0;
    this._targetKey = '';
    this._hintAt = 0;
    this._clock = 0;
    this._list = [];
    this._listAt = -1;
    this._saveAt = 0;

    const kb = ctx.scene.input.keyboard;
    this.keys = kb ? kb.addKeys({ yes: 'Y', no: 'N', track: 'TAB' }) : null;

    listen(ctx.scene, EV.VEHICLE_STOLEN, (e) => this._onStolen(e));
    listen(ctx.scene, EV.PLAYER_ENTERED_VEHICLE, () => {});
    listen(ctx.scene, EV.VEHICLE_DAMAGED, (e) => this._onDamaged(e));
    listen(ctx.scene, EV.VEHICLE_DESTROYED, (e) => this._onDestroyed(e));
    listen(ctx.scene, POLICE_EV.ESCAPED, () => { for (const j of this.jobs.slice()) if (j.stages[j.stageIndex]?.action === 'lose') this._advance(j); });
    listen(ctx.scene, EV.BUSTED, () => this._failActive('busted'));
    listen(ctx.scene, EV.PLAYER_DIED, () => this._failActive('you died'));
    this._restore();
  }

  /** The tracked job (also state.job). */
  get job() { return this.ctx.state.job; }

  // Back-compat for scripts that poke the old single-job internals: they now address the tracked job's own fields.
  get _loseTotal() { return this.job?._loseTotal || 0; }
  set _loseTotal(v) { if (this.job) this.job._loseTotal = v; }
  get _loseT() { return this.job?._loseT || 0; }
  set _loseT(v) { if (this.job) this.job._loseT = v; }
  get _loadT() { return this.job?._loadT || 0; }
  set _loadT(v) { if (this.job) this.job._loadT = v; }

  completedLevels(tpl) { return this.ctx.state.missions.levels[tpl] || 0; }
  contactMarkers() { return this.contacts.map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y, legal: c.legal })); }
  jobOfCareer(career) { return this.jobs.find((j) => j.career === career) || null; }

  // ------------------------------------------------------------ slots, tracking, capacity
  /** Slots in use: every job, plus a taxi shift that is waiting for fares (it holds the slot until it ends). */
  slotsUsed(forTaxiFare = false) {
    const t = this.careers.taxi.shift;
    return this.jobs.length + (t && !forTaxiFare && !this.jobs.some((j) => j.career === 'taxi') ? 1 : 0);
  }

  /** desc: a job or { kind, career }. fromOffer: the pending offer itself is being accepted. */
  canAccept(desc, fromOffer = false) {
    const kind = desc.kind || 'order';
    if (this.slotsUsed(desc.career === 'taxi') >= MAX) return { ok: false, reason: `Task list full (${MAX}/${MAX}): abandon one first` };
    if (!fromOffer && this.offer && this.offer.job !== desc) return { ok: false, reason: 'Answer the pending offer first (Y or N)' };
    if (kind === 'shift') {
      if (this.jobs.some((j) => !isLight(j))) return { ok: false, reason: 'Finish or abandon your orders and gigs before a shift' };
    } else if (!isLight(desc) && desc.career !== 'taxi' && this.careers.shiftActive()) {
      return { ok: false, reason: 'You are on a shift: end it first' };
    }
    return { ok: true };
  }

  /** Shared cargo: capacity units already loaded for jobs other than `excl`. */
  capacityUsed(excl) {
    let n = 0;
    for (const j of this.jobs) if (j !== excl && j.loaded && !j.shift && j.cargo?.size) n += j.cargo.size;
    return n;
  }

  track(idOrJob) {
    const id = typeof idOrJob === 'string' ? idOrJob : idOrJob?.id;
    if (!this.jobs.some((j) => j.id === id)) return false;
    this.trackedId = id;
    this._syncTracked();
    this._emitTarget(true);
    bus.emit(TASKS_EV.TRACKED, { job: this.job });
    this._changed();
    return true;
  }

  cycleTrack(dir = 1) {
    if (this.jobs.length < 2) return false;
    const i = this.jobs.findIndex((j) => j.id === this.trackedId);
    const n = this.jobs[(i + dir + this.jobs.length * 2) % this.jobs.length];
    this.track(n.id);
    pager(`Tracking: ${n.short || n.title}`, 'info', 'Tasks');
    return true;
  }

  _syncTracked() {
    let t = this.jobs.find((j) => j.id === this.trackedId) || null;
    if (!t) t = this.jobs.find((j) => this._jobPos(j)) || this.jobs[0] || null;
    this.trackedId = t ? t.id : null;
    this.ctx.state.job = t;
    this._listAt = -1;
  }

  _changed() { this._listAt = -1; this._saveTasks(); bus.emit(TASKS_EV.CHANGED, {}); }

  /** World point the player should head to (the TRACKED job), or null (used by HUD/minimap). */
  targetPoint() {
    const j = this.job;
    const p = j && this._jobPos(j);
    if (p) { const s = j.stages[j.stageIndex]; return { x: p.x, y: p.y, name: s.name, action: s.action }; }
    return this.careers.targetPoint();
  }

  _jobPos(j) {
    const s = j.stages[j.stageIndex];
    return s ? this._stagePos(s) : null;
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

  /** Cached rows for the HUD task stack and the job app: one per job (plus a pseudo row for an idle taxi shift). */
  taskList() {
    const now = this._clock;
    if (now - this._listAt < 0.2) return this._list;
    this._listAt = now;
    const out = [];
    for (const j of this.jobs) {
      const s = j.stages[j.stageIndex] || null;
      const p = s && this._stagePos(s);
      const timing = j.timeLeft != null && !j.shift && j.stageIndex >= j.timerFrom && j.stageIndex < j.timerTo;
      out.push({
        id: j.id, type: taskType(j), title: j.title, short: j.short || j.title, x: p ? p.x : null, y: p ? p.y : null, stageName: s?.name || '',
        timeLeft: timing ? Math.max(0, j.timeLeft) : null, tracked: j.id === this.trackedId, shift: !!j.shift,
        progress: s?.action === 'count' ? `${s.count}/${s.goal}` : null, step: `${Math.min(j.stageIndex + 1, j.stages.length)}/${j.stages.length}`, reward: j.reward, job: j,
      });
    }
    const ts = this.careers.taxi.shift;
    if (ts && !this.jobs.some((j) => j.career === 'taxi')) {
      const tp = this.careers.taxi.targetPoint();
      out.push({ id: 'taxi-shift', type: 'taxi', title: 'Taxi shift', short: 'Taxi shift', x: tp?.x ?? null, y: tp?.y ?? null, stageName: ts.stage === 'work' ? 'Waiting for fares' : ts.stage === 'return' ? 'Return the taxi' : 'Get in the taxi', timeLeft: ts.stage === 'work' ? Math.max(0, ts.timeLeft) : null, tracked: false, shift: true, pseudo: true, progress: null, step: '', reward: 0, job: null });
    }
    this._list = out;
    return out;
  }

  // ------------------------------------------------------------ offers
  _onStolen({ vehicle }) {
    for (const j of this.jobs) {
      const s = j.stages[j.stageIndex];
      if (s?.action === 'steal' && vehicle.type === s.vehicleType) { j.vehicle = vehicle; this._advance(j); return; }
    }
    if (this.jobs.some((j) => j.stages[j.stageIndex]?.action === 'enter')) return;
    if (!opt('theft')) return; // steal-triggered orders exist only when theft is on
    if (this.offer || vehicle.type === 'police') return;
    if (this.slotsUsed() >= MAX) { pager('Task list full, keeping your current jobs.', 'info', 'Dispatch'); return; }
    const job = buildOrder(this.ctx, vehicle);
    if (!job) return;
    this._makeOffer(job, null, true);
  }

  _makeOffer(job, contact, auto) {
    this.offer = { job, contact, auto, t: 0, expires: auto ? TUNING.orderAutoAccept : null };
    job.state = 'offered';
    bus.emit(EV.JOB_OFFERED, { job, contact: contact ? { id: contact.id, name: contact.name, blurb: contact.blurb, legal: contact.legal } : null, auto, expiresIn: this.offer.expires });
    const cargo = job.cargo;
    if (job.kind === 'gig') { pager(`${job.title}: ${job.blurb} ${job.reward} kr. [Y] accept / [N] refuse`, 'job', 'Gigs'); return; }
    pager(`${job.title}: ${job.stages[0].name} -> ${job.stages[job.stages.length - 1].name}, ${job.reward} kr${cargo.fragile ? ', fragile' : ''}. [Y] accept / [N] refuse`, job.legal ? 'job' : 'crime', contact?.name || 'Dispatch');
  }

  /** E at a gig pin: show its offer card ([Y] accept / [N] refuse). */
  offerGig(gig) {
    if (this.offer) return false;
    const can = this.canAccept(gig.job);
    if (!can.ok) { pager(can.reason, 'warn', 'Gigs'); return false; }
    this._makeOffer(gig.job, null, false);
    this.offer.gig = gig;
    return true;
  }

  accept() {
    const o = this.offer;
    if (!o) return false;
    const can = this.canAccept(o.job, true);
    if (!can.ok) { pager(can.reason, 'warn', 'Dispatch'); if (o.auto) this.decline('busy'); return false; }
    this.offer = null;
    if (o.gig) this.board.removeGig(o.gig);
    return this.addJob(o.job, { fromOffer: true });
  }

  decline(reason = 'declined') {
    const o = this.offer;
    if (!o) return;
    this.offer = null;
    if (o.contact) this.ctx.state.contactCooldowns[o.contact.id] = simNow() + TUNING.contactCooldownDecline;
    if (o.gig) this.board.declined(o.gig);
    bus.emit(MISSION_EV.OFFER_CANCELLED, { job: o.job, reason });
  }

  /** Put a job on the active list. opts: { track = true, fromOffer }. Returns false when the rules refuse it. */
  addJob(job, opts = {}) {
    const can = this.canAccept(job, !!opts.fromOffer);
    if (!can.ok) { if (!opts.silent) pager(can.reason, 'warn', 'Dispatch'); return false; }
    job.state = 'active';
    job.stageIndex = job.stageIndex || 0;
    job._loadT = 0;
    this.jobs.push(job);
    if (opts.track !== false && (!isLight(job) || !this.job)) this.trackedId = job.id;
    else if (!this.trackedId) this.trackedId = job.id;
    this._syncTracked();
    this._prepareJob(job);
    bus.emit(MISSION_EV.ACCEPTED, { job });
    bus.emit(EV.JOB_STARTED, { job });
    bus.emit(EV.JOB_STAGE, { job, stageIndex: job.stageIndex });
    this._onStageEnter(job);
    this._changed();
    return true;
  }

  /** Start an externally built job (careers: courier orders, bus shifts) at once. Returns false when the rules refuse it. */
  startJob(job) { return this.addJob(job, { silent: true }); }

  /** Fail one job (default: the tracked one). */
  abandon(j = this.job) {
    if (typeof j === 'string') j = this.jobs.find((q) => q.id === j);
    if (j && this.jobs.includes(j)) this._fail('abandoned', j);
  }

  failJob(j, reason) { if (this.jobs.includes(j)) this._fail(reason, j); }
  completeJob(j) { if (this.jobs.includes(j)) this._succeed(j); }

  /** +1 on the current 'count' stage of a job; completes the stage (and the job) at the goal. */
  progress(j) {
    const s = j?.stages[j.stageIndex];
    if (!s || s.action !== 'count' || !this.jobs.includes(j)) return;
    s.count = (s.count || 0) + 1;
    bus.emit(EV.JOB_STAGE, { job: j, stageIndex: j.stageIndex });
    if (s.count >= s.goal) this._advance(j);
    else pager(`${j.title}: ${s.count}/${s.goal}`, 'job', 'Challenge');
    this._changed();
  }

  /** Bus shifts move their own stage index (the careers module decides when a stop is done). */
  shiftStage(i) {
    const j = this.jobOfCareer('bus');
    if (!j) return;
    j.stageIndex = i;
    bus.emit(EV.JOB_STAGE, { job: j, stageIndex: i });
    this._onStageEnter(j);
  }

  /** End a shift job. Pay was already requested by the careers module. { ok, payout, reason, notes } */
  finishShift(j, { ok, payout, reason, notes }) {
    if (!this.jobs.includes(j)) return;
    j.state = ok ? 'success' : 'failed';
    j.payout = payout;
    if (ok) bus.emit(EV.JOB_COMPLETED, { job: j, payout, tip: 0, base: payout });
    else bus.emit(EV.JOB_FAILED, { job: j, reason });
    pager(`${j.title}: ${ok ? 'shift done' : `shift ended (${reason})`}, ${payout} kr${notes ? ` (${notes})` : ''}`, ok ? 'job' : 'warn', 'Dispatch');
    this._end(j);
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

  // ------------------------------------------------------------ persistence
  _saveTasks() {
    const t = this.ctx.state.tasks;
    t.tracked = this.trackedId;
    t.active = this.jobs.filter((j) => j.persist).map((j) => JSON.parse(JSON.stringify(j, (k, v) => (k[0] === '_' ? undefined : v))));
  }

  _restore() {
    const t = this.ctx.state.tasks;
    for (const sj of t.active || []) {
      if (!sj || !sj.stages || this.jobs.length >= MAX) continue;
      sj.state = 'active';
      sj._loadT = 0;
      this.jobs.push(sj);
    }
    this.trackedId = t.tracked;
    this._syncTracked();
    if (this.jobs.length) this._emitTarget(true);
    t.active = this.jobs.filter((j) => j.persist);
  }

  // ------------------------------------------------------------ stages
  _advance(j) {
    if (!this.jobs.includes(j)) return;
    j.stageIndex++;
    j._loadT = 0;
    if (j.stageIndex >= j.stages.length) { this._succeed(j); return; }
    if (j.stageIndex === j.timerFrom) { j.timeLeft = j.timeLimit; }
    bus.emit(EV.JOB_STAGE, { job: j, stageIndex: j.stageIndex });
    this._onStageEnter(j);
    this._changed();
  }

  _onStageEnter(j = this.job) {
    const s = j?.stages[j.stageIndex];
    if (!s) return;
    if (j.stageIndex === j.timerFrom && j.timeLeft == null && j.timeLimit) j.timeLeft = j.timeLimit;
    if (s.action === 'lose') { j._loseT = 0; j._loseTotal = 0; j._heatSeen = this.ctx.state.heat >= 1; }
    const verb = { enter: 'Get in', pickup: 'Pick up at', dropoff: 'Deliver to', steal: 'Find', lose: '', busstop: 'Stop at', visit: 'Go to', wait: 'Help at', hold: 'Stay clean:', count: 'Goal:' }[s.action];
    if (s.action === 'lose') pager('Lose the police: get your heat down to zero.', 'crime', j.contactName);
    else if (j.kind !== 'challenge' || j.stageIndex > 0 || s.action === 'visit') pager(`${verb} ${s.name}`, 'job', j.contactName || (j.kind === 'gig' ? 'Gigs' : 'Dispatch'));
    if (j.id === this.trackedId) this._emitTarget(true);
  }

  _emitTarget(force) {
    const t = this.targetPoint();
    const j = this.job;
    const key = t ? `${j?.id}:${j?.stageIndex}:${Math.round(t.x / 40)}:${Math.round(t.y / 40)}` : 'none';
    if (!force && key === this._targetKey) return;
    this._targetKey = key;
    bus.emit(MISSION_EV.TARGET, t ? { ...t, stageIndex: j?.stageIndex, job: j } : { job: null });
  }

  _hint(text) {
    const now = simNow();
    if (now - this._hintAt < 2500) return;
    this._hintAt = now;
    bus.emit(MISSION_EV.HINT, { text });
  }

  _crime(c, x, y) {
    if (!c) return;
    bus.emit(EV.CRIME, { type: c.type, severity: c.severity, x, y });
  }

  _updateStage(j, dt) {
    const s = j.stages[j.stageIndex], pl = this.ctx.player;
    if (!s) return;
    const px = pl.px, py = pl.py, veh = pl.vehicle;
    const speed = veh ? veh.speedMps : 0;
    const inside = s.x != null && Math.hypot(px - s.x, py - s.y) <= (s.radius || TUNING.dropRadius);
    if (j.requireVehicle && (s.action === 'pickup' || s.action === 'dropoff') && inside && veh !== j.requireVehicle) { this._hint('Use your taxi'); return; }
    const prog = (t) => bus.emit(MISSION_EV.LOADING, { job: j, t });

    if (s.action === 'enter') {
      if (s.vehicle && s.vehicle.state !== 'ok') { this._fail('vehicle destroyed', j); return; }
      if (veh && s.vehicle && veh === s.vehicle) {
        if (j.template === 'hotCar') {
          const police = this.ctx.systems.police;
          if (police && typeof police.addHeat === 'function') police.addHeat(j.heatAmount, 'mission');
          this._crime({ type: 'mission', severity: 0.5 }, veh.x, veh.y);
          pager('The car is hot, police are on to you!', 'crime', j.contactName);
        }
        this._advance(j);
      }
    } else if (s.action === 'steal') {
      if (j.targetCar && j.targetCar.state !== 'ok' && !(veh === j.targetCar)) { this._fail('target car destroyed', j); return; }
    } else if (s.action === 'visit') {
      if (inside) this._advance(j);
    } else if (s.action === 'wait') {
      if (inside) {
        j._loadT += dt;
        const t = clamp01(j._loadT / (s.loadTime || 5));
        prog(t);
        if (t >= 1) { prog(0); this._advance(j); }
      } else if (j._loadT > 0) { j._loadT = Math.max(0, j._loadT - dt * 2); prog(0); }
    } else if (s.action === 'pickup') {
      let ok = inside && speed < 3;
      if (inside && s.requires && pl.capacity - this.capacityUsed(j) < s.requires.capacity) {
        ok = false;
        const free = pl.capacity - this.capacityUsed(j);
        this._hint(`Needs more room: capacity ${s.requires.capacity} (you have ${free} free)`);
      } else if (inside && speed >= 3) this._hint('Stop inside the marker to load');
      if (ok) {
        j._loadT += dt;
        const t = Math.min(1, j._loadT / (s.loadTime || TUNING.loadSeconds));
        prog(t);
        if (t >= 1) {
          j.loaded = true;
          prog(0);
          this._crime(s.crime, s.x, s.y);
          if (j.stageIndex + 1 === j.timerFrom) pager(`Loaded ${j.cargo.name}. ${j.timeLimit}s on the clock!`, 'job', 'Dispatch');
          this._advance(j);
        }
      } else if (j._loadT > 0) { j._loadT = 0; prog(0); }
    } else if (s.action === 'dropoff') {
      if (!inside) return;
      if (j.heatLimit && Math.floor(this.ctx.state.heat) >= j.heatLimit) { this._fail('buyer spooked by the police heat', j); return; }
      if (j.minHealth && veh && veh.health / veh.maxHealth < j.minHealth) { this._hint(`Too damaged: needs at least ${Math.round(j.minHealth * 100)}% health`); return; }
      if (j.template === 'stealModel' && (!veh || veh.type !== j.stages[0].vehicleType)) { this._hint('Bring the ordered car'); return; }
      if (j.template === 'hotCar' && !veh) { this._hint('Bring the hot car'); return; }
      this._crime(s.crime, s.x, s.y);
      this._advance(j);
    } else if (s.action === 'lose') {
      const pol = this.ctx.systems.police;
      const heat = typeof pol?.getLevel === 'function' ? pol.getLevel() : this.ctx.state.heat;
      j._loseTotal = (j._loseTotal || 0) + dt;
      if (j._loseTotal > TUNING.loseTimeout) { j._loseTotal = 0; j._loseT = 0; this._fail('could not shake the police', j); return; }
      if (heat >= 1) j._heatSeen = true;
      if (heat < 0.5) { j._loseT += dt; if (j._loseT >= 3) this._advance(j); } else j._loseT = 0;
    }
  }

  // ------------------------------------------------------------ outcome
  _integrity(j) {
    const v = this.ctx.player.vehicle;
    const maxHp = v ? v.maxHealth : 100;
    return Math.max(0, 1 - j.damage / (maxHp * 0.6));
  }

  _succeed(j) {
    if (!this.jobs.includes(j)) return;
    const ctx = this.ctx, st = ctx.state;
    const frac = j.timeLimit ? Math.max(0, Math.min(1, (j.timeLeft ?? 0) / j.timeLimit)) : 0.5;
    const integ = j.cargo.fragile ? this._integrity(j) : 1;
    const eco = ctx.systems.economy;
    let base, tip = 0;
    if (j.fixed) {
      // gigs, challenges, event tasks: fixed reward (event boost already inside), small bonus for finishing early, no tip
      const amount = j.reward * (j.timeLimit && !j.survive ? 0.9 + 0.2 * frac : 1) * (j.cargo.fragile ? 0.6 + 0.4 * integ : 1);
      base = typeof eco?.scalePayout === 'function' ? eco.scalePayout(amount) : Math.round(amount);
    } else {
      const amount = j.reward * (0.7 + 0.5 * frac) * (j.cargo.fragile ? 0.5 + 0.5 * integ : 1);
      base = typeof eco?.scalePayout === 'function' ? eco.scalePayout(amount) : Math.round(amount);
      const tipMul = eco?.getEffects?.().tips ?? 1;
      tip = j.legal && frac > 0.15 && integ > 0.6 ? Math.round(base * TUNING.baseTip * tipMul * (0.5 + Math.random() * 0.5)) : 0;
      if (j.payoutFn) ({ base, tip } = j.payoutFn(ctx, j, { frac, integ })); // taxi meter
      else if (j.career === 'courier') tip = j.legal && frac > 0.15 && integ > 0.6 ? Math.round(base * TUNING.baseTip * tipMul * (0.5 + Math.random() * 0.5) * (0.6 + 0.2 * (ctx.state.jobs.courier.rating - 1))) : 0;
    }
    const payout = base + tip;
    j.state = 'success';
    j.payout = payout;
    bus.emit(EV.REQUEST_PAY, { amount: payout, reason: j.kind === 'order' ? 'delivery' : j.title });
    if (j.lq && typeof eco?.addLQ === 'function') eco.addLQ(j.lq);
    bus.emit(EV.JOB_COMPLETED, { job: j, payout, tip, base });
    pager(`${j.title} done: +${payout} kr${tip ? ` (tip ${tip})` : ''}${j.lq ? `, +${j.lq} LQ` : ''}`, 'job', j.contactName || (j.kind === 'gig' ? 'Gigs' : 'Dispatch'));
    if (j.kind === 'order') st.stats.deliveries++; else if (j.kind === 'mission') st.stats.missions++; else st.stats.gigs = (st.stats.gigs || 0) + 1;
    this.careers.onJobEnd(j, true, { frac, integ, payout, base, tip });
    if (j.template) {
      const lv = st.missions.levels;
      lv[j.template] = Math.max(lv[j.template] || 0, Math.min(j.level, TUNING.maxLevel));
      st.contactCooldowns[j.contactId] = simNow() + TUNING.contactCooldownDone;
      if (j.level < TUNING.maxLevel && lv[j.template] === j.level) pager(`Level ${j.level + 1} unlocked: ${TEMPLATES[j.template].title}`, 'job', j.contactName);
    }
    this._end(j);
  }

  _fail(reason, j = this.job) {
    if (!j || !this.jobs.includes(j)) return;
    j.state = 'failed';
    bus.emit(EV.JOB_FAILED, { job: j, reason });
    pager(`${j.title} failed: ${reason}`, 'warn', j.contactName || (j.kind === 'gig' ? 'Gigs' : 'Dispatch'));
    if (j.kind === 'gig' && j.loaded) { this.ctx.systems.economy?.addLQ?.(-1); pager('You let them down: -1 LQ', 'warn', 'Gigs'); }
    if (j.contactId) this.ctx.state.contactCooldowns[j.contactId] = simNow() + TUNING.contactCooldownDecline;
    this.careers.onJobEnd(j, false, { reason });
    this._end(j);
  }

  /** What abandoning this job costs (shown in the job app). */
  abandonPenalty(j) {
    if (!j) return '';
    if (j.career === 'courier') return 'Courier rating drops';
    if (j.career === 'taxi') return 'Counts as a failed fare';
    if (j.shift) return 'Shift ends, abandon penalty';
    if (j.kind === 'gig') return j.loaded ? '-1 LQ (you hold their things)' : 'No penalty';
    if (j.kind === 'mission') return 'Contact cooldown 45 s';
    return 'No penalty';
  }

  _failActive(reason) {
    if (this.offer) this.decline('busy');
    for (const j of this.jobs.slice()) if (!isLight(j)) this._fail(reason, j);
  }

  _end(j) {
    const i = this.jobs.indexOf(j);
    if (i >= 0) this.jobs.splice(i, 1);
    bus.emit(MISSION_EV.LOADING, { job: j, t: 0 });
    if (this.trackedId === j.id) {
      const next = this.jobs.find((q) => this._jobPos(q)) || this.jobs[0] || null;
      this.trackedId = next ? next.id : null;
    }
    this._syncTracked();
    this._targetKey = '';
    this._emitTarget(true);
    this._changed();
  }

  _onDamaged({ vehicle, amount }) {
    if (vehicle !== this.ctx.player.vehicle) return;
    for (const j of this.jobs.slice()) {
      if (!j.loaded || !j.cargo.fragile) continue;
      j.damage += amount;
      const integrity = this._integrity(j);
      bus.emit(MISSION_EV.CARGO, { job: j, damage: j.damage, integrity });
      if (integrity <= 0.05) this._fail(j.passenger ? 'the passenger bailed out' : 'cargo ruined', j);
    }
  }

  _onDestroyed({ vehicle }) {
    if (vehicle !== this.ctx.player.vehicle) return;
    for (const j of this.jobs.slice()) if (j.loaded && j.template !== 'stealModel' && !isLight(j)) this._fail('vehicle destroyed', j);
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
        else if (o.gig && Math.hypot(pl.px - o.gig.x, pl.py - o.gig.y) > TASKS.gig.withdrawM * PX) this.decline('left');
      }
    }
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.track)) this.cycleTrack(1);

    this.careers.update(dt, time);
    for (const j of this.jobs.slice()) {
      if (!this.jobs.includes(j)) continue;
      if (j.shift) continue; // bus shift: the careers module drives the stages
      if (j.timeLeft != null && j.stageIndex >= j.timerFrom && j.stageIndex < j.timerTo) {
        j.timeLeft -= dt;
        j._timerEmit = (j._timerEmit || 0) - dt;
        if (j._timerEmit <= 0) { j._timerEmit = 0.25; bus.emit(MISSION_EV.TIMER, { job: j, timeLeft: j.timeLeft, timeLimit: j.timeLimit }); }
        if (j.timeLeft <= 0) {
          j.timeLeft = 0;
          if (j.survive) this._succeed(j); else this._fail('out of time', j);
          continue;
        }
      }
      this._updateStage(j, dt);
    }
    if (this.jobs.length) this._emitTarget(false);
    if (!this.offer && this.slotsUsed() < MAX && !this.careers.shiftActive() && !this.jobs.some((j) => j.kind === 'mission')) this._checkContacts(time);
    this.board.update(dt, time);
    this._draw(time);
    this._saveAt -= dt;
    if (this._saveAt <= 0) { this._saveAt = 1; this._saveTasks(); }
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
    let tgt = null;
    for (const j of this.jobs) {
      const s = j.stages[j.stageIndex];
      const p = s && this._stagePos(s);
      if (!s || !p) continue;
      const tracked = j.id === this.trackedId;
      const kind = s.action === 'pickup' ? 'pickup' : s.action === 'dropoff' || s.action === 'busstop' ? 'dropoff' : s.action === 'visit' || s.action === 'wait' ? 'pickup' : 'target';
      const prog = s.action === 'pickup' || s.action === 'wait' ? j._loadT / (s.loadTime || TUNING.loadSeconds) : s.action === 'busstop' ? this.careers.bus.dwellFrac() : 0;
      m.draw({ kind, x: p.x, y: p.y, r: tracked ? (s.radius || 80) : Math.min(s.radius || 80, 60), label: tracked ? s.name : `${j.short || j.title}`, progress: prog, dim: !tracked }, time);
      if (tracked) tgt = p;
    }
    if (!this.jobs.length && this.offer && !this.offer.gig) {
      const s = this.offer.job.stages[0];
      m.draw({ kind: 'pickup', x: s.x, y: s.y, r: s.radius || 80, label: `${s.name} (offered)` }, time);
    } else if (!this.jobs.length) this.careers.draw(m, time);
    m.end();
    if (tgt && pl) m.pointArrow(pl.px, pl.py, tgt.x, tgt.y);
    else m.pointArrow(0, 0, null);
  }

  destroy() {
    this.markers.destroy();
    this.board.destroy();
    this.careers.destroy();
    this.ctx.state.job = null;
    this.jobs.length = 0;
    this.offer = null;
  }
}
