// JobAppScene: phone job app overlay (J). OWNER: JOBS specialist.
//
// Opened with J (GameScene pauses Game and hides the HUD like Overlay). Four tabs (the fourth is TASKS: the active list with
// track / abandon, plus a "Nearby" list of gigs, courier offers, taxi stands, bus lines, events and challenges with accept):
//   Courier ("Bybud"): list of order offers from real Aarhus restaurants to home addresses; Enter accepts, D declines.
//   Taxi (company taxi): sign up, start a shift (a taxi waits at the nearest stand), end it.
//   Bus (real Aarhus routes): sign up, pick a route (list sorted by distance to its first stop), start a shift.
// Shows career level + XP, courier rating and the live job/shift status. Keys: Left/Right or 1-3 or Tab = career,
// Up/Down = move, Enter = act, D = decline (courier), X = abandon the active job, Esc or J = close.
// All logic lives in ctx.systems.missions.careers (systems/missions/careers/index.js); this scene only renders and calls it.
import Phaser from 'phaser';
import { bus, EV } from '../core/events.js';
import { C, S, txt, panel, ensureFonts, fmtKr, fmtTime } from '../ui/theme.js';
import { GAME_W, GAME_H } from '../config.js';
import { COURIER, TAXI, BUS, CAREER_NAMES } from '../data/missions.js';
import { TASKS } from '../data/tasks.js';
import { fmtMetres } from '../systems/missions/careers/shared.js';
import { drawTaskIcon } from '../ui/taskIcons.js';

