// Tasks test: street gigs, active list with tracking, city events, quick challenges, HUD stack, map and persistence.
// Usage: node scripts/tasks-test.mjs http://127.0.0.1:4173/ [shotsDir]      (use `npm run preview` after `npm run build`)
// Realistic game (all options off). Asserts the behaviour in ARCHITECTURE.md "Tasks: gigs, events, challenges" and takes screenshots.
// Exits non-zero on any failed assertion or console error.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const shots = process.argv[3] || 'screenshots/tasks';
mkdirSync(shots, { recursive: true });
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const root of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).sort().reverse()) for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome']) {
      const p = join(root, d, rel); if (existsSync(p)) return p;
    }
  }
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const press = async (k, ms = 80) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); await wait(250); };
const G = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: join(shots, n + '.png') });
let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 260) : ''}`); };

const tp = (x, y) => G(([x, y]) => { const p = window.__game.scene.getScene('Game').player; if (p.vehicle) { p.vehicle.x = x; p.vehicle.y = y; p.vehicle.vx = 0; p.vehicle.vy = 0; } else { p.x = x; p.y = y; } }, [x, y]);
const M = () => '(() => window.__game.scene.getScene("Game").ctx.systems.missions)()';
const jobsInfo = () => G(() => {
  const m = window.__game.scene.getScene('Game').ctx.systems.missions;
  return { n: m.jobs.length, ids: m.jobs.map((j) => j.id), kinds: m.jobs.map((j) => j.kind), tracked: m.trackedId, state: m.ctx.state.job?.id || null, offer: !!m.offer };
});
const money = () => G(() => window.__game.scene.getScene('Game').ctx.state.money);

/** Walk every stage of a job (teleport + wait) until it leaves the list. Returns { done, stages }. */
async function finishJob(id) {
  let steps = 0;
  for (let i = 0; i < 16; i++) {
    const s = await G((id) => {
      const m = window.__game.scene.getScene('Game').ctx.systems.missions;
      const j = m.jobs.find((q) => q.id === id);
      if (!j) return null;
      const st = j.stages[j.stageIndex];
      return { x: st.x, y: st.y, action: st.action, wait: (st.loadTime || 1.5) };
    }, id);
    if (!s) return { done: true, steps };
    if (s.x == null) return { done: false, steps, why: s.action };
    await tp(s.x, s.y);
    await wait(Math.round(s.wait * 1000) + 900);
    steps++;
  }
  return { done: false, steps };
}

// ---------------------------------------------------------------- new game
await page.goto(url); await wait(1500);
await press('Enter'); await wait(600);
await press('Enter'); await wait(700);
for (let i = 0; i < 3; i++) await press('ArrowDown', 60);
await press('Enter');
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
await wait(5000);
await G(() => { window.__fails = []; window.__done = []; window.__bus.on('job:failed', (e) => window.__fails.push({ id: e.job.id, reason: e.reason })); window.__bus.on('job:completed', (e) => window.__done.push({ id: e.job.id, payout: e.payout })); });

// ---------------------------------------------------------------- 1. gigs around the player
const near = await G(() => {
  const g = window.__game.scene.getScene('Game'), b = g.ctx.systems.missions.board, pl = g.player;
  const ds = b.gigs.map((q) => Math.hypot(q.x - pl.px, q.y - pl.py) / 8);
  const pins = b.pins();
  return { n600: ds.filter((d) => d <= 600).length, closest: Math.min(...ds), total: b.gigs.length, pinsGig: pins.filter((p) => p.type === 'gig').length, tpls: [...new Set(b.gigs.map((q) => q.tpl))], money: g.ctx.state.money };
});
check('gigs: 3-6 within 600 m of the player (burst can add 1)', near.n600 >= 3 && near.n600 <= 7, near);
check('gigs: at least one within 250 m (about 30 s of riding)', near.closest <= 250, near.closest);
check('gigs: every gig has a pin (minimap, map, world)', near.pinsGig === near.total, near);
const tplCount = await G(() => { const b = window.__game.scene.getScene('Game').ctx.systems.missions.board; const seen = new Set(); for (let i = 0; i < 60; i++) { const q = b.forceGig(undefined, { quiet: true }); if (q) seen.add(q.tpl); } b.gigs.length = 0; return [...seen]; });
check('gig templates: at least 6 different templates spawn near home (10+ exist)', tplCount.length >= 6, tplCount);
await wait(2500); // the board refills near the player after the clear above

// ---------------------------------------------------------------- 2. accept 3-4 tasks at once
// (a) a real gig through the E offer card
const g0 = await G(() => { const g = window.__game.scene.getScene('Game'), b = g.ctx.systems.missions.board, pl = g.player; const q = b.gigs.slice().sort((a, c) => Math.hypot(a.x - pl.px, a.y - pl.py) - Math.hypot(c.x - pl.px, c.y - pl.py))[0]; return q && { id: q.id, x: q.x, y: q.y, title: q.job.title }; });
await tp(g0.x + 30, g0.y);
await wait(500);
const prompt = await G(() => window.__game.scene.getScene('HUD').promptText.text);
check('walk up to a gig pin: HUD prompt "[E] ..."', /^\[E\]/.test(prompt), prompt);
await press('e', 90); await wait(500);
const offer = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; return m.offer && { gig: m.offer.gig?.id, title: m.offer.job.title }; });
check('E at a gig pin shows its offer card', offer && offer.gig === g0.id, offer);
await shot('01-gig-offer-card');
await press('y', 90); await wait(500);
let ji = await jobsInfo();
check('Y accepts the gig: 1 active job of kind gig, tracked', ji.n === 1 && ji.kinds[0] === 'gig' && ji.tracked === g0.id && ji.state === g0.id, ji);
// (b) a courier order from the job app list (programmatic accept of the first offer)
const co = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, c = m.careers.courier; const r = c.accept(c.offers[0].id); return { r, ids: m.jobs.map((j) => j.id) }; });
check('courier order accepted while a gig is active', co.r.ok && co.ids.length === 2, co);
// (c) a challenge (five deliveries, no fines) and (d) another gig
const ch = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; const c = b.forceChallenge('five'); const r = b.acceptChallenge(c.id); return { r, jobs: m.jobs.length, tracked: m.trackedId }; });
check('challenge accepted (passive: does not steal the tracking)', ch.r.ok && ch.jobs === 3 && ch.tracked !== null, ch);
const g1 = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; const q = b.gigs[0]; const r = b.acceptGig(q.id); return { r, jobs: m.jobs.length, id: q.id }; });
check('4th task accepted (4/4 slots)', g1.r.ok && g1.jobs === 4, g1);
const full = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; const q = b.gigs[0]; return q ? b.acceptGig(q.id) : { ok: false, reason: 'no gig left' }; });
check('a 5th task is refused: "Task list full"', !full.ok && /full/i.test(full.reason), full);
ji = await jobsInfo();
await wait(600);
await shot('02-hud-4-tasks');

// ---------------------------------------------------------------- 3. tracking follows arrow + card + target
const trk = [];
for (let i = 0; i < ji.n; i++) {
  const t = await G(() => {
    const g = window.__game.scene.getScene('Game'), m = g.ctx.systems.missions, hud = window.__game.scene.getScene('HUD');
    const j = m.job, s = j.stages[j.stageIndex], tpnt = m.targetPoint();
    const arrow = m.markers.arrow;
    const pl = g.player;
    const ang = Math.atan2(s.y - pl.py, s.x - pl.px);
    const d = Math.hypot(s.x - pl.px, s.y - pl.py);
    return { id: j.id, kind: j.kind, target: tpnt && s.x != null ? Math.hypot(tpnt.x - s.x, tpnt.y - s.y) < 2 : tpnt === null && s.x == null, card: hud.cardDest.text, stage: s.action === 'count' ? `${s.name} ${s.count || 0}/${s.goal}` : s.name, cardHead: hud.cardHead.text, arrowOk: s.x == null ? true : d < 260 ? !arrow.visible : arrow.visible && Math.abs(Math.atan2(Math.sin(arrow.rotation - ang), Math.cos(arrow.rotation - ang))) < 0.05 };
  });
  trk.push(t);
  await press('Tab', 90); await wait(300);
}
check('Tab cycles the tracked task through all 4 and wraps', new Set(trk.map((t) => t.id)).size === ji.n && (await jobsInfo()).tracked === trk[0].id, trk.map((t) => t.id));
check('tracked task: targetPoint() = its stage, HUD card shows its stage name', trk.every((t) => t.target && t.card === t.stage), trk.map((t) => [t.kind, t.target, t.card, t.stage]));
check('tracked task: waypoint arrow points at its target', trk.every((t) => t.arrowOk), trk.map((t) => t.arrowOk));
check('HUD card head shows "n/4" position when several tasks are active', trk.every((t) => /\d\/4/.test(t.cardHead)), trk.map((t) => t.cardHead));

// ---------------------------------------------------------------- 4. HUD stack matches state
const hud = await G(() => {
  const m = window.__game.scene.getScene('Game').ctx.systems.missions, h = window.__game.scene.getScene('HUD');
  const list = m.taskList();
  const rows = h.tkRows.filter((r) => r.name.visible).map((r) => ({ name: r.name.text, dist: r.dist.text, time: r.time.text }));
  return { list: list.map((t) => ({ short: t.short, tracked: t.tracked, timer: t.timeLeft != null })), rows, head: h.tkHead.text };
});
check('HUD stack: one row per active task (+ events), same order and names', hud.rows.length >= hud.list.length && hud.list.every((t, i) => t.short.startsWith(hud.rows[i].name.replace('…', '')) && hud.rows[i].name.length >= 8), hud);
check('HUD stack: header counts slots "4/4"', /4\/4/.test(hud.head), hud.head);
check('HUD stack: rows with a target show a distance, timed tasks a countdown', hud.list.every((t, i) => !t.timer || /\d:\d\d/.test(hud.rows[i].time)), hud.rows);

// ---------------------------------------------------------------- 5. shared capacity (on foot = 1)
const cap = await G(() => {
  const g = window.__game.scene.getScene('Game'), m = g.ctx.systems.missions, pl = g.player;
  const mk = (id, x, y, x2, y2) => ({ id, kind: 'gig', task: 'gig', tpl: 'test', title: id, short: id, blurb: 't', legal: true, level: 1, state: 'offered', stageIndex: 0, timeLeft: null, timeLimit: 300, timerFrom: 0, timerTo: 2, reward: 50, lq: 0, metres: 100, cargo: { size: 1, fragile: false, name: id }, damage: 0, loaded: false, fixed: true, persist: true, stages: [{ action: 'pickup', x, y, name: id + ' pickup', radius: 80, loadTime: 1.5, requires: { capacity: 1 } }, { action: 'dropoff', x: x2, y: y2, name: id + ' drop', radius: 90 }] });
  // free the slots: abandon everything first
  for (const j of m.jobs.slice()) m.abandon(j);
  const ax = pl.px, ay = pl.py;
  window.__capA = mk('capA', ax + 60, ay, ax + 400, ay);
  window.__capB = mk('capB', ax - 60, ay, ax - 400, ay);
  m.addJob(window.__capA); m.addJob(window.__capB);
  return { jobs: m.jobs.length, a: [ax + 60, ay], b: [ax - 60, ay] };
});
await tp(cap.a[0], cap.a[1]); await wait(2500);
let c1 = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; return { aLoaded: window.__capA.loaded, used: m.capacityUsed(), capacity: window.__game.scene.getScene('Game').player.capacity }; });
await tp(cap.b[0], cap.b[1]); await wait(2800);
let c2 = await G(() => ({ bLoaded: window.__capB.loaded, aLoaded: window.__capA.loaded }));
check('capacity is shared: on foot (capacity 1) parcel A loads, parcel B cannot load on top', c1.aLoaded && c1.used === 1 && !c2.bLoaded, { c1, c2 });
await finishJob('capA'); await wait(300);
await tp(cap.b[0], cap.b[1]); await wait(2500);
const c3 = await G(() => ({ bLoaded: window.__capB.loaded, aGone: !window.__game.scene.getScene('Game').ctx.systems.missions.jobs.some((j) => j.id === 'capA') }));
check('after delivering A the freed capacity lets B load (either order works)', c3.aGone && c3.bLoaded, c3);
await finishJob('capB');

// ---------------------------------------------------------------- 6. real gig + courier order + challenge counter, in either order
await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; for (const j of m.jobs.slice()) m.abandon(j); });
await wait(300);
const set = await G(() => {
  const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board, c = m.careers.courier;
  const gg = b.forceGig('jumpstart', { quiet: true });
  const rg = b.acceptGig(gg.id);
  const rc = c.accept(c.offers[0].id);
  const ch = b.forceChallenge('five'); b.acceptChallenge(ch.id);
  return { gig: gg.id, courier: m.jobs.find((j) => j.career === 'courier')?.id, five: m.jobs.find((j) => j.tpl === 'five')?.id, ok: rg.ok && rc.ok, n: m.jobs.length };
});
check('gig + courier order + challenge accepted together', set.ok && set.n === 3, set);
const m0 = await money();
const cres = await finishJob(set.courier);
await wait(400);
const afterC = await G((ids) => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; const five = m.jobs.find((j) => j.id === ids.five); return { ids: m.jobs.map((j) => j.id), count: five?.stages[0].count, tracked: m.trackedId, done: window.__done.map((d) => d.id) }; }, set);
check('courier order delivered first: paid, the gig and the challenge stay active', cres.done && afterC.ids.includes(set.gig) && afterC.ids.includes(set.five) && !afterC.ids.includes(set.courier) && (await money()) > m0, { cres, afterC });
check('challenge "5 deliveries" counted the delivery (1/5)', afterC.count === 1, afterC);
check('tracking moved to a remaining task after the tracked one ended', afterC.tracked !== set.courier && afterC.ids.includes(afterC.tracked), afterC);
const m1 = await money();
const gres = await finishJob(set.gig);
await wait(300);
check('gig completed second: paid (fixed 40-200 kr)', gres.done && (await money()) - m1 >= 30 && (await money()) - m1 <= 260, { delta: (await money()) - m1 });

// ---------------------------------------------------------------- 7. a countdown expiry fails only that task
const exp = await G(() => {
  const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board;
  const a = b.forceGig('puncture', { quiet: true }), c2 = b.forceGig('jumpstart', { quiet: true });
  b.acceptGig(a.id); b.acceptGig(c2.id);
  const ids = m.jobs.map((j) => j.id);
  m.jobs.find((j) => j.id === a.id).timeLeft = 0.3;
  window.__fails.length = 0;
  return { a: a.id, b: c2.id, ids };
});
await wait(1200);
const exp2 = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; return { ids: m.jobs.map((j) => j.id), fails: window.__fails.slice() }; });
check('countdown expiry fails only that task ("out of time"), the others stay', exp2.fails.length === 1 && exp2.fails[0].id === exp.a && /time/.test(exp2.fails[0].reason) && exp2.ids.includes(exp.b) && !exp2.ids.includes(exp.a) && exp2.ids.includes(exp.ids.find((i) => i.startsWith('ch'))), { exp, exp2 });

// ---------------------------------------------------------------- 8. challenges
const rh = await G(() => { const l = window.__game.scene.getScene('Game').world.landmark('radhus'); return { x: l.x, y: l.y }; });
await tp(rh.x - 400, rh.y); await wait(2500);
const chRes = await G(() => {
  const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board, out = {};
  for (const j of m.jobs.slice()) m.abandon(j);
  window.__done.length = 0; window.__fails.length = 0;
  // fine fails "5 deliveries"
  let c = b.forceChallenge('five'); b.acceptChallenge(c.id);
  window.__bus.emit('police:ticket', { type: 'speeding', fine: 100, clips: 0, label: 'test', source: 'auto' });
  out.fineFailed = window.__fails.some((f) => f.reason === 'fined') && !m.jobs.some((j) => j.tpl === 'five');
  // no red lights: survives its timer; a red light fails it
  c = b.forceChallenge('clean'); b.acceptChallenge(c.id);
  window.__bus.emit('police:ticket', { type: 'speeding', fine: 100, clips: 0, label: 'test', source: 'auto' });
  out.speedingOk = m.jobs.some((j) => j.tpl === 'clean');
  m.jobs.find((j) => j.tpl === 'clean').timeLeft = 0.2;
  out.cleanId = m.jobs.find((j) => j.tpl === 'clean').id;
  return out;
});
await wait(1000);
const chRes2 = await G((id) => ({ done: window.__done.find((d) => d.id === id) || null }), chRes.cleanId);
check('challenge "no red lights": other fines do not fail it, surviving the timer pays', chRes.speedingOk && chRes2.done && chRes2.done.payout > 0, { chRes, chRes2 });
check('challenge "5 deliveries, no fines": any fine fails it', chRes.fineFailed, chRes);
const reach = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; const c = b.forceChallenge('reach'); if (!c) return null; b.acceptChallenge(c.id); const j = m.jobs[0]; return { id: j.id, lim: j.timeLimit, title: j.title, x: j.stages[0].x, y: j.stages[0].y }; });
const lq0 = await G(() => window.__game.scene.getScene('Game').ctx.state.lq);
const m2 = await money();
if (reach) { await tp(reach.x, reach.y); await wait(900); }
const lq1 = await G(() => window.__game.scene.getScene('Game').ctx.state.lq);
check('challenge "get to <landmark> in N s" completes: cash and LQ', !!reach && (await money()) > m2 && lq1 > lq0, { reach, dm: (await money()) - m2, dlq: lq1 - lq0 });
const fred = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; for (const q of m.jobs.slice()) m.abandon(q); const c = b.forceChallenge('fred'); b.acceptChallenge(c.id); const j = m.jobs.find((q) => q.tpl === 'fred'); for (let i = 0; i < 3; i++) m.progress(j); return { left: m.jobs.length, done: window.__done.some((d) => d.id === j.id) }; });
check('challenge counter (3 orders in Frederiksbjerg) completes at the goal', fred.left === 0 && fred.done, fred);
const rg = await G(() => { const l = window.__game.scene.getScene('Game').world.landmark('ringgaden'); return { x: l.x, y: l.y }; });
await tp(rg.x, rg.y); await wait(1500);
const ring = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; const c = b.forceChallenge('ring'); if (!c) return null; b.acceptChallenge(c.id); return { id: c.id, stages: c.job.stages.length, limit: c.job.timeLimit, first: c.job.stages[0].name }; });
check('challenge "ride the Ringgaden" builds a 5-checkpoint chain with a timer', ring && ring.stages === 5 && ring.limit > 60, ring);
const mr = await money();
const rres = ring ? await finishJob(ring.id) : { done: false };
check('Ringgaden: visiting the checkpoints in order completes it and pays 150 kr', rres.done && (await money()) - mr >= 120, { rres, delta: (await money()) - mr });

// ---------------------------------------------------------------- 9. city events
await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; for (const j of m.jobs.slice()) m.abandon(j); b.events.length = 0; b.gigs.length = 0; });
// schedule awareness: Monday 10:00 -> no concert, match or bar rush; Friday 22:00 -> bar rush and concert but no match
const sched = await G(async () => {
  const g = window.__game.scene.getScene('Game'), m = g.ctx.systems.missions, b = m.board, st = g.ctx.state;
  const run = async (day, hour) => {
    b.events.length = 0; st.tasks.cd = {};
    st.economy.clock = day * 1440 + hour * 60;
    b.chanceMul = 1e5; // every eligible rule starts at the next checks (no Math.random stub: Phaser's UUIDs use it)
    await new Promise((r) => setTimeout(r, 11500));
    b.chanceMul = 1;
    const kinds = b.events.map((e) => e.kind);
    return kinds;
  };
  return { mon: await run(14, 10), fri: await run(18, 22) }; // day 14 = Monday, day 18 = Friday
});
check('event schedule: Monday 10:00 has no concert/match/bar rush', !sched.mon.some((k) => ['concert', 'match', 'barRush'].includes(k)), sched);
check('event schedule: Friday 22:00 starts the bar rush and a concert, no AGF match', sched.fri.includes('barRush') && sched.fri.includes('concert') && !sched.fri.includes('match'), sched);
await G(() => { const b = window.__game.scene.getScene('Game').ctx.systems.missions.board; b.events.length = 0; window.__game.scene.getScene('Game').ctx.state.tasks.cd = {}; });
const ev = await G(() => {
  const g = window.__game.scene.getScene('Game'), m = g.ctx.systems.missions, b = m.board, c = m.careers.courier, pl = g.player;
  const e = b.startEvent('concert');
  // put the player next to the area so the stack/minimap show it and gigs spawn inside
  return { id: e.id, name: e.name, x: e.x, y: e.y, r: e.r, pay: e.pay, surge: e.surge, at: !!b.eventAt(e.x, e.y), outside: b.eventAt(e.x + e.r + 400, e.y) === null };
});
await wait(700);
await shot('03-event-announcement');
const banner = await G(() => { const h = window.__game.scene.getScene('HUD'); return { vis: h.banner.visible, title: h.bannerTitle.text }; });
check('event announcement: HUD banner "EVENT: ..." and pager line', banner.vis && /EVENT/.test(banner.title), banner);
check('event covers its area only (eventAt) with +30-60% pay and taxi surge', ev.at && ev.outside && ev.pay >= 0.3 && ev.pay <= 0.6 && ev.surge >= 1.3, ev);
await G(() => { const g = window.__game.scene.getScene('Game'), e = g.ctx.systems.missions.board.events[0]; g.player.x = e.x + 200; g.player.y = e.y; });
await wait(800);
const boost = await G((e) => {
  const g = window.__game.scene.getScene('Game'), m = g.ctx.systems.missions, b = m.board, c = m.careers.courier;
  let gig = null, o = null;
  for (let i = 0; i < 8 && !gig; i++) gig = b.spawnGig({ event: b.events[0], quiet: true });
  for (let i = 0; i < 8 && !o; i++) o = c._gen(b.events[0]);
  const base = o ? c.rewardFor(o.metres, o.size, o.fragile) : 0;
  return { gigEvent: gig?.job.event, gigPay: gig?.job.eventPay, offerEvent: o?.event, offerReward: o?.reward, base, ratio: o ? o.reward / base : 0 };
}, ev);
check('gigs and courier offers inside the event area carry the boost', boost.gigEvent === ev.name && boost.offerEvent === ev.name && Math.abs(boost.ratio - (1 + ev.pay)) < 0.02, boost);
// shifts are exclusive; taxi fares inside an event area get surge pricing
const shift = await G(() => {
  const g = window.__game.scene.getScene('Game'), m = g.ctx.systems.missions, b = m.board, c = m.careers;
  const gg = b.forceGig('jumpstart', { quiet: true }); b.acceptGig(gg.id);
  c.taxi.signUp();
  const r1 = c.taxi.startShift();
  m.abandon(m.jobs.find((j) => j.id === gg.id));
  const r2 = c.taxi.startShift();
  const other = b.forceGig('puncture', { quiet: true });
  const r3 = b.acceptGig(other.id);
  let job = null;
  for (let i = 0; i < 25 && !(job && job.surge > 1); i++) { m.offer = null; c.taxi._hail(); job = m.offer?.job; }
  const out = { blockedStart: r1.ok === false && /orders and gigs/.test(r1.reason), started: r2.ok, blockedGig: r3.ok === false && /shift/.test(r3.reason), surge: job?.surge, title: job?.title, reward: job?.reward, event: job?.event };
  m.offer = null;
  c.abortShift('test');
  return out;
});
check('shifts are exclusive: no shift with gigs active, no gig during a shift', shift.blockedStart && shift.started && shift.blockedGig, shift);
check('taxi hails inside the event area use surge pricing (x1.5 concert)', shift.surge > 1.3 && /x1\./.test(shift.title) && shift.event, shift);
// map with pins and the event area
await G(() => { const g = window.__game.scene.getScene('Game'), pl = g.player, b = g.ctx.systems.missions.board; const e = b.events[0]; pl.x = e.x + 300; pl.y = e.y; for (let i = 0; i < 4; i++) b.spawnGig({ event: e, quiet: true }); });
await wait(1500);
await shot('04-world-event-area');
await press('m'); await wait(900);
const mapInfo = await G(() => { const o = window.__game.scene.getScene('Overlay'); return { mode: o.mode, pins: o._pins?.length, types: [...new Set((o._pins || []).map((p) => p.type))] }; });
check('full map lists task pins (several types) and has the event area', mapInfo.mode === 'map' && mapInfo.pins >= 4, mapInfo);
await press('ArrowDown'); await press('ArrowDown'); await wait(300);
await shot('05-map-pins-event');
const sel = await G(() => window.__game.scene.getScene('Overlay').sel);
check('map: Up/Down moves the pin selection', sel >= 1, sel);
// accept the selected available pin from the map with Enter
const mapAcc = await G(() => { const o = window.__game.scene.getScene('Overlay'); const i = (o._pins || []).findIndex((p) => !p.active && p.type === 'gig'); o.sel = i; o._render(); return i; });
await press('Enter'); await wait(500);
const mapAcc2 = await jobsInfo();
check('map: Enter on a gig pin accepts it (and tracks it)', mapAcc >= 0 && mapAcc2.n === 1 && mapAcc2.kinds[0] === 'gig', { mapAcc, mapAcc2 });
await press('Escape'); await wait(500);
// rain
const rain = await G(() => { const b = window.__game.scene.getScene('Game').ctx.systems.missions.board; b.startEvent('rain'); return { raining: b.isRaining(), anywhere: !!b.eventAt(1, 1) }; });
check('rain: citywide event (eventAt everywhere) and slippery roads flag', rain.raining && rain.anywhere, rain);
// events end on the clock
const endv = await G(async () => { const g = window.__game.scene.getScene('Game'), b = g.ctx.systems.missions.board; g.ctx.state.economy.clock += 600; await new Promise((r) => setTimeout(r, 4500)); return b.events.map((e) => e.kind); });
check('events end when their game-clock window is over', endv.length === 0, endv);

// ---------------------------------------------------------------- 10. job app Tasks tab
await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board; for (const j of m.jobs.slice()) m.abandon(j); b.startEvent('match'); for (let i = 0; i < 3; i++) { const q = b.gigs[i]; if (q) b.acceptGig(q.id); } const c = b.forceChallenge('reach'); if (c) b.acceptChallenge(c.id); });
await wait(500);
await press('j'); await wait(500); await press('4'); await wait(500);
await shot('06-tasks-tab');
const tab = await G(() => { const j = window.__game.scene.getScene('JobApp'); const rows = j.rows(); return { tab: j.tab, active: rows.filter((r) => r.kind === 'active').length, near: rows.filter((r) => r.kind === 'near').length, types: [...new Set(rows.filter((r) => r.kind === 'near').map((r) => r.type))] }; });
check('Tasks tab: active list + Nearby list (gigs, offers, stands, events...)', tab.tab === 3 && tab.active >= 3 && tab.near >= 3, tab);
await press('ArrowDown'); await press('Enter'); await wait(300);
const trackSel = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; const j = window.__game.scene.getScene('JobApp'); return { tracked: m.trackedId, row: j.rows()[j.sel.tasks]?.id }; });
check('Tasks tab: Enter on an active row tracks it', trackSel.tracked === trackSel.row, trackSel);
await press('x'); await wait(300);
const abn = await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.jobs.length);
check('Tasks tab: X abandons the selected active task', abn === 3 || abn === 2, abn);
await press('Escape'); await wait(500);

// ---------------------------------------------------------------- 10b. coverage: something to do within about 30 s of riding, everywhere
await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; for (const j of m.jobs.slice()) m.abandon(j); });
const cov = [];
for (let k = 0; k < 6; k++) {
  await G(() => { const g = window.__game.scene.getScene('Game'), d = g.world.drive; const n = Math.floor(Math.random() * d.count); g.player.x = d.x[n]; g.player.y = d.y[n]; });
  await wait(5500);
  cov.push(await G(() => { const g = window.__game.scene.getScene('Game'), b = g.ctx.systems.missions.board, pl = g.player; const ds = b.gigs.map((q) => Math.hypot(q.x - pl.px, q.y - pl.py) / 8); return { closest: Math.round(Math.min(...ds, 9999)), n600: ds.filter((d) => d <= 600).length }; }));
}
check('coverage: 6 random places, after 5 s a gig within 250 m (7.5 m/s x 30 s = 225 m) in at least 5', cov.filter((c) => c.closest <= 250).length >= 5, cov);
check('coverage: 3-6 gigs within 600 m in at least 5 of 6 places', cov.filter((c) => c.n600 >= 3 && c.n600 <= 6).length >= 5, cov);

// ---------------------------------------------------------------- 11. persistence
await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions, b = m.board, c = m.careers.courier; for (const j of m.jobs.slice()) m.abandon(j); b.forceGig(undefined, { quiet: true }); b.forceGig('jumpstart', { quiet: true }); for (const q of b.gigs.slice(-2)) b.acceptGig(q.id); if (c.offers[0]) c.accept(c.offers[0].id); const ch = b.forceChallenge('clean'); b.acceptChallenge(ch.id); m.cycleTrack(1); });
await wait(1500);
await G(() => { const g = window.__game.scene.getScene('Game'); g.ctx.systems.missions._saveTasks(); g.save(); });
const before = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; return { ids: m.jobs.map((j) => j.id), tracked: m.trackedId, left: m.jobs.map((j) => Math.round(j.timeLeft ?? -1)) }; });
await page.goto(url); await wait(1500);
await press('Enter'); await wait(600);
await press('Enter'); await wait(900);
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
await wait(2500);
const after = await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; return { ids: m.jobs.map((j) => j.id), tracked: m.trackedId, left: m.jobs.map((j) => Math.round(j.timeLeft ?? -1)), card: window.__game.scene.getScene('HUD').cardHead.text }; });
check('save/reload keeps the active gigs/challenges, their timers and the tracked task', before.ids.length >= 2 && JSON.stringify(after.ids) === JSON.stringify(before.ids) && after.tracked === before.tracked, { before, after });
check('after reload the timers resumed (not reset)', after.left.every((v, i) => before.left[i] === -1 || v <= before.left[i]), { before: before.left, after: after.left });

// ---------------------------------------------------------------- 11b. comfort options (cheats)
const cheat = await G(() => {
  const g = window.__game.scene.getScene('Game'), st = g.ctx.state, eco = g.ctx.systems.economy, fleet = eco.fleet;
  st.options.infiniteMoney = true; st.money = 300;
  eco.pay(-1, 'test');
  const m0 = st.money;
  let pick = null;
  for (const sh of fleet.getShops()) for (const t of sh.buy || []) if (!pick && t !== 'bike' && !st.ownedVehicles.includes(t)) pick = { shop: sh.id, type: t };
  const res = pick ? fleet.buy(pick.shop, pick.type) : { ok: false, reason: 'no shop sells a car here' };
  eco.pay(-5000, 'fine'); eco.pay(-300, 'tow');
  const out = { m0, m1: st.money, res, pick, owned: st.ownedVehicles.includes(pick?.type) };
  eco.pay(250, 'income');
  out.income = st.money;
  return out;
});
await wait(500);
const cheatHud = await G(() => ({ hud: window.__game.scene.getScene('HUD').moneyText.text }));
check('infiniteMoney: buying a car succeeds, fines and tows do not lower money, balance unchanged', cheat.res.ok && cheat.m1 === cheat.m0 && cheat.m0 >= 9e8 && cheat.owned, cheat);
check('infiniteMoney: HUD shows the infinity sign', /\u221e/.test(cheatHud.hud), cheatHud);
const ban = await G(() => {
  const g = window.__game.scene.getScene('Game'), st = g.ctx.state, pol = g.ctx.systems.police, eco = g.ctx.systems.economy;
  st.options.infiniteMoney = false; st.money = 5000;
  const ev = []; const f = (e) => ev.push(e.reason); window.__bus.on('police:licence', f);
  st.options.noDrivingBan = true; st.licence.clips = 0; st.licence.banLeft = 0;
  for (let i = 0; i < 4; i++) pol.trafficRules.addClips(1);
  const lic = pol.getLicence();
  const v = g.spawnVehicle('smallcar', g.player.px + 60, g.player.py, { owned: true });
  const ep = v.exitPoint(); g.player.x = ep.x; g.player.y = ep.y;
  g.player.tryEnter([v]);
  const entered = g.player.vehicle === v;
  if (entered) g.player.exitVehicle();
  const shop = eco.fleet.getShops().find((s) => (s.rent || []).includes('van'));
  const rent = shop ? eco.fleet.rent(shop.id, 'van', 1) : { ok: false, reason: 'no van shop' };
  window.__bus.off('police:licence', f);
  // sanity: with the option off 3 clips still ban
  st.options.noDrivingBan = false; st.licence.clips = 0; pol.trafficRules.addClips(3);
  const banned = pol.getLicence().banned;
  st.licence.banLeft = 0; st.licence.clips = 0;
  return { clips: lic.clips, banned: lic.banned, entered, rent, ev, sanityBanned: banned };
});
check('noDrivingBan: 4 clips recorded, no ban, can still enter a car and rent from the dealer, no ban event', ban.clips >= 4 && !ban.banned && ban.entered && ban.rent.ok && !ban.ev.includes('ban'), ban);
check('noDrivingBan off: 3 clips still start a ban', ban.sanityBanned === true, ban);

// ---------------------------------------------------------------- 12. performance and errors
await G(() => { const b = window.__game.scene.getScene('Game').ctx.systems.missions.board; b.startEvent('barRush'); });
await wait(4000);
const fps = await G(() => ({ fps: Math.round(window.__game.loop.actualFps), gigs: window.__game.scene.getScene('Game').ctx.systems.missions.board.gigs.length }));
check('fps >= 80 with gigs, pins, an event and 3-4 active tasks', fps.fps >= 80, fps);
check('no console errors', errors.length === 0, errors.slice(0, 5));
console.log(`SUMMARY ${pass}/${pass + fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
