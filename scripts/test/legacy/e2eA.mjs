// Aarhus Express end-to-end QA. Usage: node e2e.mjs [url]   (production preview)
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { speedUp } from '../lib/speed.mjs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const URL_ = process.argv[2] || process.env.TEST_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || 'screenshots/test/legacy';
mkdirSync(SHOTS, { recursive: true });
function findChrome() {
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  for (const d of readdirSync(root).sort().reverse()) for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) { const p = join(root, d, rel); if (existsSync(p)) return p; }
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const results = []; const errors = [];
const rec = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(ok ? 'PASS' : 'FAIL', name, info); };

const HELPERS = `
window.T = (() => {
  const G = () => window.__game.scene.getScene('Game');
  const wait = (ms) => window.__simSleep(ms);
  const log = []; window.__log = log;
  for (const e of ['economy:pay','money:changed','player:busted','player:died','player:respawned','police:escaped','police:pursuit','job:completed','job:failed','job:offered','job:started','mission:accepted','mission:target','mission:timer','mission:loading','mission:cargo','mission:hint','economy:milestone','economy:buyFailed','crime','traffic:honk','traffic:pedestrianDown','traffic:carPanic','police:searching','vehicle:stolen','driver:ejected','vehicle:destroyed','vehicle:broken','vehicle:towed','traffic:injury','ui:pager'])
    window.__bus.on(e, (p) => { log.push({ e, t: Math.round(performance.now()), p: JSON.parse(JSON.stringify(p || {}, (k, v) => (k === 'job' || k === 'vehicle' || k === 'other' || k === 'scene') ? (v && v.title) || undefined : v)) }); });
  const count = (e, f) => log.filter((x) => x.e === e && (!f || f(x.p))).length;
  const tele = (x, y) => { const g = G(), p = g.player; if (p.vehicle) { p.vehicle.x = x; p.vehicle.y = y; p.vehicle.vx = 0; p.vehicle.vy = 0; } else { p.x = x; p.y = y; } };
  const stealNear = async () => {
    const g = G(), p = g.player; if (p.vehicle) p.exitVehicle();
    const v = g.vehicles.find((q) => !q.owned && q.drivable && !q.driver && q.def.stealable !== false && !q.def.bike && q.def.capacity >= 2) || g.vehicles.find((q) => q.drivable && !q.driver);
    const e = v.exitPoint(); p.x = e.x; p.y = e.y; await wait(150); p.tryEnter(g.vehicles); await wait(150); return v;
  };
  const driveJob = async (maxMs = 60000, opts = {}) => {
    const g = G(), M = g.systems.missions, p = g.player; const t0 = performance.now();
    while (M.job && performance.now() - t0 < maxMs) {
      const j = M.job, s = j.stages[j.stageIndex], t = M.targetPoint();
      if (s.action === 'lose') {
        if (p.vehicle) { const w = g.world; const n = w.drive.randomNodeInRing(p.px, p.py, 4000, 9000); if (n >= 0 && !opts.stay) tele(w.drive.x[n], w.drive.y[n]); }
        await wait(1000); continue;
      }
      if (!t) { await wait(300); continue; }
      if (s.action === 'enter' || s.action === 'steal') {
        if (p.vehicle && !(s.vehicle && p.vehicle === s.vehicle)) p.exitVehicle();
        if (!p.vehicle) { const v = s.vehicle || g.vehicles.find((q) => q.type === s.vehicleType && !q.driver); const e = v.exitPoint(); p.x = e.x; p.y = e.y; await wait(200); p.tryEnter(g.vehicles); }
        await wait(300); continue;
      }
      if (!p.vehicle) { await stealNear(); }
      tele(t.x, t.y); await wait(250);
      if (p.vehicle) { p.vehicle.vx = 0; p.vehicle.vy = 0; }
      await wait(s.action === 'pickup' ? 1900 : 600);
    }
    return !M.job;
  };
  return { G, wait, log, count, tele, stealNear, driveJob };
})();`;

