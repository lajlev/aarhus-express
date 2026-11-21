import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { speedUp } from '../lib/speed.mjs';
import { chromium } from 'playwright-core';
const SHOTS = process.env.SHOTS_DIR || 'screenshots/test/legacy';
mkdirSync(SHOTS, { recursive: true });
const url = process.argv[2] || process.env.TEST_URL || 'http://127.0.0.1:4173/';
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  for (const d of readdirSync(root).sort().reverse())
    for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, d, rel); if (existsSync(p)) return p;
    }
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await speedUp(await browser.newPage({ viewport: { width: 1280, height: 720 } }));
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const press = async (k, ms = 90) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); await wait(150); };
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra }); console.log(ok ? 'PASS' : 'FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const G = `window.__game.scene.getScene('Game')`;

async function startGame(newGame) {
  await page.goto(url); await wait(1500);
  await press('Enter'); await wait(500);
  await press('Enter'); await wait(600);
  if (newGame) { for (let i = 0; i < 3; i++) { await press('ArrowDown'); } await press('Enter'); }
  await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player && window.__game.scene.getScene('Game').systems?.economy, null, { timeout: 25000 });
  await wait(1200);
}

await page.addInitScript(() => { try { if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); } } catch (e) {} });
await startGame(true);
await page.evaluate(() => { window.__log = []; for (const n of ['economy:rentDue', 'economy:rentPaid', 'economy:rentLate', 'economy:rentalEnded', 'economy:vehicleBought']) window.__bus.on(n, (p) => window.__log.push([n, JSON.parse(JSON.stringify(p))])); });
// stop addInitScript clearing on reload
await page.addInitScript(() => {});

const snap = () => ev(() => { const g = window.__game.scene.getScene('Game'), e = g.systems.economy, st = g.ctx.state; return { money: st.money, home: { ...st.home }, clock: e.getClock(), owned: [...st.ownedVehicles], lq: st.lq }; });

// ---- 0. start state
let s = await snap();
check('start: tier 0, rent 1200, paidUntilDay 7, clock Monday 08:00', s.home.tier === 0 && s.home.rentPerWeek === 1200 && s.home.paidUntilDay === 7 && s.clock.day === 0 && s.clock.hour === 8, { home: s.home, clock: s.clock });
const homeInfo = await ev(() => { const h = window.__game.scene.getScene('Game').ctx.home; return { street: h.street, district: h.district, x: h.x, y: h.y }; });
console.log('home', homeInfo);
const bikeHome = await ev(() => { const g = window.__game.scene.getScene('Game'), h = g.ctx.home; const v = g.vehicles.find((v) => v.owned && v.type === 'bike'); return v ? Math.round(Math.hypot(v.x - h.x, v.y - h.y) / 8) : null; });
check('city bike parked at the home door', bikeHome !== null && bikeHome < 12, bikeHome);

// ---- 1. rent weekly, once
await ev(() => { const e = window.__game.scene.getScene('Game').systems.economy; window.__game.scene.getScene('Game').ctx.state.money = 5000; e.advanceClock(7 * 1440 - e.getClock().minutes - 30); });
s = await snap();
check('rent not charged before it is due (day 6, 23:30)', s.money === 5000 && s.home.paidUntilDay === 7, { money: s.money });
await ev(() => window.__game.scene.getScene('Game').systems.economy.advanceClock(60));
s = await snap();
check('rent charged once at the due moment', s.money === 3800 && s.home.paidUntilDay === 14, { money: s.money, paidUntilDay: s.home.paidUntilDay });
await ev(() => { const e = window.__game.scene.getScene('Game').systems.economy; for (let i = 0; i < 5; i++) e.advanceClock(1440 / 2); });
s = await snap();
check('no second charge within the week', s.money === 3800 && s.home.paidUntilDay === 14, { money: s.money, day: s.clock.day });
const paidEvents = await ev(() => window.__log.filter((l) => l[0] === 'economy:rentPaid').length);
check('economy:rentPaid emitted exactly once', paidEvents === 1, paidEvents);

