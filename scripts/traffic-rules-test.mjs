// Traffic rules / lights / fines play test (own port). Usage: node scripts/traffic-rules-test.mjs http://127.0.0.1:5202/ [shotsDir]
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const url = process.argv[2] || 'http://127.0.0.1:5202/';
const shots = process.argv[3] || 'screenshots';
const mode = process.argv[4] || 'realistic'; // realistic | classic
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const root of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).sort().reverse()) for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome']) {
      const p = join(root, d, rel); if (existsSync(p)) return p;
    }
  }
}
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const results = {};
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url); await wait(1500);
await page.keyboard.press('Enter'); await wait(600);
await page.keyboard.press('Enter'); await wait(600);
for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await wait(150); }
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
await wait(1500);
if (mode === 'classic') await page.evaluate(() => { window.__game.scene.getScene('Game').ctx.state.options = { theft: true, criminalMissions: true, mayhem: true }; });

// helpers inside the page
await ev(() => {
  const g = window.__game.scene.getScene('Game');
  window.T = {
    g,
    sig: () => g.systems.traffic.signals,
    log: [], money: () => g.ctx.state.money,
  };
  window.__bus.on('police:ticket', (t) => window.T.log.push(t));
  // fines are bills now: record the bill amounts issued (no REQUEST_PAY 'fine' any more) and any immediate 'fine' charge (must stay empty)
  window.__bus.on('economy:billIssued', ({ bill }) => { if (bill.kind === 'fine') (window.T.pays ||= []).push(-bill.amount); });
  window.__bus.on('economy:pay', (p) => { if (p.reason === 'fine') (window.T.instant ||= []).push(p.amount); });
});

// enter a car: spawn an owned hatchback by the player, teleport to it, press E
async function giveCar(type = 'smallcar') {
  await ev((type) => {
    const { g } = window.T; const p = g.player;
    if (p.vehicle) p.exitVehicle?.();
    const v = g.ctx.spawnVehicle(type, p.px + 30, p.py + 30, { angle: 0, owned: true });
    window.T.car = v;
    const e = v.exitPoint(); p.x = e.x; p.y = e.y;
  }, type);
  await wait(250);
  await page.keyboard.down('e'); await wait(90); await page.keyboard.up('e'); await wait(300);
  return ev(() => !!window.T.g.player.vehicle);
}
async function place(x, y, ang, speedMps) {
  if (!(await ev(() => !!window.T.g.player.vehicle))) { await giveCar(); }
  await ev(() => { const v = window.T.g.player.vehicle; v.health = v.maxHealth; v.state = 'ok'; });
  await ev(({ x, y, ang, speedMps }) => {
    const v = window.T.g.player.vehicle; const PX = 8;
    v.x = x; v.y = y; v.angle = ang; v.vx = Math.cos(ang) * speedMps * PX; v.vy = Math.sin(ang) * speedMps * PX; v.spin = 0;
    v.sprite.setPosition(x, y).setRotation(ang);
  }, { x, y, ang, speedMps });
}

// ---- find an interesting signal approach (4-way, straight approach of length >= 40 m) near centre
const ap = await ev(() => {
  const { g } = window.T; const S = g.systems.traffic.signals; const gr = g.world.drive;
  let best = null;
  for (const a of S.aps) {
    const c = a.ctrl; if (c.axes !== 3) continue;
    const len = Math.hypot(gr.x[a.node] - gr.x[a.from], gr.y[a.node] - gr.y[a.from]);
    if (len < 48 * 8 || a.w < 56) continue;
    const d = Math.hypot(a.sx - g.world.landmark('radhus').x, a.sy - g.world.landmark('radhus').y);
    if (!best || d < best.d) best = { d, i: S.aps.indexOf(a) };
  }
  const a = S.aps[best.i];
  return { i: best.i, sx: a.sx, sy: a.sy, dx: a.dx, dy: a.dy, node: a.node, from: a.from, ang: a.ang, w: a.w, ctrls: S.ctrls.length, aps: S.aps.length };
});
results.signals = { controllers: ap.ctrls, approaches: ap.aps };

const entered = await giveCar();
results.enteredCar = entered;