async function boot(charIdx = 0, save, opts = 'all') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await speedUp(await ctx.newPage());
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(URL_); await page.waitForTimeout(1200);
  if (save) await page.evaluate(([k, v]) => localStorage.setItem(k, v), save);
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  for (let i = 0; i < charIdx; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  // new game -> NewGameScene (skipped when a save exists). Toggle options with the keyboard.
  const onNewGame = await page.evaluate(() => window.__game.scene.isActive('NewGame'));
  if (onNewGame) {
    for (let i = 0; i < 3; i++) {
      if (opts === 'all') { await page.keyboard.press('Space'); await page.waitForTimeout(150); }
      await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
    }
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(HELPERS);
  return { page, ctx };
}
const shot = (page, n) => page.screenshot({ path: join(SHOTS, n + '.png') });
const hudText = (page) => page.evaluate(() => window.__game.scene.getScene('HUD').children.list.filter((c) => c.type === 'Text' && c.visible && c.text).map((c) => c.text).join(' | '));
const E = (page, fn, ...a) => page.evaluate(fn, ...a);

try {
  // ============ 1. order flow + HUD DELIVERED + payment once ============
  {
    const { page, ctx } = await boot(0);
    await shot(page, '01-character-spawn');
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), M = g.systems.missions, st = g.ctx.state;
      const m0 = st.money; await T.stealNear(); await T.wait(400);
      const offered = !!M.offer; const title = M.offer?.job.title;
      M.accept(); await T.wait(300);
      return { offered, title, accepted: !!M.job, m0, crimes: T.count('crime') };
    });
    rec('steal car -> order offered', r.offered, r.title);
    rec('accept -> job active', r.accepted);
    await shot(page, '02-order-active');
    const done = await E(page, async () => { const T = window.T; const hud = window.__game.scene.getScene('HUD'); window.__ban = ''; const iv = setInterval(() => { if (hud.banner.visible) window.__ban += hud.bannerTitle.text + ';'; }, 100); const ok = await T.driveJob(60000, { stay: true }); await T.wait(600); clearInterval(iv); return ok; });
    await page.waitForTimeout(300);
    const info = await E(page, () => { const T = window.T, st = T.G().ctx.state; const pays = T.log.filter((x) => x.e === 'economy:pay').map((x) => x.p); return { money: st.money, deliveries: st.stats.deliveries, pays, completed: T.count('job:completed') }; });
    const txt = await E(page, () => window.__ban);
    await shot(page, '03-delivered');
    rec('deliver -> completed once, paid once', done && info.completed === 1 && info.pays.filter((p) => p.amount > 0).length === 1, JSON.stringify(info));
    rec('HUD shows DELIVERED', /DELIVERED/.test(txt), txt.slice(0, 120));
    await ctx.close();
  }
  // ============ 2. capacity mismatch ============
  {
    const { page, ctx } = await boot(0);
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), M = g.systems.missions;
      await T.stealNear(); await T.wait(300); M.accept(); await T.wait(200);
      const j = M.job; j.stages[0].requires = { capacity: 9 };
      const s = j.stages[0]; T.tele(s.x, s.y); await T.wait(2500);
      const stuck = M.job.stageIndex === 0 && !M.job.loaded; const hint = T.count('mission:hint');
      j.stages[0].requires = { capacity: 1 }; await T.wait(2500);
      return { stuck, hint, after: M.job ? M.job.stageIndex : 'done' };
    });
    rec('capacity mismatch blocks pickup, hint shown, resolves after', r.stuck && r.hint > 0 && r.after !== 0, JSON.stringify(r));
    await ctx.close();
  }
  // ============ 3. contact missions ============
  const cm = { mette: 'foodRush', bjorn: 'movingHelp', kaj: 'taxiFare', ravn: 'smuggle', sille: 'stealModel' };
  for (const [cid, tpl] of Object.entries(cm)) {
    const { page, ctx } = await boot(0);
    const r = await E(page, async ([cid, tpl]) => {
      const T = window.T, g = T.G(), M = g.systems.missions, st = g.ctx.state;
      const c = M.contacts.find((q) => q.id === cid);
      if (g.player.vehicle) g.player.exitVehicle();
      T.tele(c.x, c.y + 20); await T.wait(900);
      const o = M.offer; if (!o) return { err: 'no offer', cd: st.contactCooldowns[cid] };
      const got = o.job.template; M.accept(); await T.wait(300);
      const m0 = st.money; const stages = M.job.stages.map((s) => s.action).join('>');
      const ok = await T.driveJob(90000);
      await T.wait(400);
      return { got, stages, ok, paid: st.money - m0, missions: st.stats.missions, completed: T.count('job:completed'), failed: T.count('job:failed'), escaped: T.count('police:escaped'), heat: st.heat, levels: JSON.stringify(st.missions.levels), pays: T.log.filter((x) => x.e === 'economy:pay').length };
    }, [cid, tpl]);
    rec(`mission ${tpl}`, !r.err && r.ok && r.completed === 1 && r.failed === 0 && r.paid > 0, JSON.stringify(r));
    if (tpl === 'smuggle' || tpl === 'stealModel') await shot(page, `04-mission-${tpl}`);
    await ctx.close();
  }
  // hotCar needs completed smuggle? contact ravn rotates by completedLevels: pre-set smuggle level to 1
  {
    const { page, ctx } = await boot(0);
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), M = g.systems.missions, st = g.ctx.state;
      st.missions.levels.smuggle = 1;
      const c = M.contacts.find((q) => q.id === 'ravn');
      T.tele(c.x, c.y + 20); await T.wait(900);
      const o = M.offer; if (!o) return { err: 'no offer' };
      if (o.job.template !== 'hotCar') return { err: 'got ' + o.job.template };
      M.accept(); await T.wait(300);
      const m0 = st.money;
      // drive until lose stage
      const t0 = performance.now(); let loseSeen = false, heatMax = 0;
      while (M.job && performance.now() - t0 < 150000) {
        const s = M.job.stages[M.job.stageIndex];
        if (s.action === 'lose') { loseSeen = true; heatMax = Math.max(heatMax, st.heat); break; }
        await T.driveJob(1500); heatMax = Math.max(heatMax, st.heat);
      }
      window.__heatShot = true;
      return { loseSeen, heatMax, level: g.systems.police.getLevel(), units: g.vehicles.filter((v) => v.driver === 'police').length, m0 };
    });
    rec('hotCar reaches lose stage with heat', !r.err && r.loseSeen && r.heatMax >= 1, JSON.stringify(r));
    await page.waitForTimeout(500); await shot(page, '05-pursuit-hud');
    const r2 = await E(page, async () => {
      const T = window.T, g = T.G(), M = g.systems.missions, st = g.ctx.state;
      const t0 = performance.now();
      // flee: teleport far away repeatedly, drive on
      while (M.job && performance.now() - t0 < 170000) { await T.driveJob(2000); }
      return { ended: !M.job, escaped: T.count('police:escaped'), completed: T.count('job:completed'), failed: T.count('job:failed'), failReason: T.log.filter((x) => x.e === 'job:failed').map((x) => x.p.reason), heat: st.heat, secs: Math.round((performance.now() - t0) / 1000), cooldown: st.contactCooldowns.ravn };
    });
    rec('hotCar lose stage -> heat decays -> completed (escaped events: ' + r2.escaped + ')', r2.ended && r2.completed === 1, JSON.stringify(r2));
    // job no longer blocks offers
    const r3 = await E(page, async () => {
      const T = window.T, g = T.G(), M = g.systems.missions, st = g.ctx.state;
      const c = M.contacts.find((q) => q.id === 'sille'); st.contactCooldowns = {};
      T.tele(c.x, c.y + 20); await T.wait(1200); return { offer: M.offer?.job.template || null, job: !!M.job };
    });
    rec('contact offers resume after hotCar', r3.offer === 'stealModel', JSON.stringify(r3));
    await ctx.close();
  }
  // ============ 3b. stuck lose stage times out and unblocks offers ============
  {
    const { page, ctx } = await boot(0);
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), M = g.systems.missions, st = g.ctx.state;
      st.missions.levels.smuggle = 1;
      const c = M.contacts.find((q) => q.id === 'ravn'); T.tele(c.x, c.y + 20); await T.wait(900); M.accept(); await T.wait(200);
      const j = M.job; j.stageIndex = j.stages.length - 1; M._onStageEnter();
      g.systems.police.addHeat(4, 'test'); M._loseTotal = 148; await T.wait(1000); g.systems.police.addHeat(4, 'test'); await T.wait(3500);
      const failed = T.log.filter((x) => x.e === 'job:failed').map((x) => x.p.reason);
      st.contactCooldowns = {}; const s2 = M.contacts.find((q) => q.id === 'sille'); g.systems.police.clearHeat('test'); T.tele(s2.x, s2.y + 20); await T.wait(1200);
      return { stage: j.stages[j.stageIndex]?.action, failed, jobNow: !!M.job, offer: M.offer?.job.template || null };
    });
    rec('stuck lose stage times out, offers resume', r.failed.some((x) => /shake/.test(x)) && !r.jobNow && r.offer === 'stealModel', JSON.stringify(r));
    await ctx.close();
  }
} catch (e) { rec('SCRIPT CRASH', false, e.stack); }
await browser.close();
const bad = errors.filter((e) => !/Failed to load resource/.test(e));
console.log('CONSOLE ERRORS', JSON.stringify(errors, null, 1));
console.log('SUMMARY', results.filter((r) => r.ok).length + '/' + results.length);
process.exit(results.every((r) => r.ok) ? 0 : 1);