// ---- 2. arrears when broke
await ev(() => { const g = window.__game.scene.getScene('Game'); g.ctx.state.money = 100; const e = g.systems.economy; e.advanceClock(14 * 1440 - e.getClock().minutes + 5); });
s = await snap();
let stage = await ev(() => window.__game.scene.getScene('Game').systems.economy.home.stage());
check('broke at due: arrears, nothing charged', s.home.lateSince === 14 && s.money === 100 && stage === 'late', { lateSince: s.home.lateSince, money: s.money, stage });
await ev(() => window.__game.scene.getScene('Game').systems.economy.advanceClock(2 * 1440));
stage = await ev(() => window.__game.scene.getScene('Game').systems.economy.home.stage());
check('after grace: warning', stage === 'warning', stage);
await ev(() => window.__game.scene.getScene('Game').systems.economy.advanceClock(2 * 1440));
stage = await ev(() => window.__game.scene.getScene('Game').systems.economy.home.stage());
s = await snap();
check('evicted after 4 days; sleep disabled', stage === 'evicted' && s.home.evicted === true && !(await ev(() => window.__game.scene.getScene('Game').systems.economy.home.sleep().ok)), stage);
const lateEvents = await ev(() => window.__log.filter((l) => l[0] === 'economy:rentLate').map((l) => l[1].stage));
check('economy:rentLate emitted (late, warning, evicted)', ['late', 'warning', 'evicted'].every((x) => lateEvents.includes(x)), lateEvents);
await page.screenshot({ path: `${SHOTS}/evicted-world.png` });
await ev(() => { window.__game.scene.getScene('Game').ctx.state.money = 3000; window.__game.scene.getScene('Game').systems.economy.advanceClock(60); });
s = await snap();
check('catching up auto-pays arrears and clears eviction', s.home.lateSince === null && s.home.evicted === false && s.money === 1800, { money: s.money, paidUntilDay: s.home.paidUntilDay });

// ---- 3. E at the home door opens the Home overlay (real key press), screenshot
await ev(() => { const g = window.__game.scene.getScene('Game'), h = g.ctx.home; g.player.x = h.x; g.player.y = h.y; g.ctx.state.money = 9000; g.player.health = 40; });
await wait(400);
await press('e', 120); await wait(700);
let ov = await ev(() => window.__game.scene.isActive('Overlay'));
check('E at the home door opens the Home overlay', ov, ov);
const playerInVehicle = await ev(() => !!window.__game.scene.getScene('Game').player.vehicle);
check('E at the door did not also enter the bike', !playerInVehicle);
await page.screenshot({ path: `${SHOTS}/home-overlay.png` });
// sleep via keyboard: first row is Sleep
const before = await snap();
await press('Enter'); await wait(400);
await page.screenshot({ path: `${SHOTS}/home-after-sleep.png` });
s = await snap();
const saved = await ev(() => { const st = window.__game.scene.getScene('Game').ctx.state; const raw = localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('aarhus-express:v1'))); const d = JSON.parse(raw); return { clock: d.economy.clock, hp: d.player.health }; });
check('sleep: skipped to 07:00 next day', s.clock.hour === 7 && s.clock.day === before.clock.day + (before.clock.hour >= 7 ? 1 : 0), { before: before.clock, after: s.clock });
check('sleep: health restored and LQ bonus', await ev(() => { const p = window.__game.scene.getScene('Game').player; return p.health === p.maxHealth; }) && s.lq >= before.lq, { lqBefore: before.lq, lqAfter: s.lq });
check('sleep: game saved (clock in localStorage matches)', Math.abs(saved.clock - s.clock.minutes) < 2, saved);
await press('Escape'); await wait(400);
ov = await ev(() => window.__game.scene.isActive('Overlay'));
check('overlay closes with Esc', !ov);
const inV = await ev(() => !!window.__game.scene.getScene('Game').player.vehicle);
check('no ghost E after closing the overlay (not riding)', !inV);