const TABS = ['courier', 'taxi', 'bus', 'tasks'];
const APPS = { courier: COURIER.appName, taxi: TAXI.company, bus: BUS.company, tasks: 'Tasks' };
const TAB_NAMES = { ...CAREER_NAMES, tasks: 'Tasks' };
const W = 460, H = 668, ROWS = 5, ROW_H = 60;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class JobAppScene extends Phaser.Scene {
  constructor() { super('JobApp'); }

  create() {
    ensureFonts();
    this._closed = false; // the scene instance is reused between openings
    this.game3 = this.scene.get('Game');
    this.ctx = this.game3.ctx;
    this.missions = this.ctx.systems.missions;
    this.careers = this.missions.careers;
    this.tab = 0;
    this.sel = { courier: 0, taxi: 0, bus: 0, tasks: 0 };
    this.top = { courier: 0, taxi: 0, bus: 0, tasks: 0 };
    this.msg = '';
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x05070b, 0.72);
    this.x0 = GAME_W / 2 - W / 2;
    this.y0 = (GAME_H - H) / 2;
    this.layer = this.add.container(0, 0);
    this.render();
    const kb = this.input.keyboard;
    kb.on('keydown', (e) => this.onKey(e));
    this._tick = this.time.addEvent({ delay: 500, loop: true, callback: () => this.render() }); // live countdowns
  }

  // ------------------------------------------------------------------ rows per tab
  rows() {
    const c = this.careers, k = TABS[this.tab];
    if (k === 'courier') {
      const cap = this.ctx.player.capacity - this.missions.capacityUsed();
      return c.courier.offers.map((o) => ({
        id: o.id, kind: 'offer', title: o.from.name,
        sub: `to ${o.to.name} · ${fmtMetres(c.courier.pickupMetres(o))} away · ${fmtMetres(o.metres)}${o.size > 1 ? ' · big' : ''}${o.fragile ? ' · fragile' : ''}`,
        warn: o.size > cap ? `needs capacity ${o.size}` : '', right: fmtKr(o.reward), life: o.life,
      }));
    }
    if (k === 'tasks') return this.taskRows();
    if (k === 'taxi') {
      if (!c.taxi.signed) return [{ kind: 'signup', title: `Sign up with ${TAXI.company}`, sub: 'Free. A company taxi waits at the nearest stand.' }];
      if (c.taxi.shift) return [{ kind: 'end', title: c.taxi.shift.stage === 'return' ? 'Return the taxi to the stand' : 'End shift and return the taxi', sub: c.taxi.shift.stage === 'return' ? 'Drive back to the stand marker' : 'Finish the fare, then drive back' }];
      return [{ kind: 'start', title: 'Start a taxi shift', sub: `Meter: ${TAXI.base} kr + ${TAXI.perKm}/km + ${TAXI.perMin}/min. Tips for smooth, quick rides.` }];
    }
    if (!c.bus.signed) return [{ kind: 'signup', title: `Sign up with ${BUS.company}`, sub: 'Free. A city bus waits at the first stop of your route.' }];
    if (c.bus.shift) return [{ kind: 'end', title: 'End shift', sub: 'Pays what you earned minus a penalty' }];
    return c.bus.routes().map((r) => ({
      idx: r.idx, kind: 'route', title: `Line ${r.ref}  ${cut(`${r.from} - ${r.to}`, 30)}`,
      sub: `${r.shiftStops - 1} stops · starts ${cut(r.first.name, 26)} · ${fmtMetres(r.firstM)} away`, right: '',
    }));
  }

  // ------------------------------------------------------------------ render
  T(x, y, s, o) { const t = txt(this, x, y, s, o); this.layer.add(t); return t; }

  render() {
    if (!this.layer) return;
    this.layer.removeAll(true);
    const { x0, y0 } = this, c = this.careers, st = this.ctx.state, key = TABS[this.tab];
    const g = this.add.graphics();
    this.layer.add(g);
    panel(g, x0, y0, W, H, { fill: C.ink, alpha: 0.98, r: 28 });
    this.T(x0 + 28, y0 + 16, APPS[key], { head: true, size: 28, color: S.orange });
    this.T(x0 + W - 28, y0 + 22, fmtKr(st.money), { bold: true, size: 17, color: S.gold, ox: 1 });

    // tabs
    TABS.forEach((t, i) => {
      const tx = x0 + 22 + i * 104, on = i === this.tab;
      g.fillStyle(on ? C.orange : C.ink2, 1).fillRoundedRect(tx, y0 + 62, 98, 32, 16);
      this.T(tx + 49, y0 + 70, `${i + 1} ${TAB_NAMES[t]}`, { size: 13, bold: true, color: on ? S.ink : S.muted, ox: 0.5 });
    });

    if (key === 'tasks') { this.renderTasks(g); return; }

    // career header: level, xp, rating
    const li = c.levelInfo(key);
    this.T(x0 + 28, y0 + 108, `Level ${li.level}`, { head: true, size: 22, color: S.paper });
    const bx = x0 + 120, bw = 200;
    g.fillStyle(C.ink3, 1).fillRoundedRect(bx, y0 + 116, bw, 10, 5);
    g.fillStyle(C.green, 1).fillRoundedRect(bx, y0 + 116, Math.max(6, bw * li.frac), 10, 5);
    this.T(bx + bw + 10, y0 + 110, li.next == null ? `${li.xp} XP (max)` : `${li.xp}/${li.next} XP`, { size: 13, color: S.muted });
    this.T(x0 + 28, y0 + 136, this.perk(key, li.level), { size: 13, color: S.muted });
    if (key === 'courier') {
      const r = c.courier.rating, full = Math.round(r);
      this.T(x0 + 28, y0 + 158, '★'.repeat(full) + '☆'.repeat(5 - full), { size: 20, color: S.gold });
      this.T(x0 + 150, y0 + 162, `${r.toFixed(1)} rating · ${st.jobs.courier.done} delivered · ${c.courier.targetCount()} orders max`, { size: 13, color: S.muted });
      const lt = st.jobs.courier.lastTicket;
      if (lt) this.T(x0 + 28, y0 + 182, `Last fine: ${lt.label} (rating -${lt.drop.toFixed(2)})`, { size: 12, color: S.red || '#ff7a6b' });
    } else {
      const j = st.jobs[key];
      this.T(x0 + 28, y0 + 162, key === 'taxi' ? `${j.fares} fares · ${fmtKr(j.earned)} earned · ${j.shifts} shifts` : `${j.stops} stops · ${j.punctual} punctual · ${j.shifts} shifts`, { size: 13, color: S.muted });
    }

    // status card
    const cy = y0 + 200;
    g.fillStyle(C.ink2, 1).fillRoundedRect(x0 + 20, cy, W - 40, 74, 14);
    const lines = this.status(key);
    this.T(x0 + 34, cy + 8, lines[0], { bold: true, size: 15, color: lines[3] || S.paper });
    this.T(x0 + 34, cy + 30, lines[1], { size: 13, color: S.muted });
    this.T(x0 + 34, cy + 50, lines[2] || '', { size: 13, color: S.muted });

    // list
    const rows = this.rows();
    let sel = Math.min(this.sel[key], Math.max(0, rows.length - 1));
    this.sel[key] = sel;
    let top = this.top[key];
    if (sel < top) top = sel;
    if (sel >= top + ROWS) top = sel - ROWS + 1;
    this.top[key] = top;
    const ly = y0 + 278;
    if (!rows.length) this.T(x0 + W / 2, ly + 40, key === 'courier' ? 'No orders right now.\nNew ones appear every few seconds.' : 'Nothing available.', { size: 15, color: S.muted, ox: 0.5, align: 'center' });
    rows.slice(top, top + ROWS).forEach((r, i) => {
      const ry = ly + i * (ROW_H + 4), on = top + i === sel;
      g.fillStyle(on ? C.ink3 : C.ink2, 1).fillRoundedRect(x0 + 20, ry, W - 40, ROW_H, 12);
      if (on) g.lineStyle(2, C.orange, 1).strokeRoundedRect(x0 + 20, ry, W - 40, ROW_H, 12);
      this.T(x0 + 34, ry + 8, cut(r.title, r.right ? 34 : 44), { bold: true, size: 15, color: S.paper });
      this.T(x0 + 34, ry + 32, cut(r.sub, r.warn ? 40 : 58), { size: 12, color: S.muted });
      if (r.warn) this.T(x0 + W - 34, ry + 32, r.warn, { size: 12, bold: true, color: S.red, ox: 1 });
      if (r.right) this.T(x0 + W - 34, ry + 8, r.right, { bold: true, size: 16, color: S.gold, ox: 1 });
    });
    if (rows.length > ROWS) this.T(x0 + W - 28, ly + ROWS * (ROW_H + 4) - 2, `${sel + 1}/${rows.length}`, { size: 12, color: S.muted, ox: 1 });

    // footer
    const hint = key === 'courier' ? 'Up/Down choose · Enter accept · D decline · X abandon job' : 'Up/Down choose · Enter confirm · X abandon job';
    this.T(x0 + W / 2, y0 + H - 50, this.msg || hint, { size: 13, color: this.msg ? S.orange : S.muted, ox: 0.5 });
    this.T(x0 + W / 2, y0 + H - 30, '1-4 or Left/Right tabs · Esc or J close', { size: 12, color: S.muted, ox: 0.5 });
  }

  // ------------------------------------------------------------------ tasks tab
  taskRows() {
    const m = this.missions, rows = [];
    for (const t of m.taskList()) {
      rows.push({ kind: 'active', id: t.id, type: t.type, title: t.title, sub: `${t.stageName}${t.progress ? ` · ${t.progress}` : ''}${t.step && t.job && t.job.stages.length > 1 ? ` · step ${t.step}` : ''}`, tracked: t.tracked, job: t.job, pseudo: t.pseudo, timeLeft: t.timeLeft, tag: t.tracked ? 'TRACKED' : t.pseudo ? 'SHIFT' : 'ACTIVE', right: t.timeLeft != null ? fmtTime(t.timeLeft) : (t.reward ? fmtKr(t.reward) : '') });
    }
    for (const e of m.board.entries(true)) {
      const d = e.dist == null ? '' : `${fmtMetres(e.dist)} · `;
      rows.push({ kind: 'near', entry: e, type: e.type, title: e.title, sub: `${d}${e.sub}`, tag: e.act.toUpperCase(), right: e.pay ? fmtKr(e.pay) : '', boost: e.boost });
    }
    return rows;
  }

  renderTasks(g) {
    const { x0, y0 } = this, m = this.missions;
    const rows = this.rows();
    const key = 'tasks';
    const sel = Math.min(this.sel[key], Math.max(0, rows.length - 1));
    this.sel[key] = sel;
    const ROWS_T = 6;
    let top = this.top[key];
    if (sel < top) top = sel;
    if (sel >= top + ROWS_T) top = sel - ROWS_T + 1;
    this.top[key] = top;
    const used = m.slotsUsed();
    this.T(x0 + 28, y0 + 104, `${used}/${TASKS.maxActive} tasks`, { head: true, size: 22, color: used >= TASKS.maxActive ? S.orange : S.paper });
    const tj = this.ctx.state.job;
    this.T(x0 + W - 28, y0 + 110, tj ? `Tracking: ${cut(tj.short || tj.title, 24)}` : 'Nothing tracked', { size: 13, color: S.muted, ox: 1 });
    // detail card of the selected row
    const cy = y0 + 138, r = rows[sel];
    g.fillStyle(C.ink2, 1).fillRoundedRect(x0 + 20, cy, W - 40, 74, 14);
    if (r) {
      let l1 = cut(r.title, 44), l2 = '', l3 = '', col = S.paper;
      if (r.kind === 'active') {
        l2 = cut(r.job?.blurb || r.sub, 62);
        l3 = r.pseudo ? 'Shift: end it in its tab (2 or 3)' : `Abandon: ${m.abandonPenalty(r.job)}${r.job?.reward ? ` · pays ${fmtKr(r.job.reward)}` : ''}`;
        col = r.tracked ? S.orange : S.paper;
      } else {
        const e = r.entry;
        l2 = cut(e.job?.blurb || e.sub, 62);
        const bits = [];
        if (e.pay) bits.push(fmtKr(e.pay));
        if (e.lq) bits.push(`+${e.lq} LQ`);
        if (e.boost) bits.push(`boost: ${e.boost}`);
        if (e.limit) bits.push(`${fmtTime(e.limit)} to do it`);
        if (e.ttl) bits.push(`${fmtTime(e.ttl)} on the board`);
        l3 = bits.join(' · ');
      }
      this.T(x0 + 34, cy + 8, l1, { bold: true, size: 15, color: col });
      this.T(x0 + 34, cy + 30, l2, { size: 12, color: S.muted });
      this.T(x0 + 34, cy + 50, l3, { size: 13, color: r.kind === 'active' ? S.red : S.green });
    } else this.T(x0 + 34, cy + 26, 'Nothing here yet. Gigs appear around you every few seconds.', { size: 13, color: S.muted });
    const ly = y0 + 222;
    rows.slice(top, top + ROWS_T).forEach((q, i) => {
      const ry = ly + i * (ROW_H + 4), on = top + i === sel;
      g.fillStyle(on ? C.ink3 : C.ink2, 1).fillRoundedRect(x0 + 20, ry, W - 40, ROW_H, 12);
      if (on) g.lineStyle(2, C.orange, 1).strokeRoundedRect(x0 + 20, ry, W - 40, ROW_H, 12);
      if (q.tracked) g.fillStyle(C.orange, 1).fillRoundedRect(x0 + 20, ry + 8, 4, ROW_H - 16, 2);
      drawTaskIcon(g, q.type, x0 + 46, ry + ROW_H / 2, 10);
      this.T(x0 + 66, ry + 8, cut(q.title, q.right ? 30 : 38), { bold: true, size: 15, color: S.paper });
      this.T(x0 + 66, ry + 32, cut(q.sub, 50), { size: 12, color: S.muted });
      if (q.right) this.T(x0 + W - 34, ry + 8, q.right, { bold: true, size: 15, color: q.kind === 'active' && q.timeLeft != null ? (q.timeLeft < 15 ? S.red : q.timeLeft < 60 ? S.orange : S.paper) : S.gold, ox: 1 });
      this.T(x0 + W - 34, ry + 34, q.tag, { size: 11, bold: true, color: q.kind === 'active' ? (q.tracked ? S.orange : S.muted) : q.boost ? S.gold : S.green, ox: 1 });
    });
    if (rows.length > ROWS_T) this.T(x0 + W - 28, ly + ROWS_T * (ROW_H + 4) - 2, `${sel + 1}/${rows.length}`, { size: 12, color: S.muted, ox: 1 });
    const cur = rows[sel];
    const hint = !cur ? 'Esc or J close' : cur.kind === 'active' ? 'Enter track · X abandon · Up/Down choose' : 'Enter accept · Up/Down choose';
    this.T(x0 + W / 2, y0 + H - 50, this.msg || hint, { size: 13, color: this.msg ? S.orange : S.muted, ox: 0.5 });
    this.T(x0 + W / 2, y0 + H - 30, '1-4 or Left/Right tabs · Esc or J close', { size: 12, color: S.muted, ox: 0.5 });
  }

  perk(key, lvl) {
    if (key === 'courier') return `Trips up to ${fmtMetres(COURIER.maxMetres[lvl - 1])}, orders up to ${COURIER.sizeMax[lvl - 1]} capacity, pay x${COURIER.levelPay[lvl - 1].toFixed(2)}`;
    if (key === 'taxi') return `Fares up to ${fmtMetres(TAXI.maxMetres[lvl - 1])}, ${Math.round(TAXI.shiftSeconds[lvl - 1] / 60)} min shifts, meter x${TAXI.levelSurcharge[lvl - 1].toFixed(2)}`;
    return `Shifts of up to ${BUS.stopsPerShift[lvl - 1] - 1} stops, pay x${BUS.levelPay[lvl - 1].toFixed(2)}`;
  }

  /** [headline, line 2, line 3, headline colour?] */
  status(key) {
    const m = this.missions, c = this.careers, j = m.jobOfCareer(key);
    if (key === 'taxi' && c.taxi.shift) {
      const s = c.taxi.shift;
      const head = s.stage === 'toTaxi' ? 'Shift: get in your taxi' : s.stage === 'return' ? 'Shift: return the taxi' : 'On shift: waiting for fares';
      return [head, `${s.fares} fares · ${fmtKr(s.earned)} · ${s.stage === 'work' ? `${fmtTime(s.timeLeft)} left` : s.stand.name}`, j?.career === 'taxi' ? `Fare: ${cut(j.stages[j.stageIndex]?.name || '', 40)} · meter ${fmtKr(j.reward)}` : 'Stay in the taxi; passengers hail at stands and streets', S.green];
    }
    if (key === 'bus' && c.bus.shift) {
      const s = c.bus.shift, ab = c.bus.aheadBehind(), k = s.job.stageIndex;
      const head = k === 0 ? `Line ${s.route.ref}: get in the bus` : `Line ${s.route.ref}: next ${cut(s.stops[k]?.name || '', 28)}`;
      const sched = ab == null ? 'Schedule starts when you board' : ab >= 0 ? `${fmtTime(ab)} ahead of schedule` : `${fmtTime(-ab)} behind schedule`;
      return [head, `${sched} · stop ${Math.max(0, k - 1)}/${s.stops.length - 1}`, `Served ${s.served}, skipped ${s.skipped}, punctual ${s.punctual} · ${fmtKr(Math.max(0, s.pay))}`, ab != null && ab < 0 ? S.red : S.green];
    }
    if (j && j.career === key) {
      const st = j.stages[j.stageIndex];
      const more = key === 'courier' ? m.jobs.filter((q) => q.career === 'courier').length - 1 : 0;
      return [cut(j.title, 38) + (more > 0 ? `  (+${more} more)` : ''), `${j.stageIndex === 0 ? 'Pick up at' : 'Deliver to'} ${cut(st?.name || '', 34)}`, j.timeLeft != null ? `${fmtTime(j.timeLeft)} left · ${fmtKr(j.reward)}` : fmtKr(j.reward), S.green];
    }
    if (m.offer) return ['A job offer is waiting', 'Answer it with Y or N in the game', '', S.orange];
    if (key === 'courier') return ['Online', `Pick an order below · ${m.slotsUsed()}/${TASKS.maxActive} tasks`, '', S.green];
    const signed = c[key].signed;
    return [signed ? 'Off shift' : 'Not signed up', signed ? 'Start a shift to work' : 'Sign up to unlock this career', '', S.muted];
  }

  // ------------------------------------------------------------------ input
  onKey(e) {
    const k = e.code, key = TABS[this.tab];
    this.msg = '';
    if (k === 'Escape' || k === 'KeyJ') return this.close();
    if (k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey)) this.tab = (this.tab + TABS.length - 1) % TABS.length;
    else if (k === 'ArrowRight' || k === 'Tab') this.tab = (this.tab + 1) % TABS.length;
    else if (k === 'Digit1' || k === 'Numpad1') this.tab = 0;
    else if (k === 'Digit2' || k === 'Numpad2') this.tab = 1;
    else if (k === 'Digit3' || k === 'Numpad3') this.tab = 2;
    else if (k === 'Digit4' || k === 'Numpad4') this.tab = 3;
    else if (k === 'ArrowUp') this.sel[key] = Math.max(0, this.sel[key] - 1);
    else if (k === 'ArrowDown') this.sel[key] = Math.min(Math.max(0, this.rows().length - 1), this.sel[key] + 1);
    else if (k === 'KeyX') {
      const r = key === 'tasks' ? this.rows()[this.sel[key]] : null;
      if (key === 'tasks') { if (r?.kind === 'active' && r.job) { this.missions.abandon(r.job); this.msg = `Abandoned: ${this.missions.abandonPenalty(r.job)}`; } }
      else if (this.ctx.state.job) { this.missions.abandon(); this.msg = 'Job abandoned'; }
    }
    else if (k === 'KeyD' && key === 'courier') {
      const r = this.rows()[this.sel[key]];
      if (r) this.careers.courier.decline(r.id);
    } else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.act();
    this.render();
  }

  act() {
    const key = TABS[this.tab], r = this.rows()[this.sel[key]], c = this.careers;
    if (!r) return;
    let res = { ok: true };
    if (r.kind === 'active') { if (r.job) { this.missions.track(r.job); this.msg = `Tracking: ${r.job.short || r.job.title}`; } return; }
    if (r.kind === 'near') res = this.missions.board.acceptEntry(r.entry);
    else if (r.kind === 'offer') res = c.courier.accept(r.id);
    else if (r.kind === 'signup') { c[key].signUp(); this.msg = 'Signed up'; return; }
    else if (r.kind === 'start') res = c.taxi.startShift();
    else if (r.kind === 'route') res = c.bus.startShift(r.idx);
    else if (r.kind === 'end') { if (key === 'taxi') c.taxi.endShift(); else c.bus.endShift(); this.msg = 'Shift ending'; return; }
    if (!res.ok) { this.msg = res.reason; return; }
    this.close(); // started: back to the game
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.scene.resume('Game');
    bus.emit(EV.OVERLAY_CLOSED, {});
    this.scene.stop();
  }
}