// ---- red light fine for the player: wait for red on that approach, then cross at 9 m/s
const waitState = (idx, want, timeout = 60000) => page.waitForFunction(({ idx, want }) => { const S = window.T.sig(); return S.stateOf(S.aps[idx]) === want && (want !== 2 || S.redAge(S.aps[idx]) > 1); }, { idx, want }, { timeout });
const redIdx = ap.i;
// start 14 m before the stop line, heading into it
const back = (m) => ({ x: ap.sx - ap.dx * m * 8, y: ap.sy - ap.dy * m * 8 });
await ev(() => { window.T.g.systems.traffic.density = 0; });
await waitState(redIdx, 2);
await ev(() => { window.T.log.length = 0; window.T.pays = []; });
const m0 = await ev(() => window.T.money());
await ev(() => { window.T.g.ctx.state.money = 20000; });
let b = back(16); await place(b.x, b.y, ap.ang, 10);
// keep pushing speed forward for 2.5 s
await page.keyboard.down('w'); await wait(2600); await page.keyboard.up('w');
results.redLight = await ev(() => ({ tickets: window.T.log.map((t) => ({ type: t.type, fine: t.fine, clips: t.clips })), pays: window.T.pays, instantCharges: window.T.instant || [], money: window.T.money(), openBills: window.T.g.systems.economy.bills.open().map((b) => b.amount) }));

// ---- again at red immediately (cooldown): should not double-fine within the cooldown
await ev(() => { window.T.log.length = 0; });
b = back(16); await place(b.x, b.y, ap.ang, 10); await page.keyboard.down('w'); await wait(1500); await page.keyboard.up('w');
results.redLightRepeatWithinCooldown = await ev(() => window.T.log.filter((t) => t.type === 'redLight').length);

// ---- green: no fine
await ev(() => { window.T.log.length = 0; });
await waitState(redIdx, 0);
b = back(16); await place(b.x, b.y, ap.ang, 10); await page.keyboard.down('w'); await wait(2000); await page.keyboard.up('w');
results.greenNoFine = await ev(() => window.T.log.filter((t) => t.type === 'redLight').length === 0);

// ---- AI car stops at a red light: spawn an AI car on the approach and watch
await ev(() => { window.T.g.systems.traffic.density = 1; });
await waitState(redIdx, 2);
const aiTest = await ev(async ({ ap }) => {
  const { g } = window.T; const tr = g.systems.traffic; const S = tr.signals; const a = S.aps[ap.i];
  const gr = g.world.drive;
  // park the player far away so the AI near the intersection is not recycled
  const v = tr.spawnVehicle('smallcar', { x: gr.x[a.from], y: gr.y[a.from] }, { mode: 'traffic' });
  // route it along the approach: from -> node
  const ai = v.ai; tr.brain.setRoute(ai, a.from, a.node, false);
  v.x = a.sx - a.dx * 40 * 8 + (-a.dy) * 1.5 * 8; v.y = a.sy - a.dy * 40 * 8 + a.dx * 1.5 * 8; v.angle = a.ang; v.vx = a.dx * 10 * 8; v.vy = a.dy * 10 * 8;
  v.sprite.setPosition(v.x, v.y);
  window.T.aiCar = v; window.T.aiAp = a;
  return { st: S.stateOf(a) };
}, { ap });
results.aiSpawn = aiTest;
// sample: park the player near so the car isn't despawned, then sample AI car along-line coordinate and the light state
await place(ap.sx - ap.dx * 60 * 8 + 80, ap.sy - ap.dy * 60 * 8 + 80, ap.ang, 0);
const samples = [];
for (let i = 0; i < 40; i++) {
  samples.push(await ev(() => { const v = window.T.aiCar, a = window.T.aiAp, S = window.T.sig(); return { s: +(((v.x - a.sx) * a.dx + (v.y - a.sy) * a.dy) / 8).toFixed(1), v: +v.speedMps.toFixed(1), st: S.stateOf(a), alive: !v.destroyed && v.driver === 'ai' }; }));
  await wait(500);
}
results.aiSamples = samples.filter((_, i) => i % 2 === 0).map((s) => `${s.s}m/${s.v}mps/${'GAR'[s.st]}`).join(' ');
// verdict: car must never be beyond +1 m past the line while red had been on > 1 s (approx: check any sample with st R, s>2 and v>3 that was R for previous also)
let crossedOnRed = false, stoppedAtRed = false;
for (let i = 1; i < samples.length; i++) {
  if (samples[i - 1].st === 2 && samples[i].st === 2 && samples[i - 1].s < -1 && samples[i].s > 1) crossedOnRed = true;
  if (samples[i].st === 2 && samples[i].v < 0.3 && samples[i].s < 0 && samples[i].s > -12) stoppedAtRed = true;
}
results.aiStoppedAtRed = stoppedAtRed; results.aiCrossedOnRed = crossedOnRed;

