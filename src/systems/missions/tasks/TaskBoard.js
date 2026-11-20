// TaskBoard: everything that is AVAILABLE to accept around the city. OWNER: JOBS specialist.
//
// The MissionSystem owns the ACTIVE list (up to TASKS.maxActive jobs, one tracked). The board owns what can be accepted:
//   gigs        street gigs spawned around the player (3-6 within 600 m, at least one within 250 m), walk up and press E
//   challenges  optional mini-tasks offered now and then (pager + Tasks tab)
//   events      timed city events (concert, match, bar rush, rain, Christmas market) scheduled on the economy game clock;
//               inside an event area courier offers, gigs and taxi fares pay more (board.eventAt(x, y))
//   entries()   one list of everything nearby sorted by distance: gigs, courier offers, taxi stands, bus first stops, events,
//               challenges (the "Nearby" list in the job app and the pins on the minimap / full map)
//
// PUBLIC API (ctx.systems.missions.board)
//   gigs, challenges, events                  live arrays
//   entries(force?) -> [entry]                { key, type, id, title, sub, pay, lq, ttl, x, y, r?, dist, act, boost? } sorted by distance
//   pins() -> [{ key, type, x, y, hot }]      available things with a position (HUD minimap, full map, world pins)
//   acceptEntry(entry) -> { ok, reason? }     accept / start / head-to-event
//   eventAt(x, y) -> event | null             the strongest event covering a world point (rain covers everything)
//   isRaining(), activeEvents()
//   forceEvent(kind), forceGig(tpl?), forceChallenge(tpl?)   debug / tests
// State: state.tasks = { tracked, active: [persisted jobs], events: [active events], cd: { kind: gameMinute } } (saved).
import { PX } from '../../../config.js';
import { bus, EV, listen, pager, POLICE_EV } from '../../../core/events.js';
import { TASKS, EVENT_RULES, gameDate } from '../../../data/tasks.js';
import { TAXI, BUS } from '../../../data/missions.js';
import { TASKS_EV } from '../events.js';
import { makeHelper, GIG_TEMPLATES, jobFromSpec } from './gigs.js';
import { CHALLENGE_TEMPLATES } from './challenges.js';
import { TaskMarkers } from './TaskMarkers.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wpick = (list) => {
  let tot = 0;
  for (const t of list) tot += t.weight;
  let r = Math.random() * tot;
  for (const t of list) { r -= t.weight; if (r <= 0) return t; }
  return list[0];
};
export const fmtDist = (m) => (m == null ? '' : m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export class TaskBoard {
  constructor(missions) {
    this.missions = missions;
    this.ctx = missions.ctx;
    const st = this.ctx.state;
    st.tasks = st.tasks || {};
    st.tasks.events = (st.tasks.events || []).filter((e) => e && e.endMin);
    st.tasks.cd = st.tasks.cd || {};
    this.st = st.tasks;
    this.gigs = [];
    this.challenges = [];
    this.events = this.st.events; // same array object so the save always sees it
    this.markers = new TaskMarkers(this.ctx.scene);
    this._gigT = 0;
    this._firstGigs = true;
    this._evT = 1;
    this._chT = TASKS.challenge.firstAfter;
    this._pingAt = -1e9;
    this._entries = [];
    this._entriesAt = -1e9;
    this._pins = [];
    this._declined = new Map(); // gig id -> seconds until it may be offered again
    this._shown = null;
    this._seenGamePrompt = undefined;
    this._promptAt = -1;
    this._clock = 0;
    for (const e of this.events) e.color = e.color ?? 0xe05cff;

    const kb = this.ctx.scene.input.keyboard;
    this._onE = () => this._pressE();
    kb?.on('keydown-E', this._onE);
    listen(this.ctx.scene, EV.JOB_COMPLETED, (e) => this._onCompleted(e.job));
    listen(this.ctx.scene, POLICE_EV.TICKET, (t) => this._onTicket(t));
    listen(this.ctx.scene, EV.PLAYER_DIED, () => { this._declined.clear(); });
  }

  get world() { return this.ctx.world; }
  get pl() { return this.ctx.player; }

  // ------------------------------------------------------------------ clock / events
  now() { return this.ctx.systems.economy?.getClock?.().minutes ?? 0; }

  isRaining() { return this.events.some((e) => e.kind === 'rain'); }
  activeEvents() { return this.events; }

  /** The strongest event covering (x, y): rain covers the whole city. */
  eventAt(x, y) {
    let best = null;
    for (const e of this.events) {
      if (!e.global && Math.hypot(e.x - x, e.y - y) > e.r) continue;
      if (!best || e.pay > best.pay) best = e;
    }
    return best;
  }

  _resolvePlace(id) {
    const w = this.world;
    const lm = w.landmark(id);
    if (lm) return { x: lm.x, y: lm.y, name: lm.n };
    const p = w.pois.find((q) => q.n && new RegExp(id, 'i').test(q.n));
    return p ? { x: p.x, y: p.y, name: p.n } : null;
  }

  startEvent(kind, opts = {}) {
    const rule = EVENT_RULES.find((r) => r.kind === kind);
    if (!rule || this.events.some((e) => e.kind === kind)) return null;
    const now = this.now();
    let place = null;
    if (!rule.global) {
      const ids = rule.places.slice().sort(() => Math.random() - 0.5);
      for (const id of ids) { place = this._resolvePlace(id); if (place) break; }
      if (!place) return null;
    }
    const dur = opts.dur ?? Math.round(rnd(...rule.dur));
    const friday = kind === 'barRush' && Math.floor(now / 1440) % 7 === 4;
    const pay = rule.pay * (kind === 'barRush' && !friday ? 0.75 : 1);
    const ev = {
      id: `ev${Math.round(now)}${kind}`, kind, global: !!rule.global, x: place?.x ?? 0, y: place?.y ?? 0, r: (rule.r || 0) * PX, place: place?.name || 'Aarhus',
      name: rule.global ? rule.name : kind === 'concert' ? `Concert at ${place.name}` : kind === 'match' ? `AGF match at ${place.name}` : kind === 'barRush' ? (friday ? 'Friday bar rush' : 'Bar rush') + ` in ${place.name}` : kind === 'xmas' ? 'Julemarked på Store Torv' : rule.name,
      startMin: now, endMin: now + dur, pay, surge: 1 + (rule.surge - 1) * (pay / rule.pay), text: rule.text,
      color: kind === 'rain' ? 0x4da3ff : 0xe05cff,
    };
    this.events.push(ev);
    this.st.cd[kind] = now + dur + rule.cooldown;
    const pct = Math.round(pay * 100);
    const hrs = Math.round(dur / 60 * 10) / 10;
    pager(`${ev.name}: ${rule.text} Courier, gig and taxi pay +${pct}% ${ev.global ? 'everywhere' : `around ${place.name}`} for about ${hrs} h.`, 'job', 'Byen');
    bus.emit(EV.BANNER, { text: `EVENT: ${ev.name}`, color: ev.global ? '#4DA3FF' : '#E05CFF', ms: 3400 });
    bus.emit(TASKS_EV.EVENT_STARTED, { event: ev });
    this._dirty();
    return ev;
  }

  _scheduleEvents(dt) {
    this._evT -= dt;
    if (this._evT > 0) return;
    this._evT = TASKS.event.checkEvery;
    const now = this.now();
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (now >= e.endMin) {
        this.events.splice(i, 1);
        pager(`${e.name} is over. Demand is back to normal.`, 'info', 'Byen');
        bus.emit(TASKS_EV.EVENT_ENDED, { event: e });
        this._dirty();
      }
    }
    if (this.events.length >= TASKS.event.maxActive) return;
    const day = Math.floor(now / 1440), wd = day % 7, h = (now % 1440) / 60;
    for (const rule of EVENT_RULES) {
      if (this.events.some((e) => e.kind === rule.kind)) continue;
      if (now < (this.st.cd[rule.kind] || 0)) continue;
      if (!rule.when(wd, h, day)) continue;
      if (Math.random() < rule.chance * (this.chanceMul || 1)) { this.startEvent(rule.kind); break; } // chanceMul: tests only
    }
  }

  // ------------------------------------------------------------------ gigs
  usedKeys() {
    const s = new Set();
    for (const g of this.gigs) s.add(g.key);
    for (const j of this.missions.jobs) if (j.srcKey) s.add(j.srcKey);
    return s;
  }

  forceGig(tpl, opts = {}) { return this.spawnGig({ tpl, ...opts, force: true }); }

  spawnGig(o = {}) {
    const pl = this.pl;
    if (!pl) return null;
    const cfg = TASKS.gig;
    let ox = pl.px, oy = pl.py, lo = o.lo ?? 130, hi = o.hi ?? 560;
    if (o.event) { ox = o.event.x; oy = o.event.y; lo = 0; hi = Math.max(80, o.event.r / PX * 0.9); }
    const pool = o.tpl ? GIG_TEMPLATES.filter((t) => t.id === o.tpl) : GIG_TEMPLATES.slice();
    for (let attempt = 0; attempt < 8 && pool.length; attempt++) {
      const t = o.tpl ? pool[0] : wpick(pool);
      const B = makeHelper(this, { x: ox, y: oy, lo, hi });
      let spec = null;
      try { spec = t.build(B); } catch (err) { console.warn('gig build failed', t.id, err); }
      if (!spec) { if (!o.tpl) pool.splice(pool.indexOf(t), 1); continue; }
      const job = jobFromSpec(spec);
      job.srcKey = spec.key;
      const s0 = job.stages[0];
      if (!o.force && this.gigs.some((g) => dist(g, s0) < 45 * PX)) continue;
      if (!o.force && Math.hypot(s0.x - pl.px, s0.y - pl.py) / PX > (o.event ? 2400 : hi + 160)) continue;
      const ev = this.eventAt(s0.x, s0.y);
      if (ev) { job.reward = Math.round(job.reward * (1 + ev.pay)); job.event = ev.name; job.eventPay = ev.pay; }
      const gig = { id: job.id, tpl: spec.tpl, key: spec.key, job, x: s0.x, y: s0.y, ttl: rnd(...cfg.ttl), born: this._clock };
      this.gigs.push(gig);
      bus.emit(TASKS_EV.GIG_SPAWNED, { gig });
      if (!this._firstGigs && !o.quiet && Math.hypot(gig.x - pl.px, gig.y - pl.py) / PX < cfg.pingM && this._clock - this._pingAt > cfg.pingEvery) {
        this._pingAt = this._clock;
        pager(`Gig nearby: ${job.short} · ${job.reward} kr${job.event ? ` (${job.event})` : ''}. Walk up and press E.`, 'job', 'Gigs');
      }
      this._dirty();
      return gig;
    }
    return null;
  }

  removeGig(gig) {
    const i = this.gigs.indexOf(gig);
    if (i >= 0) this.gigs.splice(i, 1);
    this._dirty();
  }

  _fillGigs(dt) {
    this._gigT -= dt;
    if (this._gigT > 0) return;
    this._gigT = TASKS.gig.spawnEvery;
    const pl = this.pl, cfg = TASKS.gig;
    const near = this.gigs.filter((g) => Math.hypot(g.x - pl.px, g.y - pl.py) / PX < cfg.nearM);
    const close = near.some((g) => Math.hypot(g.x - pl.px, g.y - pl.py) / PX < cfg.closeM);
    const burst = this._firstGigs ? 6 : near.length < cfg.minNear - 1 ? 3 : near.length < cfg.minNear ? 2 : 1;
    this._firstGigs = false;
    if (this.gigs.length >= cfg.maxTotal && near.length < cfg.minNear) { // stale gigs left behind: make room near the player
      let fi = -1, fd = 0;
      this.gigs.forEach((q, i) => { const d = Math.hypot(q.x - pl.px, q.y - pl.py); if (d > fd && this.missions.offer?.gig !== q) { fd = d; fi = i; } });
      if (fi >= 0) this.gigs.splice(fi, 1);
    }
    for (let b = 0; b < burst; b++) {
      if (this.gigs.length >= cfg.maxTotal) break;
      const nNear = near.length;
      if (nNear >= cfg.minNear && (close || b > 0)) {
        if (nNear >= cfg.maxNear || Math.random() > 0.12) break; // occasional variety spawns up to maxNear
      }
      const wantClose = !close && b === 0;
      const ev = this.events.find((e) => !e.global && Math.hypot(e.x - pl.px, e.y - pl.py) / PX < 1400);
      const g = ev && Math.random() < 0.4 && this.gigs.filter((q) => q.job.event).length < 4
        ? this.spawnGig({ event: ev })
        : this.spawnGig({ lo: wantClose ? 80 : 150, hi: wantClose ? 235 : 575 });
      if (g) near.push(g);
    }
  }

  // ------------------------------------------------------------------ challenges
  forceChallenge(tpl) { return this._offerChallenge(tpl); }

  _offerChallenge(tpl) {
    const pl = this.pl;
    const taken = new Set([...this.challenges.map((c) => c.job.tpl), ...this.missions.jobs.filter((j) => j.kind === 'challenge').map((j) => j.tpl)]);
    const pool = tpl ? CHALLENGE_TEMPLATES.filter((t) => t.id === tpl) : CHALLENGE_TEMPLATES.filter((t) => !taken.has(t.id));
    const B = makeHelper(this, {});
    while (pool.length) {
      const t = tpl ? pool[0] : wpick(pool);
      let job = null;
      try { job = t.build(B); } catch (err) { console.warn('challenge build failed', t.id, err); }
      if (job) {
        const c = { id: job.id, job, ttl: TASKS.challenge.ttl };
        this.challenges.push(c);
        bus.emit(TASKS_EV.CHALLENGE_OFFERED, { challenge: c });
        pager(`Challenge: ${job.title} (${job.reward} kr${job.lq ? `, +${job.lq} LQ` : ''}). Accept it in the job app: J, Tasks tab.`, 'job', 'Challenge');
        this._dirty();
        return c;
      }
      pool.splice(pool.indexOf(t), 1);
      if (tpl) break;
    }
    void pl;
    return null;
  }

  _scheduleChallenges(dt) {
    for (let i = this.challenges.length - 1; i >= 0; i--) {
      this.challenges[i].ttl -= dt;
      if (this.challenges[i].ttl <= 0) { this.challenges.splice(i, 1); this._dirty(); }
    }
    this._chT -= dt;
    if (this._chT > 0) return;
    this._chT = rnd(...TASKS.challenge.every);
    if (this.challenges.length >= TASKS.challenge.maxOffered) return;
    this._offerChallenge();
  }

  _onCompleted(job) {
    if (!job || job.kind !== 'order') return;
    const last = job.stages?.[job.stages.length - 1];
    for (const ch of this.missions.jobs.slice()) {
      if (ch.kind !== 'challenge' || ch.watch?.event !== 'delivery') continue;
      if (ch.watch.district && last && this.world.districtAt(last.x, last.y) !== ch.watch.district) continue;
      this.missions.progress(ch);
    }
  }

  _onTicket(t) {
    for (const ch of this.missions.jobs.slice()) {
      if (ch.kind !== 'challenge' || !ch.watch) continue;
      if (ch.watch.anyFine || (ch.watch.fineType && ch.watch.fineType === t.type)) this.missions.failJob(ch, 'fined');
    }
  }

  // ------------------------------------------------------------------ entries (the "Nearby" list and map pins)
  _dirty() { this._entriesAt = -1e9; }

  entries(force = false) {
    if (!force && this._clock - this._entriesAt < 0.5) return this._entries;
    this._entriesAt = this._clock;
    this._entries = this._buildEntries();
    this._pins = this._entries.filter((e) => e.x != null).map((e) => ({ key: e.key, type: e.type, x: e.x, y: e.y, hot: !!(e.boost || e.event), label: e.type === 'gig' ? e.shortLabel : undefined }));
    return this._entries;
  }

  pins() { this.entries(); return this._pins; }

  _buildEntries() {
    const pl = this.pl, w = this.world, m = this.missions, c = m.careers;
    const out = [];
    const metres = (x, y) => Math.round(Math.hypot(x - pl.px, y - pl.py) / PX);
    for (const g of this.gigs) {
      const j = g.job;
      out.push({ key: `gig:${g.id}`, type: 'gig', id: g.id, title: j.title, shortLabel: `${j.short} · ${j.reward} kr`, sub: j.blurb, pay: j.reward, lq: j.lq, ttl: g.ttl, limit: j.timeLimit, x: g.x, y: g.y, dist: metres(g.x, g.y), act: 'Accept', boost: j.event, job: j, stops: j.stages.length });
    }
    for (const o of c.courier.offers) {
      out.push({ key: `cr:${o.id}`, type: 'courier', id: o.id, title: `Bybud: ${o.item}`, shortLabel: `${o.from.name} · ${o.reward} kr`, sub: `${o.from.name} to ${o.to.name} · ${fmtDist(o.metres)}${o.size > 1 ? ' · big' : ''}${o.fragile ? ' · fragile' : ''}`, pay: o.reward, ttl: o.life, x: o.from.x, y: o.from.y, dist: metres(o.from.x, o.from.y), act: 'Accept', boost: o.event, size: o.size });
    }
    const offer = m.offer;
    if (offer?.job?.career === 'taxi') {
      const s = offer.job.stages[0];
      out.push({ key: `hail:${offer.job.id}`, type: 'taxi', id: offer.job.id, title: `Fare hail: ${offer.job.title}`, sub: `Passenger at ${s.name}`, pay: offer.job.reward, x: s.x, y: s.y, dist: metres(s.x, s.y), act: 'Accept', hail: true, boost: offer.job.event });
    }
    // taxi stands and bus first stops (start a shift there)
    if (!c.shiftActive()) {
      const stands = c.taxi.stands().map((s) => ({ s, d: metres(s.x, s.y) })).filter((q) => q.d < 1600).sort((a, b) => a.d - b.d).slice(0, 3);
      for (const { s, d } of stands) {
        const ev = this.eventAt(s.x, s.y);
        out.push({ key: `stand:${Math.round(s.x)}:${Math.round(s.y)}`, type: 'taxi', id: 'stand', title: s.label, sub: `Start a ${TAXI.company} shift${ev ? ` · surge x${ev.surge.toFixed(1)}` : ''}`, x: s.x, y: s.y, dist: d, act: c.taxi.signed ? 'Start shift' : 'Sign up + start', stand: true, boost: ev ? ev.name : null });
      }
      const stops = c.bus.routes().filter((r) => r.firstM < 1300).slice(0, 2);
      for (const r of stops) {
        out.push({ key: `bus:${r.idx}`, type: 'bus', id: r.idx, title: `Line ${r.ref}: ${r.first.name}`, sub: `Start a ${BUS.company} shift · ${r.shiftStops - 1} stops`, x: r.first.x, y: r.first.y, dist: r.firstM, act: c.bus.signed ? 'Start shift' : 'Sign up + start', routeIdx: r.idx });
      }
    }
    for (const e of this.events) {
      if (e.global) { out.push({ key: `ev:${e.id}`, type: 'event', id: e.id, title: e.name, sub: `Citywide · pay +${Math.round(e.pay * 100)}% · ${this._fmtLeft(e)} left`, pay: null, dist: null, act: 'Info', global: true, event: e }); continue; }
      out.push({ key: `ev:${e.id}`, type: 'event', id: e.id, title: e.name, sub: `Pay +${Math.round(e.pay * 100)}%, taxi x${e.surge.toFixed(1)} · ${this._fmtLeft(e)} left`, x: e.x, y: e.y, r: e.r, dist: metres(e.x, e.y), act: 'Head there', event: e });
    }
    for (const ch of this.challenges) {
      const j = ch.job;
      out.push({ key: `ch:${ch.id}`, type: 'challenge', id: ch.id, title: j.title, sub: j.blurb, pay: j.reward, lq: j.lq, ttl: ch.ttl, limit: j.timeLimit, x: null, y: null, dist: null, act: 'Accept', job: j });
    }
    out.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
    void w;
    return out.slice(0, TASKS.nearbyListMax);
  }

  _fmtLeft(e) {
    const m = Math.max(0, e.endMin - this.now());
    return m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
  }

  // ------------------------------------------------------------------ accepting
  acceptEntry(e) {
    const m = this.missions, c = m.careers;
    if (!e) return { ok: false, reason: 'Nothing selected' };
    if (e.type === 'gig') return this.acceptGig(e.id);
    if (e.type === 'courier') return c.courier.accept(e.id);
    if (e.hail) { const ok = m.accept(); return ok ? { ok: true } : { ok: false, reason: 'Cannot accept right now' }; }
    if (e.stand) { if (!c.taxi.signed) c.taxi.signUp(); return c.taxi.startShift(); }
    if (e.type === 'bus') { if (!c.bus.signed) c.bus.signUp(); return c.bus.startShift(e.routeIdx); }
    if (e.type === 'event') return this.acceptEvent(e.id);
    if (e.type === 'challenge') return this.acceptChallenge(e.id);
    return { ok: false, reason: 'Cannot accept this' };
  }

  acceptGig(id) {
    const g = this.gigs.find((q) => q.id === id);
    if (!g) return { ok: false, reason: 'That gig is gone' };
    const can = this.missions.canAccept(g.job);
    if (!can.ok) return can;
    this.removeGig(g);
    if (this.missions.offer?.gig === g) this.missions.offer = null;
    this.missions.addJob(g.job);
    return { ok: true };
  }

  acceptChallenge(id) {
    const i = this.challenges.findIndex((q) => q.id === id);
    if (i < 0) return { ok: false, reason: 'That challenge expired' };
    const can = this.missions.canAccept(this.challenges[i].job);
    if (!can.ok) return can;
    const [c] = this.challenges.splice(i, 1);
    this.missions.addJob(c.job, { track: false });
    this._dirty();
    return { ok: true };
  }

  acceptEvent(id) {
    const e = this.events.find((q) => q.id === id);
    if (!e) return { ok: false, reason: 'That event is over' };
    if (e.global) return { ok: false, reason: 'Rain is citywide: every order pays more' };
    if (this.missions.jobs.some((j) => j.kind === 'event' && j.eventId === e.id)) return { ok: false, reason: 'Already on your list' };
    const job = {
      id: `evt${e.id}`, kind: 'event', task: 'event', eventId: e.id, title: `Head to ${e.place}`, short: `Event: ${e.place}`, blurb: e.text, legal: true, level: 1, state: 'offered',
      stages: [{ action: 'visit', x: e.x, y: e.y, name: e.name, radius: Math.max(100, e.r * 0.6) }], stageIndex: 0, timeLeft: null, timeLimit: 0, timerFrom: 0, timerTo: 0,
      reward: 25, lq: 0, metres: 0, cargo: { size: 0, fragile: false, name: 'Event' }, damage: 0, loaded: false, fixed: true, persist: true, event: null,
    };
    const can = this.missions.canAccept(job);
    if (!can.ok) return can;
    this.missions.addJob(job);
    return { ok: true };
  }

  // ------------------------------------------------------------------ E: see the offer of a gig pin
  _nearGig() {
    const pl = this.pl;
    if (!pl || pl.dead) return null;
    let best = null, bd = TASKS.gig.interactM * PX;
    for (const g of this.gigs) {
      if ((this._declined.get(g.id) || 0) > 0) continue;
      const d = Math.hypot(g.x - pl.px, g.y - pl.py);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  _blocked() {
    const sc = this.ctx.scene;
    return sc.scene.isActive('Overlay') || sc.scene.isActive('JobApp') || !sc.scene.isActive();
  }

  _pressE() {
    if (this._blocked()) return;
    const g = this._nearGig();
    if (!g || this.missions.offer) return;
    if (this.ctx.systems.economy?._nearest?.()) return; // home door / shop pad wins
    this.pl.keys.enter.reset(); // consume this E press (no vehicle in/out)
    this.missions.offerGig(g);
  }

  _updatePrompt() {
    const sc = this.ctx.scene;
    const g = !this._blocked() && !this.missions.offer ? this._nearGig() : null;
    const eco = g && this.ctx.systems.economy?._nearest?.();
    if (g && !eco) {
      const text = `[E] ${g.job.short} · ${g.job.reward} kr`;
      // re-emit about 4x/s: other systems hand their own prompt back once when they stop showing one (EconomySystem does)
      if (text !== this._shown || sc.lastPrompt !== this._seenGamePrompt || this._clock - this._promptAt > 0.25) {
        this._shown = text;
        this._seenGamePrompt = sc.lastPrompt;
        this._promptAt = this._clock;
        bus.emit(EV.PROMPT, { text });
      }
    } else if (this._shown) {
      this._shown = null;
      bus.emit(EV.PROMPT, { text: sc.lastPrompt ?? null });
    }
  }

  declined(gig) { this._declined.set(gig.id, TASKS.gig.declineHideSec); }

  // ------------------------------------------------------------------ loop
  update(dt, time) {
    this._clock += dt;
    const pl = this.pl;
    if (!pl) return;
    for (let i = this.gigs.length - 1; i >= 0; i--) {
      const g = this.gigs[i];
      g.ttl -= dt;
      const far = Math.hypot(g.x - pl.px, g.y - pl.py) / PX > TASKS.gig.despawnFarM;
      const offered = this.missions.offer?.gig === g;
      if ((g.ttl <= 0 || far) && !offered) { this.gigs.splice(i, 1); this._dirty(); }
    }
    for (const [k, v] of this._declined) { if (v - dt <= 0) this._declined.delete(k); else this._declined.set(k, v - dt); }
    this._fillGigs(dt);
    this._scheduleEvents(dt);
    this._scheduleChallenges(dt);
    this._updatePrompt();
    this.entries();
    this.markers.draw(this._pins, this.events, pl.px, pl.py, time);
  }

  destroy() {
    this.ctx.scene.input?.keyboard?.off('keydown-E', this._onE);
    this.markers.destroy();
  }
}
