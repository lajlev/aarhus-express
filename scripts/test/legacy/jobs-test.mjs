import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { speedUp } from '../lib/speed.mjs';
const url = process.argv[2] || process.env.TEST_URL || 'http://127.0.0.1:4173/';
const OUT = (process.env.SHOTS_DIR || 'screenshots/test/legacy') + '/';
mkdirSync(OUT, { recursive: true });
function findChrome() {
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  for (const d of readdirSync(root).sort().reverse()) for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) { const p = join(root, d, rel); if (existsSync(p)) return p; }
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await speedUp(await browser.newPage({ viewport: { width: 1280, height: 720 } }));
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const press = async (k, ms = 80) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); await wait(250); };
const G = (fn, arg) => page.evaluate(fn, arg);
const log = [];
const note = (k, v) => { log.push([k, v]); console.log(k, JSON.stringify(v)); };

await page.goto(url); await wait(1500);
await press('Enter'); await wait(500); await press('Enter'); await wait(600);
for (let i = 0; i < 3; i++) await press('ArrowDown', 60);
await press('Enter');
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
await wait(2000);

// ---------------- courier
await press('j'); await wait(500);
note('offers', await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.careers.courier.offers.map((o) => [o.from.name, o.to.name, o.metres, o.reward, o.size])));
await page.screenshot({ path: OUT + 'app-courier.png' });
const money0 = await G(() => window.__game.scene.getScene('Game').ctx.state.money);
await press('Enter'); await wait(500);
note('courier job', await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && { title: j.title, limit: j.timeLimit, reward: j.reward, stages: j.stages.map((s) => s.name) }; }));
const tp = async (x, y) => G(([x, y]) => { const g = window.__game.scene.getScene('Game'); g.player.x = x; g.player.y = y; }, [x, y]);
for (let st = 0; st < 2; st++) {
  const s = await G((st) => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && j.stages[st]; }, st);
  if (!s) break;
  await tp(s.x, s.y); await wait(2600);
}
await page.screenshot({ path: OUT + 'courier-done.png' });
note('courier after', await G(() => { const g = window.__game.scene.getScene('Game'); return { job: !!g.ctx.state.job, money: g.ctx.state.money, jobs: g.ctx.state.jobs.courier }; }));
note('money0', money0);

// ---------------- taxi
await press('j'); await wait(400); await press('2'); await wait(300);
await page.screenshot({ path: OUT + 'app-taxi-signup.png' });
await press('Enter'); await wait(300); // sign up
await page.screenshot({ path: OUT + 'app-taxi-signed.png' });
await press('Enter'); await wait(800); // start shift (closes)
note('scenes', await G(() => window.__game.scene.getScenes(true).map((s) => s.scene.key)));
note('taxi shift', await G(() => { const g = window.__game.scene.getScene('Game'); const s = g.ctx.systems.missions.careers.taxi.shift; return s && { stage: s.stage, stand: s.stand, v: [Math.round(s.vehicle.x), Math.round(s.vehicle.y)] }; }));
await G(() => { const g = window.__game.scene.getScene('Game'); const s = g.ctx.systems.missions.careers.taxi.shift; const p = s.vehicle.exitPoint(); g.player.x = p.x; g.player.y = p.y; });
await wait(300); await press('e', 100); await wait(800);
note('dbg', await G(() => { const g = window.__game.scene.getScene('Game'); const s = g.ctx.systems.missions.careers.taxi.shift; const v = s.vehicle; return { paused: g.scene.isPaused('Game'), pl: [g.player.x, g.player.y], v: [v.x, v.y], usable: v.playerUsable, jv: v.jobVehicle, driver: v.driver, inList: g.vehicles.includes(v), state: v.state, ov: g.scene.isActive('JobApp') }; }));
note('in taxi', await G(() => { const g = window.__game.scene.getScene('Game'); return { in: g.player.vehicle?.type, stage: g.ctx.systems.missions.careers.taxi.shift?.stage }; }));
await page.waitForFunction(() => window.__game.scene.getScene('Game').ctx.systems.missions.offer || window.__game.scene.getScene('Game').ctx.state.job, null, { timeout: 30000 });
await wait(800);
note('fare offer', await G(() => { const g = window.__game.scene.getScene('Game'); const m = g.ctx.systems.missions; const j = m.offer?.job || g.ctx.state.job; return j && { title: j.title, from: j.stages[0].name, metres: j.metres, est: j.reward }; }));
await page.waitForFunction(() => window.__game.scene.getScene('Game').ctx.state.job, null, { timeout: 15000 });
const moveTaxi = async (x, y) => G(([x, y]) => { const v = window.__game.scene.getScene('Game').player.vehicle; v.x = x; v.y = y; v.vx = 0; v.vy = 0; }, [x, y]);
let s0 = await G(() => window.__game.scene.getScene('Game').ctx.state.job.stages[0]);
await moveTaxi(s0.x, s0.y); await wait(2600);
// drive for real for a bit with the meter running
await page.keyboard.down('w'); await wait(2500); await page.keyboard.up('w');
await page.screenshot({ path: OUT + 'taxi-fare.png' });
note('meter', await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && { stage: j.stageIndex, loaded: j.loaded, meter: j.meter, reward: j.reward }; }));
const s1 = await G(() => window.__game.scene.getScene('Game').ctx.state.job.stages[1]);
await moveTaxi(s1.x, s1.y); await wait(1500);
note('taxi after', await G(() => { const g = window.__game.scene.getScene('Game'); return { job: !!g.ctx.state.job, money: g.ctx.state.money, taxi: g.ctx.state.jobs.taxi, shift: !!g.ctx.systems.missions.careers.taxi.shift }; }));
await press('j'); await wait(400); await press('2'); await wait(300);
await page.screenshot({ path: OUT + 'app-taxi-shift.png' });
await press('Enter'); await wait(400); // end shift -> return stage
await press('Escape'); await wait(400);
const sh = await G(() => { const g = window.__game.scene.getScene('Game'); return g.ctx.systems.missions.careers.taxi.shift?.stand; });
await moveTaxi(sh.x, sh.y); await wait(2500);
note('taxi returned', await G(() => { const g = window.__game.scene.getScene('Game'); return { shift: !!g.ctx.systems.missions.careers.taxi.shift, money: g.ctx.state.money, xp: g.ctx.state.jobs.taxi.xp }; }));
await press('e', 100); await wait(1500); // exit taxi -> removed
note('taxi removed', await G(() => window.__game.scene.getScene('Game').ctx.vehicles.filter((v) => v.type === 'taxi' && v.jobVehicle).length));