// ---- speed camera: use a camera spot
const cam = await ev(() => { const spots = window.T.g.systems.police.trafficRules.cameraSpots(); return spots.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y), a: s.a, street: s.street })); });
results.cameraSpots = cam.map((c) => c.street);
if (cam.length) {
  const c = cam[0];
  await ev(() => { window.T.log.length = 0; window.T.g.systems.traffic.density = 0.2; });
  const sx = c.x - Math.cos(c.a) * 60 * 8, sy = c.y - Math.sin(c.a) * 60 * 8;
  await place(sx, sy, c.a, 18); await wait(600); // let the van spawn
  await page.keyboard.down('w');
  for (let i = 0; i < 24; i++) { await ev(({ c }) => { const v = window.T.g.player.vehicle; const ux = Math.cos(c.a), uy = Math.sin(c.a); const sp = 20 * 8; v.vx = ux * sp; v.vy = uy * sp; }, { c }); await wait(180); }
  await page.keyboard.up('w');
  await page.screenshot({ path: join(shots, 'camera.png') });
  results.camera = await ev(() => window.T.log.filter((t) => t.type === 'speeding').map((t) => ({ fine: t.fine, source: t.source, kmh: t.speedKmh, lim: t.limitKmh, clips: t.clips })));
}

// ---- injury fine with mayhem off
await ev(() => { window.T.log.length = 0; window.T.pays = []; window.__bus.emit('traffic:injury', { severity: 1, byPlayer: true, killed: false, x: 0, y: 0, vehicle: null }); });
await wait(200);
results.injury = await ev(() => ({ tickets: window.T.log.map((t) => ({ type: t.type, fine: t.fine, clips: t.clips, rating: t.ratingPenalty })), pays: window.T.pays, licence: window.T.g.systems.police.getLicence() }));
await ev(() => { window.__bus.emit('traffic:injury', { severity: 1, byPlayer: false, killed: false, x: 0, y: 0, vehicle: null }); });
await wait(100);
results.injuryNotByPlayerIgnored = await ev(() => window.T.log.length === 1);