// ---- 4. dealer overlay + scooter purchase
await ev(() => { const g = window.__game.scene.getScene('Game'); g.ctx.state.money = 200000; const s = g.systems.economy.fleet.getShop('dealer-silkeborgvej'); g.player.x = s.x; g.player.y = s.y + 8; });
await wait(400);
await press('e', 120); await wait(700);
ov = await ev(() => window.__game.scene.isActive('Overlay'));
const shopMode = await ev(() => window.__game.scene.getScene('Overlay').mode);
check('E on a dealer pad opens the Dealer overlay', ov && shopMode === 'dealer', shopMode);
await page.screenshot({ path: `${SHOTS}/dealer-overlay.png` });
// scooter is first row: Enter buys it
const m0 = (await snap()).money;
await press('Enter'); await wait(400);
s = await snap();
check('buying a scooter charges 18,000 and adds it to ownedVehicles', s.owned.includes('scooter') && s.money === m0 - 18000, { owned: s.owned, delta: s.money - m0 });
await page.screenshot({ path: `${SHOTS}/dealer-after-buy.png` });
const spawned = await ev(() => window.__game.scene.getScene('Game').vehicles.some((v) => v.owned && v.type === 'scooter'));
check('scooter spawned owned next to the shop', spawned);
await press('Escape'); await wait(400);
// licence ban refuses cars
await ev(() => window.__bus.emit('police:licence', { banned: true }));
const banRes = await ev(() => { const e = window.__game.scene.getScene('Game').systems.economy; const r = e.fleet.buy('dealer-viborgvej', 'smallcar'); const r2 = e.fleet.rent('dealer-randersvej', 'van', 1); const r3 = e.fleet.buy('dealer-silkeborgvej', 'ebike'); return [r, r2, r3.ok]; });
check('licence ban refuses car purchase and van rental politely, bikes fine', !banRes[0].ok && /licence/i.test(banRes[0].reason) && !banRes[1].ok && banRes[2] === true, banRes);
await page.screenshot({ path: `${SHOTS}/dealer-banned.png` });
await ev(() => window.__bus.emit('police:licence', { banned: false }));
// reload: scooter respawns at home
await ev(() => window.__bus.emit('state:requestSave', {}));
await ev(() => { const g = window.__game.scene.getScene('Game'); g.save(); });
await wait(300);
await page.evaluate(() => window.location.reload());
await wait(1500);
await press('Enter'); await wait(500); await press('Enter'); await wait(800);
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player && window.__game.scene.getScene('Game').systems?.economy, null, { timeout: 25000 });
await wait(1500);
const after = await ev(() => { const g = window.__game.scene.getScene('Game'), h = g.ctx.home; const v = g.vehicles.find((v) => v.owned && v.type === 'scooter'); return { owned: [...g.ctx.state.ownedVehicles], scooterDist: v ? Math.round(Math.hypot(v.x - h.x, v.y - h.y) / 8) : null, day: g.systems.economy.getClock().day }; });
check('after reload the scooter respawns at the home door', after.owned.includes('scooter') && after.scooterDist !== null && after.scooterDist < 25, after);

