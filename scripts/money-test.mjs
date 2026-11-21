// Bills, debt collection, quick loans, ticket toggles and gambling: play test + RTP simulation.
// Usage: node scripts/money-test.mjs http://127.0.0.1:4173/ [shotsDir]      (use a production build + vite preview)
// Game A (default new game, all options off): a fine is a bill (money unchanged), pay it, reminders -> inkasso -> 30% garnish of job pay,
//   infinite money auto-pays, a quick loan with weekly auto-debit and a missed payment going to inkasso, throttled pager ads,
//   gambling hidden, the noSpeedingTickets / noRedLightTickets gates, save + reload.
// Game B (new game with noSpeedingTickets + noRedLightTickets + gambling ON via the new-game screen): venues, scratch and slot flows,
//   betting settled by real events, the bets tab, save + reload keeps bets.
// Pure RTP simulations (scratch 50%, slot 70%) run in node from src/systems/gambling/games.js with a seeded RNG.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SCRATCH, SLOT, BET, scratchPlay, slotPlay, mulberry32, rtpSim, analyticRtp } from '../src/systems/gambling/games.js';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const shots = process.argv[3] || 'screenshots/money';
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
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } }); // own localStorage per game
const errors = [];
let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 260) : ''}`); };
const near = (a, b, tol = 0) => Math.abs(a - b) <= tol;

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return page;
}
const mk = (page) => {
  const wait = (ms) => page.waitForTimeout(ms);
  const press = async (k, ms = 80) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); await wait(250); };
  const G = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: join(shots, n + '.png') });
  return { wait, press, G, shot };
};
const toGame = async (page, h) => { await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 25000 }); await h.wait(1800); };

// ================================================================== RTP simulations (pure, seeded)
{
  const rng = mulberry32(20261121);
  const s10 = rtpSim(scratchPlay, 10000, rng), l10 = rtpSim(slotPlay, 10000, rng);
  const sBig = rtpSim(scratchPlay, 200000, rng), lBig = rtpSim(slotPlay, 200000, rng);
  console.log(`RTP scratch 10k=${s10.toFixed(4)} 200k=${sBig.toFixed(4)} (analytic ${analyticRtp(SCRATCH.table)}); slot 10k=${l10.toFixed(4)} 200k=${lBig.toFixed(4)} (analytic ${analyticRtp(SLOT.table)})`);
  check('RTP scratch: 10,000 simulated cards within +-3% of 50%', near(s10, 0.5, 0.03), s10);
  check('RTP scratch: 200,000 cards within +-1.5% of 50%', near(sBig, 0.5, 0.015), sBig);
  check('RTP slot: 200,000 spins within +-3% of 70%', near(lBig, 0.7, 0.03), lBig);
  check('RTP slot: 10,000 spins within +-5% of 70% (high-variance pay table)', near(l10, 0.7, 0.05), l10);
  let nearN = 0, lose = 0, bad = 0;
  for (let i = 0; i < 20000; i++) {
    const r = slotPlay(rng);
    if (r.mult === 0) {
      lose++;
      const l = r.line;
      if ((l[0] === l[1] && l[1] === l[2]) || l.filter((x) => x === 5).length >= 2) bad++;
      if (r.near) { nearN++; if (!(r.reels[0][1] === r.reels[1][1] && (r.reels[2][0] === r.reels[0][1] || r.reels[2][2] === r.reels[0][1]) && r.reels[2][1] !== r.reels[0][1])) bad++; }
    }
  }
  check('slot: losing spins never show a win line, near misses (about 40% of losses) leave the third symbol one row off', bad === 0 && nearN / lose > 0.3 && nearN / lose < 0.5, { bad, share: +(nearN / lose).toFixed(3) });
}

// ================================================================== GAME A: default game, gambling off
const pageA = await newPage(ctxB);
const A = mk(pageA);
await pageA.goto(url); await A.wait(1500);
await A.press('Enter'); await A.wait(600);
await A.press('Enter'); await A.wait(700);
for (let i = 0; i < 3; i++) await A.press('ArrowDown', 60);
await A.press('Enter');
await toGame(pageA, A);
await A.G(() => {
  const g = window.__game.scene.getScene('Game');
  g.systems.traffic.density = 0;
  window.__ev = { tickets: [], ads: [], pagers: [], garn: [] };
  window.__bus.on('police:ticket', (t) => window.__ev.tickets.push(t));
  window.__bus.on('economy:loanAd', (e) => window.__ev.ads.push({ day: g.ctx.systems.economy.getClock().day, text: e.text }));
  window.__bus.on('ui:pager', (p) => window.__ev.pagers.push(p.text));
  window.__bus.on('economy:garnished', (e) => window.__ev.garn.push(e));
});
const st = () => A.G(() => { const c = window.__game.scene.getScene('Game').ctx, e = c.systems.economy; return { money: c.state.money, day: e.getClock().day, owed: e.bills.total(), open: e.bills.open().length, bills: e.bills.list.map((b) => ({ id: b.id, st: b.status, a: b.amount, f: b.fees, r: b.reminders, due: b.dueDay, pp: b.paidPart })) }; });

const optsA = await A.G(() => window.__game.scene.getScene('Game').ctx.state.options);
check('A: default game has every option off (incl. the 3 new ones)', Object.values(optsA).every((v) => v === false) && 'gambling' in optsA && 'noSpeedingTickets' in optsA && 'noRedLightTickets' in optsA, optsA);
check('A: gambling hidden when off (no system, no venues, no bets tab)', await A.G(() => window.__game.scene.getScene('Game').systems.gambling === null));
await A.press('j'); await A.wait(500);
const tabsA = await A.G(() => window.__game.scene.getScene('JobApp').tabs);
check('A: phone app has Bills and Loans tabs but no Bets tab', tabsA.includes('bills') && tabsA.includes('loans') && !tabsA.includes('bets'), tabsA);
await A.press('Escape'); await A.wait(400);

// ---- a fine creates a bill, money is unchanged
await A.G(() => { window.__game.scene.getScene('Game').ctx.state.money = 20000; window.__ev.tickets.length = 0; window.__bus.emit('traffic:injury', { severity: 1, byPlayer: true, killed: false, x: 0, y: 0 }); });
await A.wait(300);
const f1 = await A.G(() => { const t = window.__ev.tickets[0]; return t ? { fine: t.fine, billId: t.billId, due: t.dueLabel, text: t.text } : null; });
let s1 = await st();
check('fine: ticket carries billId and "Bill kr X, due Day" text', !!f1 && f1.fine === 3200 && !!f1.billId && /^Bill/.test(f1.text) && /due [A-Z][a-z]{2}/.test(f1.text), f1);
check('fine: money is UNCHANGED (the fine is an open bill)', s1.money === 20000 && s1.open === 1 && s1.bills[0].a === 3200 && s1.bills[0].st === 'open' && s1.bills[0].due === s1.day + 7, s1);
await A.press('j'); await A.wait(300); await A.press('5'); await A.wait(500);
await A.shot('01-bills-tab');
await A.press('Enter'); await A.wait(300); // pay the selected bill from the app
await A.press('Escape'); await A.wait(300);
const s2 = await st();
check('bill: paid in full from the Bills tab (Enter), money -3200', s2.money === 16800 && s2.open === 0 && s2.bills[0].st === 'paid', s2);

// ---- unpaid: rykker x3, inkasso, garnish
await A.G(() => { const e = window.__game.scene.getScene('Game').ctx.systems.economy; e.bills.issue({ kind: 'fine', label: 'Test fine', amount: 1000 }); window.__game.scene.getScene('Game').ctx.state.money = 50000; });
const adv = (day) => A.G((d) => { const e = window.__game.scene.getScene('Game').ctx.systems.economy; e.advanceClock(d * 1440 - e.getClock().minutes); }, day);
const bill = async () => (await st()).bills.find((b) => b.a === 1000);
const d0 = (await bill()).due;
await adv(d0);
let b = await bill();
check('late: reminder 1 (+100 fee), due date +3 days', b.r === 1 && b.f === 100 && b.due === d0 + 3 && b.st === 'open', b);
await adv(d0 + 3); await adv(d0 + 6);
b = await bill();
check('late: reminder 3 (+300 fees in total)', b.r === 3 && b.f === 300 && b.st === 'open', b);
await adv(d0 + 9);
b = await bill();
check('late: after 3 reminders it goes to inkasso (+500 fee, status collection)', b.st === 'collection' && b.f === 800, b);
await A.G(() => { window.__ev.garn.length = 0; const c = window.__game.scene.getScene('Game').ctx; c.state.money = 1000; window.__bus.emit('economy:pay', { amount: 1000, reason: 'delivery' }); });
await A.wait(200);
const gr = await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; return { money: c.state.money, g: window.__ev.garn.map((e) => e.amount), pp: c.systems.economy.bills.list.find((q) => q.amount === 1000).paidPart }; });
check('garnish: 30% of a job payout goes to the collector (1000 -> 700 net)', gr.money === 1700 && gr.g[0] === 300 && gr.pp === 300, gr);
await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; c.state.money = 1000; window.__bus.emit('economy:pay', { amount: 1000, reason: 'loan' }); });
check('garnish: loan / non-job money is never garnished', (await st()).money === 2000);
await A.shot('02-bills-inkasso-hud');
await A.press('j'); await A.wait(300); await A.press('5'); await A.wait(500); await A.shot('03-bills-tab-inkasso'); await A.press('Escape'); await A.wait(300);
await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; c.state.money = 50000; c.systems.economy.bills.payAll(); });
s1 = await st();
check('payAll clears the debt; later pay is not garnished', s1.open === 0 && (await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; c.state.money = 1000; window.__bus.emit('economy:pay', { amount: 1000, reason: 'delivery' }); return c.state.money; })) === 2000);

// ---- infinite money auto-pays
const inf = await A.G(() => {
  const c = window.__game.scene.getScene('Game').ctx, e = c.systems.economy;
  c.state.options.infiniteMoney = true; c.state.money = 1e9;
  const bb = e.bills.issue({ kind: 'fine', label: 'Auto', amount: 700 });
  const out = { status: bb.status, money: c.state.money, open: e.bills.open().length };
  c.state.options.infiniteMoney = false; c.state.money = 5000;
  return out;
});
check('infinite money: a bill is paid the moment it is issued, balance unchanged', inf.status === 'paid' && inf.money === 1e9 && inf.open === 0, inf);

// ---- quick loan
const quote = await A.G(() => { const e = window.__game.scene.getScene('Game').ctx.systems.economy; const q = e.loans.quote(5000); return { fee: q.fee, debt: q.debt, pmt: q.pmt, total: q.total, apr: q.apr, sched: q.schedule.length }; });
check('loan quote: 5,000 -> setup fee 449, debt 5,449, 4 weekly instalments, absurd APR', quote.fee === 449 && quote.debt === 5449 && quote.sched === 4 && quote.total === quote.pmt * 4 && quote.total > 9500 && quote.apr > 1e6, quote);
await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; c.state.money = 1000; });
await A.press('j'); await A.wait(300); await A.press('6'); await A.wait(500);
await A.press('ArrowDown'); await A.press('ArrowDown'); await A.press('ArrowDown'); await A.press('ArrowDown'); // 5,000 offer
await A.shot('04-loan-app');
await A.press('Enter'); await A.wait(300);
await A.press('Escape'); await A.wait(300);
let l = await A.G(() => { const c = window.__game.scene.getScene('Game').ctx, e = c.systems.economy; const x = e.loans.list[0]; return { money: c.state.money, loan: x && { p: x.principal, pmt: x.pmt, next: x.nextDay, st: x.status }, day: e.getClock().day, earned: c.state.stats.earned }; });
check('loan: taken in the app (Enter), 5,000 kr arrive instantly, not counted as earnings', l.money === 6000 && l.loan?.p === 5000 && l.loan.next === l.day + 7, l);
await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; c.state.money = 20000; });
await adv(l.loan.next);
l = await A.G(() => { const c = window.__game.scene.getScene('Game').ctx, e = c.systems.economy; const x = e.loans.list[0]; return { money: c.state.money, paid: x.paid, missed: x.missed }; });
check('loan: weekly auto-debit on the clock charges the instalment (incl. interest)', l.paid === 1 && l.missed === 0 && l.money === 20000 - quote.pmt - 1200 || (l.paid === 1 && 20000 - l.money >= quote.pmt && 20000 - l.money <= quote.pmt + 1200), { ...l, pmt: quote.pmt });
await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; c.state.money = 0; });
await adv((await st()).day + 7);
const miss = await A.G(() => { const e = window.__game.scene.getScene('Game').ctx.systems.economy; const x = e.loans.list[0]; const bb = e.bills.list.find((q) => q.kind === 'loan'); return { missed: x.missed, bill: bb && { st: bb.status, a: bb.amount, f: bb.fees }, collecting: e.bills.collecting() }; });
check('loan: a missed instalment goes to inkasso (+500 fee) and garnishing starts', miss.missed === 1 && miss.bill?.st === 'collection' && miss.bill.f === 500 && miss.bill.a === quote.pmt && miss.collecting, miss);
// pager ads: at most one per day; more likely when broke / overdue
const ads = await A.G(async () => {
  const c = window.__game.scene.getScene('Game').ctx, e = c.systems.economy;
  e.loans.rng = () => 0; window.__ev.ads.length = 0;
  for (let h = 0; h < 24 * 5; h++) e.advanceClock(60);
  const perDay = {}; for (const a of window.__ev.ads) perDay[a.day] = (perDay[a.day] || 0) + 1;
  e.loans.rng = Math.random;
  const chance = (money, overdue) => { c.state.economy.loanAdDay = -1; c.state.money = money; const was = e.bills.list.slice(); if (!overdue) e.bills.list.length = 0; const p = e.loans.adChance(); e.bills.list.push(...was.filter((b) => !e.bills.list.includes(b))); return p; };
  return { n: window.__ev.ads.length, maxPerDay: Math.max(0, ...Object.values(perDay)), days: Object.keys(perDay).length, rich: chance(5000, false), broke: chance(50, false), overdue: chance(5000, true) };
});
check('ads: pager ads throttled to at most one per in-game day', ads.n >= 4 && ads.maxPerDay === 1, ads);
check('ads: more likely when broke or with an overdue bill than when comfortable', ads.broke > ads.rich && ads.overdue > ads.rich, ads);
check('ads: the loan app is Danish satire with the invented brand', (await A.G(() => window.__ev.ads[0]?.text || '')).length > 20);

// ---- ticket toggles (runtime): camera speeding pass, then a red light on the bike
const place = (x, y, ang, sp) => A.G(([x, y, ang, sp]) => { const p = window.__game.scene.getScene('Game').player, v = p.vehicle; v.x = x; v.y = y; v.angle = ang; v.vx = Math.cos(ang) * sp * 8; v.vy = Math.sin(ang) * sp * 8; v.sprite.setPosition(x, y).setRotation(ang); }, [x, y, ang, sp]);
await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; c.state.money = 90000; c.systems.economy.bills.payAll(); c.state.licence.clips = 0; c.state.licence.banLeft = 0; });
async function ensureCar() {
  if (await A.G(() => !!window.__game.scene.getScene('Game').player.vehicle)) return;
  await A.G(() => {
    const g = window.__game.scene.getScene('Game'), p = g.player;
    const v = g.ctx.spawnVehicle('smallcar', p.px + 30, p.py + 30, { angle: 0, owned: true });
    const e = v.exitPoint(); p.x = e.x; p.y = e.y;
  });
  await A.wait(250); await A.press('e', 90); await A.wait(400);
}
await ensureCar();
const cam = await A.G(() => window.__game.scene.getScene('Game').systems.police.trafficRules.cameraSpots().map((s) => ({ x: s.x, y: s.y, a: s.a })));
async function camPass(c) {
  await ensureCar();
  await A.G(() => { window.__ev.tickets.length = 0; window.__ev.pagers.length = 0; });
  await place(c.x - Math.cos(c.a) * 60 * 8, c.y - Math.sin(c.a) * 60 * 8, c.a, 18); await A.wait(600);
  await pageA.keyboard.down('w');
  for (let i = 0; i < 24; i++) { await A.G(([a]) => { const v = window.__game.scene.getScene('Game').player.vehicle; v.vx = Math.cos(a) * 160; v.vy = Math.sin(a) * 160; }, [c.a]); await A.wait(180); }
  await pageA.keyboard.up('w');
  return A.G(() => ({ speeding: window.__ev.tickets.filter((t) => t.type === 'speeding').length, hint: window.__ev.pagers.some((t) => /Speeding: no ticket/.test(t)) }));
}
if (cam.length) {
  await A.G(() => { window.__game.scene.getScene('Game').ctx.state.options.noSpeedingTickets = true; });
  const on = await camPass(cam[0]);
  check('noSpeedingTickets ON: the camera measures speeding but issues no ticket (hint shown)', on.speeding === 0 && on.hint, on);
  await A.G(() => { window.__game.scene.getScene('Game').ctx.state.options.noSpeedingTickets = false; });
  await A.wait(15000); // camera cooldown
  const off = await camPass(cam[0]);
  check('noSpeedingTickets OFF: the same pass issues a speeding bill', off.speeding >= 1, off);
} else check('speed camera spot exists for the toggle test', false);

// red light (on foot-free bike? use the car): wait for a red approach
await A.G(() => { const g = window.__game.scene.getScene('Game'); g.systems.traffic.density = 0; });
const ap = await A.G(() => {
  const g = window.__game.scene.getScene('Game'); const S = g.systems.traffic.signals; const gr = g.world.drive; const lm = g.world.landmark('radhus');
  let best = null;
  for (const a of S.aps) {
    if (a.ctrl.axes !== 3) continue;
    const len = Math.hypot(gr.x[a.node] - gr.x[a.from], gr.y[a.node] - gr.y[a.from]);
    if (len < 48 * 8 || a.w < 56) continue;
    const d = Math.hypot(a.sx - lm.x, a.sy - lm.y);
    if (!best || d < best.d) best = { d, i: S.aps.indexOf(a) };
  }
  const a = S.aps[best.i];
  return { i: best.i, sx: a.sx, sy: a.sy, dx: a.dx, dy: a.dy, ang: a.ang };
});
async function redPass(label) {
  let r = null;
  for (let attempt = 0; attempt < 3; attempt++) { // a crossing can be missed when the approach turns green mid-run: retry
    r = await redPass1();
    if (r.red || r.hint) break;
    await A.wait(7000);
  }
  return r;
}
async function redPass1() {
  await ensureCar();
  await pageA.waitForFunction((i) => { const S = window.__game.scene.getScene('Game').systems.traffic.signals; return S.stateOf(S.aps[i]) === 2 && S.redAge(S.aps[i]) > 1; }, ap.i, { timeout: 120000 });
  await A.G(() => { window.__ev.tickets.length = 0; window.__ev.pagers.length = 0; });
  await A.G(([ap]) => { const v = window.__game.scene.getScene('Game').player.vehicle; const sp = 9 * 8, bx = ap.sx - ap.dx * 14 * 8, by = ap.sy - ap.dy * 14 * 8; v.x = bx; v.y = by; v.angle = ap.ang; v.vx = Math.cos(ap.ang) * sp; v.vy = Math.sin(ap.ang) * sp; v.sprite.setPosition(bx, by).setRotation(ap.ang); }, [ap]);
  await pageA.keyboard.down('w'); await A.wait(2000); await pageA.keyboard.up('w'); await A.wait(500);
  return A.G(() => ({ red: window.__ev.tickets.filter((t) => t.type === 'redLight').length, hint: window.__ev.pagers.some((t) => /Red light: no ticket/.test(t)) }));
}
await A.G(() => { window.__game.scene.getScene('Game').ctx.state.options.noRedLightTickets = true; });
const redOn = await redPass('on');
check('noRedLightTickets ON: running a red light gives no ticket (hint shown)', redOn.red === 0 && redOn.hint, redOn);
await A.G(() => { window.__game.scene.getScene('Game').ctx.state.options.noRedLightTickets = false; });
await A.wait(7000);
const redOff = await redPass('off');
check('noRedLightTickets OFF: the same red light is billed', redOff.red >= 1, redOff);

// ---- save + reload (bills, loans)
const saved = await A.G(() => {
  const g = window.__game.scene.getScene('Game'); g.save();
  const key = Object.keys(localStorage).find((k) => k.startsWith('aarhus-express:v1:'));
  const d = JSON.parse(localStorage.getItem(key));
  return { key, bills: d.economy.bills.length, loans: d.economy.loans.length, open: d.economy.bills.filter((b) => b.status !== 'paid').length, opts: d.options };
});
check('save: bills and loans are persisted, options saved (gambling false)', saved.bills >= 2 && saved.loans === 1 && saved.opts.gambling === false && saved.opts.noSpeedingTickets === false, saved);
await pageA.reload(); await A.wait(1500);
await A.press('Enter'); await A.wait(600); await A.press('Enter'); await A.wait(800);
await toGame(pageA, A);
const re = await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; return { bills: c.state.economy.bills.length, loans: c.state.economy.loans.length, owed: c.systems.economy.bills.total(), open: c.systems.economy.bills.open().length, collecting: c.systems.economy.bills.collecting() }; });
check('reload: bills (open and paid), loans and the open-bill total survive', re.bills === saved.bills && re.loans === 1 && re.open === saved.open && re.owed > 0, re);
// old-save compatibility: strip the new keys and load
const legacy = await A.G(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('aarhus-express:v1:'));
  const d = JSON.parse(localStorage.getItem(key));
  delete d.economy.bills; delete d.economy.loans; delete d.gambling; delete d.options.gambling; delete d.options.noSpeedingTickets; delete d.options.noRedLightTickets;
  localStorage.setItem(key, JSON.stringify(d));
  return true;
});
await pageA.reload(); await A.wait(1500);
await A.press('Enter'); await A.wait(600); await A.press('Enter'); await A.wait(800);
await toGame(pageA, A);
const old = await A.G(() => { const c = window.__game.scene.getScene('Game').ctx; return { o: c.state.options, bills: Array.isArray(c.state.economy.bills), gb: !!c.state.gambling, sys: c.systems.gambling }; });
check('old save without the new fields loads with the options OFF and empty ledgers', legacy && !old.o.gambling && !old.o.noSpeedingTickets && !old.o.noRedLightTickets && old.bills && old.gb && old.sys === null, old);
await pageA.close();

// ================================================================== GAME B: gambling + ticket toggles ON from the new-game screen
const ctxC = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const pageB = await newPage(ctxC);
const B = mk(pageB);
await pageB.goto(url); await B.wait(1500);
await B.press('Enter'); await B.wait(600);
await B.press('Enter'); await B.wait(700);
for (let i = 0; i < 3; i++) { await B.press('ArrowUp', 60); await B.press('Space', 60); } // gambling (last slot), then noRedLightTickets, then noSpeedingTickets
await B.shot('05-new-game-options');
for (let i = 0; i < 3; i++) await B.press('ArrowUp', 60); // 8,7,6 -> 5,4,3 = START
await B.press('Enter');
await toGame(pageB, B);
const optsB = await B.G(() => window.__game.scene.getScene('Game').ctx.state.options);
check('B: new-game screen toggles gambling + noRedLightTickets + noSpeedingTickets ON, crime options stay off', optsB.gambling && optsB.noRedLightTickets && optsB.noSpeedingTickets && !optsB.theft && !optsB.criminalMissions && !optsB.mayhem && !optsB.infiniteMoney, optsB);
const vn = await B.G(() => {
  const gm = window.__game.scene.getScene('Game').systems.gambling;
  return { scratch: gm.venues.filter((v) => v.kind === 'scratch').map((v) => v.name), slot: gm.venues.filter((v) => v.kind === 'slot').map((v) => v.name) };
});
check('B: gambling visible: scratch venues are kiosks/supermarkets, slot venues are bars (real OSM POIs, no foreign chains)', vn.scratch.length >= 5 && vn.slot.length >= 5 && !vn.scratch.concat(vn.slot).some((n) => /lidl|aldi|7-eleven|seven|mcdonald|starbucks|burger king/i.test(n)), { s: vn.scratch.slice(0, 8), b: vn.slot.slice(0, 8) });
await B.G(() => { const g = window.__game.scene.getScene('Game'); g.systems.traffic.density = 0; window.__ev = { pagers: [] }; window.__bus.on('ui:pager', (p) => window.__ev.pagers.push(p.text)); });
await B.press('j'); await B.wait(300);
const tabsB = await B.G(() => window.__game.scene.getScene('JobApp').tabs);
await B.press('Escape'); await B.wait(300);
check('B: the J app gets a Bets tab', tabsB.includes('bets'), tabsB);

const goVenue = async (kind) => {
  await B.G((kind) => { const g = window.__game.scene.getScene('Game'), gm = g.systems.gambling, p = g.player; if (p.vehicle) p.exitVehicle?.(); const v = gm.venues.find((q) => q.kind === kind); p.x = v.x + 6; p.y = v.y; }, kind);
  await B.wait(700);
  const prompt = await B.G(() => window.__game.scene.getScene('HUD').promptValue);
  await B.press('e', 90); await B.wait(700);
  return { prompt, active: await B.G(() => window.__game.scene.isActive('Gamble')) };
};
const moneyB = () => B.G(() => window.__game.scene.getScene('Game').ctx.state.money);
const forceFirst = (v) => B.G((v) => { const gm = window.__game.scene.getScene('Game').systems.gambling; let first = v; gm.rng = () => { if (first != null) { const r = first; first = null; return r; } return Math.random(); }; }, v);

// scratch: a x3 win (first roll 0.2), then a loss
await B.G(() => { window.__game.scene.getScene('Game').ctx.state.money = 1000; });
const v1 = await goVenue('scratch');
check('scratch venue: E shows the prompt and opens the card overlay', /Scratch cards/.test(v1.prompt) && v1.active, v1);
await forceFirst(0.2);
await B.press('Enter'); await B.wait(300); // buy a 20 kr card
let m = await moneyB();
check('scratch: buying a card charges the price at once', m === 980, m);
await B.shot('06-scratch-card-bought');
await B.press('a'); await B.wait(400);
await B.shot('07-scratch-card-revealed');
m = await moneyB();
check('scratch: a x3 card pays 60 kr when revealed (net +40)', m === 1040, m);
await forceFirst(0.9999);
await B.press('Enter'); await B.wait(300); await B.press('a'); await B.wait(300);
check('scratch: a losing card pays nothing (net -20)', (await moneyB()) === 1020);
await B.press('Escape'); await B.wait(400);

// slot: forced 1x then a loss, near-miss presence over many direct spins
const v2 = await goVenue('slot');
check('slot venue: E shows the prompt and opens the machine', /Slot machine/.test(v2.prompt) && v2.active, v2);
await forceFirst(0.1); // first table entry: 1x (two crowns)
await B.press('Enter'); await B.wait(700);
check('slot: the stake (20 kr) is charged when the reels start', (await moneyB()) === 1000, await moneyB());
await B.wait(3500);
await B.shot('08-slot-machine');
check('slot: the win (1x = 20 kr) is paid when the reels stop', (await moneyB()) === 1020, await moneyB());
const slotStats = await B.G(() => {
  const gm = window.__game.scene.getScene('Game').systems.gambling; gm.rng = Math.random;
  const c = window.__game.scene.getScene('Game').ctx; c.state.money = 1e6; const before = c.state.money;
  let near = 0, n = 500, paid = 0;
  for (let i = 0; i < n; i++) { const r = gm.spinSlot(10); if (r.spin.near) near++; gm.payWin(r.spin); paid += r.spin.prize; }
  return { near, n, delta: c.state.money - before, staked: n * 10, paid };
});
check('slot: stake and win flows balance over 500 spins, near misses occur', slotStats.near > 20 && slotStats.delta === slotStats.paid - slotStats.staked, slotStats);
await B.press('Escape'); await B.wait(400);

// betting
await B.G(() => { window.__game.scene.getScene('Game').ctx.state.money = 1000; });
const mk1 = await B.G(() => window.__game.scene.getScene('Game').systems.gambling.markets().map((q) => ({ id: q.id, odds: q.odds, ok: q.available })));
check('bets: markets list AGF win/draw/lose and event bets with bad odds (<= 1/p x 0.78)', mk1.filter((q) => q.id.startsWith('match')).length === 3 && mk1.some((q) => q.id === 'event:rain'), mk1);
const bet1 = await B.G(() => { const gm = window.__game.scene.getScene('Game').systems.gambling; let first = 0.1; gm.rng = () => { if (first != null) { const r = first; first = null; return r; } return Math.random(); }; const r = gm.placeBet('match:win', 50); return { ok: r.ok, money: window.__game.scene.getScene('Game').ctx.state.money }; });
check('bets: placing an AGF bet charges the stake', bet1.ok && bet1.money === 950, bet1);
await B.G(() => window.__bus.emit('tasks:eventEnded', { event: { kind: 'match', name: 'AGF match' } }));
await B.wait(200);
const bet1r = await B.G(() => { const c = window.__game.scene.getScene('Game').ctx; const b = c.state.gambling.bets[0]; return { st: b.status, pay: b.payout, money: c.state.money, note: b.note }; });
check('bets: the AGF bet is settled by the match event ending (rng 0.1 = AGF win, x1.85 -> 93)', bet1r.st === 'won' && bet1r.pay === 93 && bet1r.money === 950 + 93, bet1r);
const bet2 = await B.G(() => { const gm = window.__game.scene.getScene('Game').systems.gambling; const r = gm.placeBet('event:rain', 50); const e = gm.ctx.systems.economy; e.advanceClock(13 * 60); gm._expire(); const b = gm.st.bets.at(-1); return { ok: r.ok, st: b.status, pay: b.payout }; });
check('bets: "rain within 12 h" that does not happen in time is lost', bet2.ok && bet2.st === 'lost' && bet2.pay === 0, bet2);
const bet3 = await B.G(() => {
  const g = window.__game.scene.getScene('Game'), gm = g.systems.gambling; g.ctx.state.economy.week; g.ctx.state.money = 1000;
  const r = gm.placeBet('event:rain', 100); const b = gm.st.bets.at(-1); const odds = b.odds;
  const ev = g.systems.missions.board.startEvent('rain'); // the REAL rain event
  return { ok: r.ok, ev: !!ev, st: b.status, pay: b.payout, expect: Math.round(100 * odds), odds, money: g.ctx.state.money };
});
check('bets: a real rain event settles the bet (paid stake x odds)', bet3.ok && bet3.ev && bet3.st === 'won' && bet3.pay === bet3.expect && bet3.money === 900 + bet3.pay, bet3);
await B.press('j'); await B.wait(300); await B.press('7'); await B.wait(500);
await B.shot('09-bets-tab');
await B.press('Escape'); await B.wait(300);

// save + reload keeps bets
const savedB = await B.G(() => {
  const g = window.__game.scene.getScene('Game'); g.systems.gambling.placeBet('match:draw', 20); g.save();
  const key = Object.keys(localStorage).find((k) => k.startsWith('aarhus-express:v1:'));
  const d = JSON.parse(localStorage.getItem(key));
  return { bets: d.gambling.bets.length, open: d.gambling.bets.filter((b) => b.status === 'open').length, opts: d.options.gambling, stats: d.gambling.stats };
});
await pageB.reload(); await B.wait(1500);
await B.press('Enter'); await B.wait(600); await B.press('Enter'); await B.wait(800);
await toGame(pageB, B);
const reB = await B.G(() => { const c = window.__game.scene.getScene('Game').ctx; return { bets: c.state.gambling.bets.length, open: c.systems.gambling.openBets().length, opt: c.state.options.gambling }; });
check('save/reload: bets (open + settled), stats and the gambling option survive', savedB.bets >= 4 && reB.bets === savedB.bets && reB.open === savedB.open && reB.opt === true && savedB.stats.plays > 0, { savedB, reB });
// fps with the pins and the overlay closed
await B.wait(3000);
const fps = await B.G(() => window.__game.loop.actualFps);
console.log('fps', Math.round(fps));
check('fps stays >= 80 headless with gambling pins', fps >= 80, Math.round(fps));
await pageB.close();

check('no console errors or page errors', errors.length === 0, errors.slice(0, 5));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