// ---- more offences: wrong way, pavement, ramming, patrol speeding, licence ban
const hold = async (k, ms) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); };
const clearLog = () => ev(() => { window.T.log.length = 0; window.T.pays = []; });
const types = () => ev(() => window.T.log.map((t) => `${t.type}:${t.fine}:${t.source}`));
await ev(() => { window.T.g.systems.traffic.density = 0.3; window.T.g.ctx.state.money = 90000; window.T.g.ctx.state.licence.clips = 0; window.T.g.ctx.state.licence.banLeft = 0; });
// wrong way: a long one-way edge
const ow = await ev(() => {
  const { g } = window.T; const m = g.world.map.drive, gr = g.world.drive; let best = null;
  for (let i = 0; i < m.e.length; i += 4) {
    if (!m.e[i + 2]) continue;
    const a = m.e[i], b = m.e[i + 1], len = Math.hypot(gr.x[b] - gr.x[a], gr.y[b] - gr.y[a]);
    if (len > 90 * 8 && len < 160 * 8 && (!best || len > best.len)) best = { a, b, len };
  }
  return best ? { ax: gr.x[best.a], ay: gr.y[best.a], bx: gr.x[best.b], by: gr.y[best.b], len: best.len } : null;
});
results.oneWayEdgeFound = !!ow;
if (ow) {
  await clearLog();
  const dx = ow.ax - ow.bx, dy = ow.ay - ow.by, l = Math.hypot(dx, dy); // against the permitted direction (b -> a)
  const ang = Math.atan2(dy, dx);
  await page.keyboard.down('w');
  for (let k = 0; k < 6; k++) { await place(ow.bx + (ow.ax - ow.bx) * 0.2, ow.by + (ow.ay - ow.by) * 0.2, ang, 8); await wait(1100); }
  await page.keyboard.up('w');
  results.wrongWay = await types();
}
// pavement: find a foot-surface spot
const pv = await ev(() => {
  const { g } = window.T; const w = g.world, p = g.player;
  for (let r = 40; r < 4000; r += 25) for (let a = 0; a < 6.28; a += 0.2) {
    const x = p.px + Math.cos(a) * r, y = p.py + Math.sin(a) * r;
    if (w.surfaceAt(x, y) === 'foot' && w.surfaceAt(x + 60, y) === 'foot' && w.surfaceAt(x + 120, y) === 'foot' && w.surfaceAt(x + 180, y) === 'foot') return { x, y };
  }
  return null;
});
results.pavementSpot = !!pv;
if (pv) {
  await clearLog();
  await place(pv.x, pv.y, 0, 8); await page.keyboard.down('w'); await wait(1500);
  await place(pv.x, pv.y, 0, 8); await wait(1500);
  await place(pv.x, pv.y, 0, 8); await wait(1500); await page.keyboard.up('w');
  results.pavement = await types();
}
// ramming: parked car dead ahead + an AI car
await ev(() => { window.T.g.ctx.state.licence.clips = 0; });
await clearLog();
{
  const lat = 1.6 * 8, rx = -ap.dy, ry = ap.dx;
  const c = { x: ap.sx - ap.dx * 45 * 8 + rx * lat, y: ap.sy - ap.dy * 45 * 8 + ry * lat };
  await ev(({ c, ap }) => { const { g } = window.T; const ai = g.ctx.spawnVehicle('van', c.x + ap.dx * 22 * 8, c.y + ap.dy * 22 * 8, { angle: ap.ang, color: 0xff0000, driver: null }); window.T.target = ai; }, { c, ap });
  await place(c.x, c.y, ap.ang, 14); await page.keyboard.down('w'); await wait(1800); await page.keyboard.up('w');
  results.ramParked = await types();
}
// patrol speeding
await ev(() => { if (window.T.target && !window.T.target.destroyed) window.T.g.ctx.removeVehicle(window.T.target); });
await clearLog(); await wait(9000);
{
  const r = await ev(() => {
    const { g } = window.T; const v = g.player.vehicle; const tr = g.systems.traffic; const rules = g.systems.police.trafficRules;
    const px = v.x, py = v.y;
    const pc = tr.spawnVehicle('police', { x: px + 150, y: py }, { mode: 'traffic' });
    pc.patrol = true; rules.patrolCars().push(pc);
    pc.x = px + 120; pc.y = py + 0; pc.sprite.setPosition(pc.x, pc.y);
    return { lim: g.world.speedLimitAt(px, py) };
  });
  results.patrolLimit = r.lim;
  await ev(() => { const v = window.T.g.player.vehicle; v.vx = 17 * 8; v.vy = 0; });
  await page.keyboard.down('w'); await wait(1200); await page.keyboard.up('w');
  results.patrolSpeeding = await types();
}
// licence: injuries -> ban -> banDrive fine
await clearLog(); await wait(5000);
await ev(() => { window.T.g.ctx.state.licence.clips = 0; window.__bus.emit('traffic:injury', { severity: 1, byPlayer: true, killed: false, x: 0, y: 0 }); });
await wait(4500);
await ev(() => { window.__bus.emit('traffic:injury', { severity: 1, byPlayer: true, killed: false, x: 0, y: 0 }); });
await wait(1200);
results.licenceAfter = await ev(() => window.T.g.systems.police.getLicence());
await page.screenshot({ path: join(shots, 'ban.png') });
await page.keyboard.down('w'); await wait(5500); await page.keyboard.up('w');
results.banDrive = await types();

results.errorsSoFar = errors.slice();
await browser.close();
console.log(JSON.stringify({ ...results, errors }, null, 2));
process.exit(errors.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]')) ? 1 : 0);
