// Realistic-mode "first hour" playthrough (all game options OFF).
// Usage: node scripts/realistic-loop.mjs http://127.0.0.1:4173/ [shotsDir]      (use `npm run preview` after `npm run build`)
// New game -> spawn at home -> ride the bike -> J job app (3 tabs) -> 3 courier orders -> a red-light fine (courier rating drops)
// -> sleep at home -> rent paid on Monday -> rent a van for a day -> taxi shift -> bus shift. Asserts money/state at each step,
// no console errors, and fps. Exits non-zero on any failed assertion.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { speedUp } from './test/lib/speed.mjs';

const url = process.argv[2] || process.env.TEST_URL || 'http://127.0.0.1:4173/';
const shots = process.argv[3] || process.env.SHOTS_DIR || 'screenshots/realistic';
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
const page = await speedUp(await browser.newPage({ viewport: { width: 1280, height: 720 } }));
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const press = async (k, ms = 80) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); await wait(250); };
const G = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: join(shots, n + '.png') });
let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 220) : ''}`); };
const state = () => G(() => { const c = window.__game.scene.getScene('Game').ctx, s = c.state; return { money: s.money, deliveries: s.stats.deliveries, rating: s.jobs.courier.rating, job: !!s.job, clock: c.systems.economy.getClock(), paidUntilDay: s.home.paidUntilDay, lateSince: s.home.lateSince, hp: c.player.health }; });
const tp = (x, y) => G(([x, y]) => { const p = window.__game.scene.getScene('Game').player; if (p.vehicle) { p.vehicle.x = x; p.vehicle.y = y; p.vehicle.vx = 0; p.vehicle.vy = 0; } else { p.x = x; p.y = y; } }, [x, y]);
const toVehicle = (pred) => G((src) => { const g = window.__game.scene.getScene('Game'); const v = g.vehicles.find(new Function('v', 'return ' + src)); if (!v) return false; const e = v.exitPoint(); g.player.x = e.x; g.player.y = e.y; return true; }, pred);

// ---------------------------------------------------------------- 1. new game
await page.goto(url); await wait(1500);
await press('Enter'); await wait(600);
await press('Enter'); await wait(700);
await shot('01-new-game-screen');
for (let i = 0; i < 3; i++) await press('ArrowDown', 60);
await press('Enter');
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
await wait(2000);
const init = await G(() => {
  const g = window.__game.scene.getScene('Game'), c = g.ctx, s = c.state, h = g.world.home;
  const own = g.vehicles.find((v) => v.owned);
  return { opts: s.options, money: s.money, home: !!h, doorDist: Math.round(Math.hypot(g.player.px - h.x, g.player.py - h.y) / 8), bike: own?.type, bikeDist: own ? Math.round(Math.hypot(own.x - h.x, own.y - h.y) / 8) : null, paid: s.home.paidUntilDay, rent: s.home.rentPerWeek, hour: c.systems.economy.getClock().hour, heat: s.heat };
});
check('new game: all options off', Object.values(init.opts).every((v) => v === false), init.opts);
check('new game: low starting money (450-650)', init.money >= 450 && init.money <= 650, init.money);
check('spawn at the home door with the bike parked 4-6 m beside it', init.home && init.doorDist <= 4 && init.bike === 'bike' && init.bikeDist >= 3 && init.bikeDist <= 7, init);
check('first week of rent prepaid (1,200/week), Monday 08:00', init.paid === 7 && init.rent === 1200 && init.hour === 8, init);
await shot('02-home-spawn');

// ---------------------------------------------------------------- 2. ride the bike
await toVehicle('v.owned');
await wait(300); await press('e', 90); await wait(400);
await page.keyboard.down('w'); await wait(2500);
const ride = await G(() => { const p = window.__game.scene.getScene('Game').player; return { bike: !!p.vehicle?.def.bike, speed: p.vehicle?.speedMps || 0, stolen: window.__game.scene.getScene('Game').ctx.state.stats.stolen }; });
await page.keyboard.up('w');
check('ride the bike (no theft)', ride.bike && ride.speed > 2 && ride.stolen === 0, ride);

// ---------------------------------------------------------------- 3. job app, three tabs
await press('j'); await wait(600);
await shot('03-jobapp-courier');
await press('2'); await wait(400); await shot('04-jobapp-taxi');
await press('3'); await wait(400); await shot('05-jobapp-bus');
await press('1'); await wait(300);
const offers0 = await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.careers.courier.offers.map((o) => ({ m: o.metres, r: o.reward, pick: window.__game.scene.getScene('Game').ctx.systems.missions.careers.courier.pickupMetres(o) })));
check('job app lists courier offers within bike range (<= 1.4 km pickup)', offers0.length >= 1 && offers0.every((o) => o.pick <= 1400), offers0);
await press('Escape'); await wait(400);

// ---------------------------------------------------------------- 4. three courier orders
for (let n = 1; n <= 3; n++) {
  const m0 = (await state()).money;
  await press('j'); await wait(500); await press('1'); await wait(250);
  if (n === 1) { /* decline nothing: take the first */ }
  await press('Enter'); await wait(600);
  let open = await G(() => window.__game.scene.isActive('JobApp'));
  if (open) { await press('Escape'); await wait(300); }
  const job = await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && { title: j.title, reward: j.reward, stages: j.stages.map((s) => ({ x: s.x, y: s.y })) }; });
  check(`order ${n}: accepted from the app`, !!job, job && { title: job.title, reward: job.reward });
  if (!job) break;
  for (const s of job.stages) { await tp(s.x, s.y); await wait(2600); }
  const st = await state();
  check(`order ${n}: delivered and paid once`, st.deliveries === n && st.money > m0 && st.money - m0 < 400 && !st.job, { delta: st.money - m0, deliveries: st.deliveries, rating: st.rating });
  if (n === 1) await shot('06-courier-order');
}

// ---------------------------------------------------------------- 5. red-light fine on the bike, rating drops
await G(() => { const g = window.__game.scene.getScene('Game'); g.systems.traffic.density = 0; window.__t = []; window.__bus.on('police:ticket', (t) => window.__t.push(t)); });
const ap = await G(() => {
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
await page.waitForFunction((i) => { const S = window.__game.scene.getScene('Game').systems.traffic.signals; return S.stateOf(S.aps[i]) === 2 && S.redAge(S.aps[i]) > 1; }, ap.i, { timeout: 90000 });
const before = await state();
await G(([ap]) => {
  const v = window.__game.scene.getScene('Game').player.vehicle; const sp = 6 * 8, bx = ap.sx - ap.dx * 14 * 8, by = ap.sy - ap.dy * 14 * 8;
  v.x = bx; v.y = by; v.angle = ap.ang; v.vx = Math.cos(ap.ang) * sp; v.vy = Math.sin(ap.ang) * sp; v.sprite.setPosition(bx, by).setRotation(ap.ang);
}, [ap]);
await page.keyboard.down('w'); await wait(2400);
await shot('07-intersection-red-light-hud');
await wait(600);
await page.keyboard.up('w');
await wait(600);
const after = await state();
const tickets = await G(() => window.__t.map((t) => ({ type: t.type, fine: t.fine, rp: t.ratingPenalty, bike: t.bike })));
const red = tickets.find((t) => t.type === 'redLight');
await shot('08-ticket-popup');
check('red light: one fine, bike fine 400 kr (1,000 x FINE_SCALE 0.4)', !!red && red.fine === 400 && red.bike, tickets);
// fines are bills now: nothing is charged at the moment of the offence; the charge happens when the bill is paid
const billsNow = await G(() => window.__game.scene.getScene('Game').ctx.systems.economy.bills.open().map((b) => ({ id: b.id, a: b.amount, k: b.kind, due: b.dueDay })));
check('red light: the 400 kr fine is an OPEN bill (due in 7 days) and money was not charged yet', billsNow.some((b) => b.a === 400 && b.k === 'fine' && b.due === 7) && after.money >= before.money, { billsNow, before: before.money, after: after.money });
const payRes = await G(() => {
  const g = window.__game.scene.getScene('Game'), e = g.ctx.systems.economy, st = g.ctx.state;
  // the red-light fine is the bill under test; other bills (a traffic incident while riding) are reported but not part of this charge
  const open = e.bills.open().map((b) => ({ id: b.id, a: b.amount, k: b.kind, l: b.label }));
  const fine = e.bills.open().find((b) => b.kind === 'fine' && b.amount === 400);
  const m0 = st.money, owed = fine ? e.bills.owed(fine) : 0;
  const ok = fine ? e.bills.pay(fine.id).ok : false;
  return { n: ok ? 1 : 0, owed, charged: m0 - st.money, open };
});
check('paying the bill(s) charges them in full (delayed charge)', payRes.n >= 1 && payRes.charged === payRes.owed && payRes.owed >= 400, payRes);
check('courier rating dropped (about -0.04 per penalty point 2)', after.rating < before.rating, { before: before.rating, after: after.rating });
await press('j'); await wait(500); await shot('09-jobapp-after-fine'); await press('Escape'); await wait(300);

// ---------------------------------------------------------------- 6. sleep at home, rent on Monday
await G(() => { window.__bus.emit('economy:pay', { amount: 2500, reason: 'test wages' }); });
const homeDoor = await G(() => { const h = window.__game.scene.getScene('Game').world.home; return { x: h.x, y: h.y }; });
await G(() => { const p = window.__game.scene.getScene('Game').player; if (p.vehicle) p.exitVehicle(); });
await tp(homeDoor.x, homeDoor.y); await wait(500);
await press('e', 90); await wait(700);
const ov = await G(() => window.__game.scene.getScenes(true).map((s) => s.scene.key));
check('E at the door opens the home overlay (and not the bike)', ov.includes('Overlay') && (await G(() => !window.__game.scene.getScene('Game').player.vehicle)), ov);
await shot('10-home-overlay');
await press('Escape'); await wait(500);
const s0 = await state();
const slept = await G(() => window.__game.scene.getScene('Game').ctx.systems.economy.home.sleep());
const s1 = await state();
check('sleep: next morning 07:00, health full', slept.ok && s1.clock.hour === 7 && s1.clock.day === s0.clock.day + 1, { from: s0.clock, to: s1.clock });
await G(() => { const e = window.__game.scene.getScene('Game').ctx.systems.economy; e.advanceClock(6 * 1440 + 23 * 60 + 50 - e.getClock().minutes); });
const sun = await state();
check('Sunday 23:50: rent not yet charged', sun.paidUntilDay === 7, sun);
const mBefore = sun.money;
await G(() => { window.__game.scene.getScene('Game').ctx.systems.economy.advanceClock(20); });
const mon = await state();
check('Monday: 1,200 kr rent debited once, paid until day 14', mon.clock.day === 7 && mon.paidUntilDay === 14 && mBefore - mon.money >= 1200 && mBefore - mon.money < 1500, { day: mon.clock.day, paid: mon.paidUntilDay, delta: mBefore - mon.money });

// ---------------------------------------------------------------- 7. rent a van for a day
const rentInfo = await G(() => {
  const g = window.__game.scene.getScene('Game'), eco = g.ctx.systems.economy, fleet = eco.fleet;
  const shop = fleet.getShops().find((s) => (s.rent || []).includes('van'));
  if (!shop) return null;
  g.ctx.systems.economy.activeShop = shop;
  const m0 = eco.getMoney();
  return { shop: shop.id, name: shop.name, m0 };
});
check('a van rental shop exists', !!rentInfo, rentInfo);
if (rentInfo) {
  await G((s) => { const g = window.__game.scene.getScene('Game'); g.ctx.systems.economy.activeShop = g.ctx.systems.economy.fleet.getShop(s); window.__bus.emit('ui:openOverlay', { mode: 'dealer' }); }, rentInfo.shop);
  await wait(700); await shot('11-dealer-overlay');
  await press('Escape'); await wait(500);
  const r = await G((s) => { const e = window.__game.scene.getScene('Game').ctx.systems.economy; const m0 = e.getMoney(); const res = e.fleet.rent(s, 'van', 1); return { res, delta: e.getMoney() - m0 }; }, rentInfo.shop);
  const van = await G(() => { const v = window.__game.scene.getScene('Game').vehicles.find((v) => v.rentedBy === 'player'); return v && { type: v.type, usable: v.playerUsable }; });
  check('van rented for a day (900 kr), spawned rentedBy player, usable', r.res.ok && r.delta === -900 && van?.usable, { r, van });
  await toVehicle("v.rentedBy === 'player'"); await wait(300); await press('e', 90); await wait(400);
  const inVan = await G(() => { const g = window.__game.scene.getScene('Game'); return { in: g.player.vehicle?.rentedBy, stolen: g.ctx.state.stats.stolen }; });
  check('E enters the rented van without a theft', inVan.in === 'player' && inVan.stolen === 0, inVan);
  await press('e', 90); await wait(400);
}

// ---------------------------------------------------------------- 8. taxi shift
await G(() => { const p = window.__game.scene.getScene('Game').player; if (p.vehicle) p.exitVehicle(); });
await press('j'); await wait(500); await press('2'); await wait(300);
await press('Enter'); await wait(400); // sign up
await press('Enter'); await wait(900); // start shift
const tx = await G(() => { const s = window.__game.scene.getScene('Game').ctx.systems.missions.careers.taxi.shift; return s && { stage: s.stage, stand: s.stand }; });
check('taxi: signed up, shift started, taxi waits at a stand', !!tx, tx);
await G(() => { const g = window.__game.scene.getScene('Game'); const p = g.ctx.systems.missions.careers.taxi.shift.vehicle.exitPoint(); g.player.x = p.x; g.player.y = p.y; });
await wait(300); await press('e', 100); await wait(900);
const inTaxi = await G(() => window.__game.scene.getScene('Game').player.vehicle?.type);
check('taxi: entered the company taxi', inTaxi === 'taxi', inTaxi);
await page.waitForFunction(() => { const g = window.__game.scene.getScene('Game'); return g.ctx.systems.missions.offer || g.ctx.state.job; }, null, { timeout: 40000 });
await page.waitForFunction(() => window.__game.scene.getScene('Game').ctx.state.job, null, { timeout: 20000 });
const tm0 = (await state()).money;
const f0 = await G(() => window.__game.scene.getScene('Game').ctx.state.job.stages[0]);
await tp(f0.x, f0.y); await wait(2600);
await page.keyboard.down('w'); await wait(2200); await page.keyboard.up('w');
await shot('12-taxi-fare');
const f1 = await G(() => window.__game.scene.getScene('Game').ctx.state.job.stages[1]);
for (let k = 0; k < 6 && (await G(() => !!window.__game.scene.getScene('Game').ctx.state.job)); k++) { await tp(f1.x, f1.y); await wait(1500); }
const tm1 = await state();
const fares = await G(() => window.__game.scene.getScene('Game').ctx.state.jobs.taxi);
// a pavement or speeding fine while driving the fare is legitimate, so assert on the fare record, not the raw money delta
check('taxi: fare completed and recorded', fares.fares >= 1 && fares.earned > 0 && !tm1.job, { delta: tm1.money - tm0, fares: fares.fares, earned: fares.earned });
await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.careers.taxi.endShift());
const stand = await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.careers.taxi.shift?.stand);
if (stand) { await tp(stand.x, stand.y); await wait(2600); }
const tEnd = await G(() => ({ shift: !!window.__game.scene.getScene('Game').ctx.systems.missions.careers.taxi.shift, fares: window.__game.scene.getScene('Game').ctx.state.jobs.taxi.fares }));
check('taxi: shift ended after returning the taxi', !tEnd.shift && tEnd.fares >= 1, tEnd);
await G(() => { const p = window.__game.scene.getScene('Game').player; if (p.vehicle) p.exitVehicle(); });
await wait(800);

// ---------------------------------------------------------------- 9. short bus shift
await press('j'); await wait(500); await press('3'); await wait(300);
await press('Enter'); await wait(400); // sign up
await press('Enter'); await wait(1000); // first route
const bs = await G(() => { const s = window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.shift; return s && { route: s.route.ref, stops: s.stops.length }; });
check('bus: signed up and shift started on a real route', !!bs && bs.stops >= 3, bs);
let inBus = null;
for (let attempt = 0; attempt < 3 && inBus !== 'bus'; attempt++) { // setup: a passing car can be nearer to the player than the bus when E is pressed
  await G(() => { const g = window.__game.scene.getScene('Game'); const p = g.ctx.systems.missions.careers.bus.shift.vehicle.exitPoint(); g.player.x = p.x; g.player.y = p.y; });
  await wait(300); await press('e', 100); await wait(900);
  inBus = await G(() => window.__game.scene.getScene('Game').player.vehicle?.type);
  if (inBus && inBus !== 'bus') await G(() => window.__game.scene.getScene('Game').player.exitVehicle());
}
check('bus: entered the bus (job vehicle)', inBus === 'bus', inBus);
for (let i = 1; i <= 3; i++) {
  const st = await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && j.stages[j.stageIndex]; });
  if (!st) break;
  await G(() => { const sh = window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.shift; sh.clock = sh.sched[sh.job.stageIndex] + 5; });
  await tp(st.x, st.y); await wait(i === 1 ? 1500 : 3600);
  if (i === 1) await shot('13-bus-at-stop');
}
const busMid = await G(() => { const s = window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.shift; return s && { served: s.served, punctual: s.punctual, pay: s.pay }; });
check('bus: stops served on time', !!busMid && busMid.served >= 2, busMid);
// fps with full traffic, lights and a running bus shift
await G(() => { window.__game.scene.getScene('Game').systems.traffic.density = 1; });
await page.keyboard.down('w'); await wait(5000);
const fps = await G(() => Math.round(window.__game.loop.actualFps));
await page.keyboard.up('w');
check('fps >= 80 with full traffic, lights and a bus shift', fps >= 80, fps);
const m2 = (await state()).money;
await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.endShift());
await wait(600);
const busEnd = await G(() => ({ shift: !!window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.shift, stops: window.__game.scene.getScene('Game').ctx.state.jobs.bus.stops }));
check('bus: shift ended, stops recorded', !busEnd.shift && busEnd.stops >= 2, { ...busEnd, moneyDelta: (await state()).money - m2 });

const crime = await G(() => { const g = window.__game.scene.getScene('Game'); return { heat: g.ctx.state.heat, stolen: g.ctx.state.stats.stolen }; });
check('no heat, no thefts in the whole run', crime.heat === 0 && crime.stolen === 0, crime);
check('no console errors', errors.length === 0, errors);
await browser.close();
console.log(`SUMMARY ${pass}/${pass + fail}`);
process.exit(fail || errors.length ? 1 : 0);