// ---------------- bus
await press('j'); await wait(400); await press('3'); await wait(300);
await press('Enter'); await wait(300); // sign up
await page.screenshot({ path: OUT + 'app-bus-routes.png' });
await press('Enter'); await wait(1000); // first route
note('bus shift', await G(() => { const g = window.__game.scene.getScene('Game'); const s = g.ctx.systems.missions.careers.bus.shift; return s && { route: s.route, stops: s.stops.map((x) => x.name), sched: s.sched.map(Math.round), type: s.vehicle.type, len: s.vehicle.def.length }; }));
await G(() => { const g = window.__game.scene.getScene('Game'); const s = g.ctx.systems.missions.careers.bus.shift; const p = s.vehicle.exitPoint(); g.player.x = p.x; g.player.y = p.y; });
await wait(300); await press('e', 100); await wait(1000);
note('in bus', await G(() => { const g = window.__game.scene.getScene('Game'); return { in: g.player.vehicle?.type, stage: g.ctx.state.job?.stageIndex }; }));
const moveBus = async (x, y) => G(([x, y]) => { const v = window.__game.scene.getScene('Game').player.vehicle; v.x = x; v.y = y; v.vx = 0; v.vy = 0; }, [x, y]);
for (let i = 1; i <= 3; i++) {
  const st = await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && j.stages[j.stageIndex]; });
  if (!st) break;
  await G(() => { const sh = window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.shift; sh.clock = sh.sched[sh.job.stageIndex] + 5; });
  await moveBus(st.x, st.y); await wait(i === 1 ? 1500 : 3600);
  if (i === 1) await page.screenshot({ path: OUT + 'bus-at-stop.png' });
}
note('bus mid', await G(() => { const g = window.__game.scene.getScene('Game'); const s = g.ctx.systems.missions.careers.bus.shift; return s && { served: s.served, skipped: s.skipped, punct: s.punctual, pay: s.pay, stage: s.job.stageIndex, ab: g.ctx.systems.missions.careers.bus.aheadBehind() }; }));
await press('j'); await wait(400); await press('3'); await wait(300);
await page.screenshot({ path: OUT + 'app-bus-shift.png' });
await press('Escape'); await wait(300);
// skip a stop by driving past: jump far, then finish remaining by stopping
await page.screenshot({ path: OUT + 'bus-driving.png' });
for (let i = 0; i < 12; i++) {
  const st = await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && j.shift ? j.stages[j.stageIndex] : null; });
  if (!st) break;
  await G(() => { const sh = window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.shift; if (sh) sh.clock = sh.sched[sh.job.stageIndex] + (Math.random() < 0.3 ? 0 : 5); });
  await moveBus(st.x, st.y); await wait(3600);
}
note('bus end', await G(() => { const g = window.__game.scene.getScene('Game'); return { job: !!g.ctx.state.job, money: g.ctx.state.money, bus: g.ctx.state.jobs.bus, shift: !!g.ctx.systems.missions.careers.bus.shift }; }));
note('fps', await G(() => Math.round(window.__game.loop.actualFps)));
await browser.close();
console.log(JSON.stringify({ errors }, null, 1));
const L = Object.fromEntries(log);
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 200) : ''}`); };
check('courier offers listed', Array.isArray(L.offers) && L.offers.length >= 1, L.offers?.length);
check('courier delivery completes and pays', L['courier after']?.job === false && L['courier after']?.jobs?.done === 1 && L['courier after'].money > L.money0, L['courier after']);
check('taxi: in the taxi on shift', L['in taxi']?.in === 'taxi', L['in taxi']);
check('taxi: a fare is completed and paid', L['taxi after']?.taxi?.fares === 1 && L['taxi after'].taxi.earned > 0, L['taxi after']);
check('taxi: shift ends when returned, paid more', L['taxi returned']?.shift === false && L['taxi returned'].money > L['taxi after'].money, L['taxi returned']);
check('taxi: vehicle removed after the shift', L['taxi removed'] === 0, L['taxi removed']);
check('bus: in the bus on shift', L['in bus']?.in === 'bus', L['in bus']);
check('bus: shift completes with stops served and pay', L['bus end']?.shift === false && L['bus end'].bus?.shifts === 1 && L['bus end'].bus.stops > 0 && L['bus end'].bus.earned > 0, L['bus end']);
check('no console errors', !errors.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]')), errors.slice(0, 3));
process.exit(failed ? 1 : 0);