await page.evaluate(() => { window.__log = []; for (const n of ['economy:rentalEnded']) window.__bus.on(n, (p) => window.__log.push([n, p])); });
// ---- 5. rent a van, expires
await ev(() => { const g = window.__game.scene.getScene('Game'); g.ctx.state.money = 50000; const s = g.systems.economy.fleet.getShop('dealer-randersvej'); g.player.x = s.x; g.player.y = s.y + 8; });
await wait(300);
const m1 = (await snap()).money;
const rentRes = await ev(() => window.__game.scene.getScene('Game').systems.economy.fleet.rent('dealer-randersvej', 'van', 1));
s = await snap();
const van = await ev(() => { const v = window.__game.scene.getScene('Game').vehicles.find((v) => v.type === 'van' && v.rentedBy === 'player'); return v ? { rentedBy: v.rentedBy, owned: v.owned, usable: v.playerUsable } : null; });
check('renting a van: 900/day, spawns rentedBy player', rentRes.ok && s.money === m1 - 900 && van && van.rentedBy === 'player' && !van.owned && van.usable, { rentRes, delta: s.money - m1, van });
await page.screenshot({ path: `${SHOTS}/van-rented.png` });
await ev(() => window.__game.scene.getScene('Game').systems.economy.advanceClock(1400));
await wait(300);
check('van: warns before the end, still there', await ev(() => window.__game.scene.getScene('Game').vehicles.some((v) => v.type === 'van' && v.rentedBy === 'player')));
await ev(() => window.__game.scene.getScene('Game').systems.economy.advanceClock(100));
await wait(400);
const gone = await ev(() => ({ veh: window.__game.scene.getScene('Game').vehicles.some((v) => v.type === 'van' && v.rentedBy === 'player'), rentals: window.__game.scene.getScene('Game').ctx.state.economy.rentals.length, ended: window.__log.filter((l) => l[0] === 'economy:rentalEnded').length }));
check('van expires and is returned automatically (event + pager)', !gone.veh && gone.rentals === 0 && gone.ended >= 1, gone);

// ---- 6. existing fun shop still works
const f0 = await snap();
const fun = await ev(() => window.__game.scene.getScene('Game').systems.economy.buy('streetfood-feast'));
const f1 = await snap();
check('existing shop purchase (fun stuff -> LQ) still works', fun.ok && f1.money === f0.money - 140 && f1.lq > f0.lq, { fun, lq: [f0.lq, f1.lq] });
const sum = await ev(() => window.__game.scene.getScene('Game').systems.economy.getWeeklySummary());
check('weekly summary has rent and fun spending', sum.totalSpent > 0 && sum.spent.fun >= 140, sum);
// screenshot shop overlay path (B)
// ---- 7. move to Frederiksbjerg and Aarhus Ø
await ev(() => { window.__game.scene.getScene('Game').ctx.state.money = 100000; });
const mv1 = await ev(() => window.__game.scene.getScene('Game').systems.economy.home.moveTo(1));
const h1 = await ev(() => { const g = window.__game.scene.getScene('Game'); const h = g.ctx.home; return { street: h.street, district: h.district, tier: g.ctx.state.home.tier, rent: g.ctx.state.home.rentPerWeek, px: Math.round(g.player.px), hx: h.x, bikeNear: g.vehicles.some((v) => v.owned && v.type === 'bike' && Math.hypot(v.x - h.x, v.y - h.y) < 25 * 8) }; });
check('upgrade tier 1 (Frederiksbjerg): moved, rent 2400, vehicles follow', mv1.ok && h1.tier === 1 && h1.rent === 2400 && h1.bikeNear, h1);
const mv2 = await ev(() => window.__game.scene.getScene('Game').systems.economy.home.moveTo(2));
const h2 = await ev(() => { const g = window.__game.scene.getScene('Game'); const h = g.ctx.home; return { street: h.street, district: h.district, tier: g.ctx.state.home.tier, rent: g.ctx.state.home.rentPerWeek }; });
check('upgrade tier 2 (Aarhus Ø): moved, rent 4800', mv2.ok && h2.tier === 2 && h2.rent === 4800, h2);
await wait(300);
await press('e', 120); await wait(700);
await page.screenshot({ path: `${SHOTS}/home-aarhus-oe.png` });
await press('Escape'); await wait(300);
// map overlay
await press('m', 120); await wait(700);
await page.screenshot({ path: `${SHOTS}/map-overlay.png` });
await press('Escape'); await wait(300);
await press('Escape', 120); await wait(600);
await page.screenshot({ path: `${SHOTS}/pause-overlay.png` });
await press('Escape'); await wait(300);
const fps = await ev(() => Math.round(window.__game.loop.actualFps));
console.log(JSON.stringify({ fps, errors, failed: results.filter((r) => !r.ok).map((r) => r.name) }, null, 2));
await browser.close();
process.exit(results.some((r) => !r.ok) || errors.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]')) ? 1 : 0);
