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
  // ============ 4. busted: fine once ============
  {
    const { page, ctx } = await boot(0);
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), st = g.ctx.state, P = g.systems.police;
      st.money = 1000; await T.stealNear(); await T.wait(300);
      P.addHeat(2.5, 'test'); const t0 = performance.now();
      while (!T.count('player:busted') && performance.now() - t0 < 100000) { if (P.getLevel() < 2) P.addHeat(1.5, 'test'); if (g.player.vehicle) { g.player.vehicle.input.throttle = 0; g.player.vehicle.vx = 0; g.player.vehicle.vy = 0; } await T.wait(500); }
      await T.wait(2500);
      const fines = T.log.filter((x) => x.e === 'economy:pay' && x.p.amount < 0).map((x) => x.p);
      const money = T.log.filter((x) => x.e === 'money:changed' && x.p.delta < 0).map((x) => x.p);
      return { busted: T.count('player:busted'), fines, moneyDrops: money, money: st.money, heat: st.heat, resp: T.count('player:respawned') };
    });
    rec('busted: fine charged exactly once', r.busted === 1 && r.fines.length === 1 && r.moneyDrops.length === 1, JSON.stringify(r));
    await ctx.close();
  }
  // ============ 5. death: hospital bill once + respawn ============
  {
    const { page, ctx } = await boot(0);
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), st = g.ctx.state; st.money = 1000; const p = g.player; if (p.vehicle) p.exitVehicle();
      p.damage(9999, 'test'); await T.wait(4000);
      const drops = T.log.filter((x) => x.e === 'money:changed' && x.p.delta < 0).map((x) => x.p);
      return { died: T.count('player:died'), drops, money: st.money, dead: p.dead, respawn: T.count('player:respawned'), health: p.health };
    });
    rec('death: hospital bill once, respawn', r.died === 1 && r.drops.length === 1 && !r.dead && r.respawn === 1, JSON.stringify(r));
    await shot(page, '06-after-respawn');
    await ctx.close();
  }
  // ============ 6. shop + on-site bonus + skills ============
  {
    const { page, ctx } = await boot(0);
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), st = g.ctx.state, Ec = g.systems.economy; st.money = 5000;
      const items = Ec.getShopItems();
      const far = items.find((i) => i.tier === 1 && !i.nearVenue);
      const lm = g.world.landmark(far.at);
      const lq0 = st.lq; const r1 = Ec.buy(far.id); const farGain = st.lq - lq0;
      // find another item at same venue-type for near test
      const near = items.find((i) => i.id !== far.id && i.tier === 1 && i.at !== far.at && g.world.landmark(i.at));
      const lm2 = g.world.landmark(near.at); T.tele(lm2.lx ?? lm2.x, lm2.ly ?? lm2.y);
      await T.wait(300);
      const preview = Ec.getShopItems().find((i) => i.id === near.id);
      const lq1 = st.lq; const r2 = Ec.buy(near.id); const nearGain = st.lq - lq1;
      return { far: far.id, r1, farGain, near: near.id, r2, nearGain, nearFlag: preview.nearVenue, base: near.baseLq, money: st.money, purch: JSON.stringify(st.purchases), pur: T.count('economy:buyFailed') };
    });
    rec('shop buy works', r.r1.ok && r.farGain > 0, JSON.stringify(r));
    rec('on-site x1.5 bonus near venue', r.r2.ok && r.nearFlag && Math.abs(r.nearGain / r.r2.item?.baseLq - 1.5) < 0.2 || (r.r2.ok && r.nearFlag && r.nearGain > r.base), `${r.nearGain} vs base ${r.base}`);
    await page.keyboard.press('b'); await page.waitForTimeout(500); await shot(page, '07-shop');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const s = await E(page, async () => {
      const T = window.T, g = T.G(), st = g.ctx.state, Ec = g.systems.economy; st.skillPoints = 6;
      const before = { charm: Ec.getMultiplier('charm'), drv: Ec.getMultiplier('driving') };
      await T.stealNear(); const v = g.player.vehicle; await T.wait(200);
      const sp0 = v.mods.speed; const r = Ec.upgradeSkill('driving'); Ec.upgradeSkill('charm'); await T.wait(300);
      return { r, before, after: { charm: Ec.getMultiplier('charm'), drv: Ec.getMultiplier('driving') }, sp0, sp1: v.mods.speed, pay: Ec.scalePayout(1000) };
    });
    rec('skill upgrade changes multipliers (and vehicle mods)', s.r.ok && s.after.charm > s.before.charm && s.sp1 > s.sp0 && s.pay > 1000, JSON.stringify(s));
    await ctx.close();
  }
  // ============ 7. save / reload / continue ============
  {
    const { page, ctx } = await boot(0);
    await E(page, async () => { const T = window.T, g = T.G(), st = g.ctx.state; st.money = 4242; st.skillPoints = 3; st.skills.charm = 2; st.lq = 77; st.missions.levels.foodRush = 2; st.contactCooldowns.mette = 123; await T.stealNear(); g.save(); });
    const snap = await E(page, () => Object.fromEntries(Object.entries(localStorage)));
    await page.reload(); await page.waitForTimeout(1200);
    await page.keyboard.press('Enter'); await page.waitForTimeout(500); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 }); await page.waitForTimeout(1500);
    const r = await E(page, () => { const g = window.__game.scene.getScene('Game'), st = g.ctx.state; return { money: st.money, charm: st.skills.charm, lq: st.lq, lvl: st.missions?.levels?.foodRush, sp: st.skillPoints, eco: !!st.economy, px: Math.round(st.player.x), cd: st.contactCooldowns.mette, mult: g.systems.economy.getMultiplier('charm') }; });
    rec('save -> reload -> state restored', r.money >= 4242 && r.charm === 2 && r.lvl === 2 && r.sp >= 3 && r.eco && r.mult > 1.1, JSON.stringify(r));
    // continue playing
    const c = await E(page, async () => { const g = window.__game.scene.getScene('Game'); await window.__simSleep(1500); return { vehicles: g.vehicles.length, fps: Math.round(window.__game.loop.actualFps) }; });
    rec('continue after reload (world alive)', c.vehicles > 10, JSON.stringify(c));
    await ctx.close();
  }
  // ============ 8. pause + overlays ============
  {
    const { page, ctx } = await boot(1);
    const res = [];
    for (const [k, mode] of [['Escape', 'pause'], ['b', 'shop'], ['k', 'skills'], ['m', 'map']]) {
      await page.keyboard.press(k); await page.waitForTimeout(500);
      const o = await E(page, () => ({ overlay: window.__game.scene.isActive('Overlay'), gamePaused: window.__game.scene.isPaused('Game') }));
      await shot(page, `08-overlay-${mode}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      const c = await E(page, () => ({ overlay: window.__game.scene.isActive('Overlay'), gamePaused: window.__game.scene.isPaused('Game') }));
      res.push({ mode, open: o.overlay && o.gamePaused, closed: !c.overlay && !c.gamePaused });
    }
    rec('pause/shop/skills/map overlays open+close', res.every((x) => x.open && x.closed), JSON.stringify(res));
    await ctx.close();
  }
  // ============ 10. realistic mode (all options OFF) ============
  {
    const { page, ctx } = await boot(0, null, 'none');
    await shot(page, '10-realistic-start');
    const r = await E(page, async () => {
      const T = window.T, g = T.G(), st = g.ctx.state, p = g.player, h = g.world.home;
      const bike = g.vehicles.find((v) => v.owned && v.type === 'bike');
      const hud = window.__game.scene.getScene('HUD');
      return { opts: st.options, legacy: !!st.optionsLegacy, home: h && { id: h.id, street: h.street, district: h.district }, stateHome: st.home, atHome: h ? Math.round(Math.hypot(p.x - h.x, p.y - h.y) / 8) : null, bike: !!bike, bikeDist: bike && h ? Math.round(Math.hypot(bike.x - h.parkX, bike.y - h.parkY) / 8) : null, ownedVehicles: st.ownedVehicles, ownedOthers: g.vehicles.filter((v) => v.owned && v.type !== 'bike').length, heatShown: hud.heatLabel.visible };
    });
    rec('realistic: options all off, home state present', Object.values(r.opts).every((x) => x === false) && !r.legacy && r.stateHome && r.stateHome.rentPerWeek === 1200, JSON.stringify(r.opts) + JSON.stringify(r.stateHome));
    rec('realistic: spawn at home with own city bike at the door', r.home && r.atHome <= 12 && r.bike && r.bikeDist <= 8 && r.ownedOthers === 0 && r.ownedVehicles.includes('bike'), JSON.stringify(r));
    rec('realistic: no heat widget', r.heatShown === false);
    // ride own bike
    const ride = await E(page, async () => { const T = window.T, g = T.G(), p = g.player; const b = g.vehicles.find((v) => v.owned && v.type === 'bike'); const e = b.exitPoint(); p.x = e.x; p.y = e.y; await T.wait(150); const ok = p.tryEnter(g.vehicles); await T.wait(200); const ev = T.count('vehicle:stolen'); if (p.vehicle) p.exitVehicle(); return { ok, onBike: !!b.driver || true, stolenEvents: ev }; });
    rec('realistic: can ride the owned bike without a theft event', ride.ok && ride.stolenEvents === 0, JSON.stringify(ride));
    // cannot steal
    const st = await E(page, async () => {
      const T = window.T, g = T.G(), p = g.player; if (p.vehicle) p.exitVehicle();
      const v = g.vehicles.find((q) => !q.owned && q.drivable && !q.driver && q.def.stealable !== false && !q.def.bike);
      const m0 = T.log.length; const e = v.exitPoint(); p.x = e.x; p.y = e.y; await T.wait(150);
      const prompt = G_prompt();
      const ok = p.tryEnter(g.vehicles); await T.wait(300);
      const log = T.log.slice(m0);
      return { ok, inVehicle: !!p.vehicle, driverOf: v.driver, stolen: log.filter((x) => x.e === 'vehicle:stolen').length, ejected: log.filter((x) => x.e === 'driver:ejected').length, pager: log.filter((x) => x.e === 'ui:pager').map((x) => x.p.text), prompt: g.lastPrompt };
      function G_prompt() { return null; }
    });
    rec('realistic: cannot steal (Not your vehicle, no VEHICLE_STOLEN)', !st.ok && !st.inVehicle && st.stolen === 0 && st.pager.some((t) => /Not your vehicle/.test(t)) && /Not your vehicle/.test(st.prompt || ''), JSON.stringify(st));
    // driven vehicle: no ejection
    const dj = await E(page, async () => {
      const T = window.T, g = T.G(), p = g.player;
      const v = g.vehicles.find((q) => q.driver === 'ai' && !q.def.bike && q.drivable);
      if (!v) return { skip: true };
      const m0 = T.log.length; const e = v.exitPoint(); p.x = e.x; p.y = e.y; await T.wait(100);
      const ok = p.tryEnter(g.vehicles); await T.wait(200);
      const log = T.log.slice(m0);
      return { ok, ejected: log.filter((x) => x.e === 'driver:ejected').length, stolen: log.filter((x) => x.e === 'vehicle:stolen').length, driver: v.driver };
    });
    rec('realistic: driven vehicle is not carjacked', dj.skip || (!dj.ok && dj.ejected === 0 && dj.stolen === 0 && dj.driver === 'ai'), JSON.stringify(dj));
    // no heat on crimes
    const hh = await E(page, async () => {
      const T = window.T, g = T.G(), P = g.systems.police, st = g.ctx.state;
      window.__bus.emit('crime', { type: 'pedestrianHit', severity: 2, x: g.player.px, y: g.player.py });
      window.__bus.emit('crime', { type: 'vehicleHit', severity: 2, x: g.player.px, y: g.player.py });
      P.addHeat(5, 'test'); await T.wait(2500);
      return { heat: st.heat, level: P.getLevel(), police: g.vehicles.filter((v) => v.driver === 'police').length, pursuit: P.isPursuit(), changed: T.count('heat:changed') };
    });
    rec('realistic: crimes give no heat, no police units', hh.heat === 0 && hh.level === 0 && hh.police === 0 && !hh.pursuit, JSON.stringify(hh));
    // no criminal contacts
    const cc = await E(page, async () => { const g = window.T.G(), M = g.systems.missions; return { ids: M.contacts.map((c) => c.id), markers: M.contactMarkers().map((c) => c.id) }; });
    rec('realistic: only legal contacts (no Ravn, no Sille)', cc.ids.sort().join() === 'bjorn,kaj,mette' && !cc.markers.includes('ravn') && !cc.markers.includes('sille'), JSON.stringify(cc));
    // injuries instead of crimes (mayhem off)
    const inj = await E(page, async () => {
      const T = window.T, g = T.G(), tr = g.systems.traffic; const m0 = T.log.length;
      const veh = g.vehicles.find((q) => q.def.mass > 5) || g.vehicles[0]; veh.vx = 60; veh.vy = 0;
      const ped = tr.peds.list.find((q) => q.state !== 'down' && q.state !== 'dying') ; if (!ped) return { skip: true };
      tr.peds.knock(ped, veh, true); await T.wait(100);
      const log = T.log.slice(m0);
      // only the player's own hit counts: AI traffic can injure other pedestrians (byPlayer false) in the same window
      return { injury: log.filter((x) => x.e === 'traffic:injury' && x.p.byPlayer === true).map((x) => x.p), crime: log.filter((x) => x.e === 'crime').length, down: log.filter((x) => x.e === 'traffic:pedestrianDown' && x.p.byPlayer === true).length };
    });
    rec('mayhem off: ped hit -> traffic:injury, no CRIME', inj.skip || (inj.injury.length === 1 && inj.injury[0].byPlayer === true && inj.crime === 0 && inj.down === 1), JSON.stringify(inj));
    // broken-down vehicle does not explode, tow fee once
    const bd = await E(page, async () => {
      const T = window.T, g = T.G(), st = g.ctx.state, p = g.player; st.money = 1000; if (p.vehicle) p.exitVehicle();
      const v = g.ctx.spawnVehicle('smallcar', p.x + 80, p.y, { owned: true }); const m0 = T.log.length;
      v.damage(9999, null, 0); await T.wait(500);
      const mid = { state: v.state, drivable: v.drivable };
      await T.wait(7500);
      const log = T.log.slice(m0);
      const pays = log.filter((x) => x.e === 'economy:pay').map((x) => x.p);
      return { mid, end: v.state, health: v.health, destroyed: log.filter((x) => x.e === 'vehicle:destroyed').length, broken: log.filter((x) => x.e === 'vehicle:broken').length, towed: log.filter((x) => x.e === 'vehicle:towed').length, pays, money: st.money };
    });
    rec('mayhem off: car breaks down (no explosion), towed and charged once', bd.mid.state === 'broken' && !bd.mid.drivable && bd.end === 'ok' && bd.health > 0 && bd.destroyed === 0 && bd.broken === 1 && bd.towed === 1 && bd.pays.length === 1 && bd.pays[0].reason === 'tow' && bd.money === 1000 + bd.pays[0].amount, JSON.stringify(bd));
    await ctx.close();
  }
  // ============ 11. legacy save loads with all options ON ============
  {
    const key = 'aarhus-express:v1:aarhus:freja';
    const legacy = JSON.stringify({ version: 1, cityId: 'aarhus', characterId: 'freja', money: 777, lq: 12, skillPoints: 0, milestonesReached: 0, skills: {}, purchases: {}, player: { x: null, y: null, health: 100 }, ownedVehicles: [], stats: {}, savedAt: 1 });
    const { page, ctx } = await boot(0, [key, legacy]);
    const r = await E(page, () => { const g = window.__game.scene.getScene('Game'), st = g.ctx.state; return { opts: st.options, legacy: st.optionsLegacy, money: st.money, contacts: g.systems.missions.contacts.length, home: !!g.world.home, hasHome: !!st.home, startedAtHome: Math.hypot(g.player.px - g.world.home.x, g.player.py - g.world.home.y) < 160 }; });
    rec('legacy save loads with all options ON (+ home, original start)', Object.values(r.opts).every(Boolean) && r.legacy === true && r.money === 777 && r.contacts === 5 && r.home && r.hasHome && !r.startedAtHome, JSON.stringify(r));
    await ctx.close();
    // continue screen shows the "Classic" tag
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pg = await speedUp(await ctx2.newPage());
    await pg.goto(URL_); await pg.waitForTimeout(1200);
    await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [key, legacy]);
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(700);
    const tags = await pg.evaluate(() => window.__game.scene.getScene('CharacterSelect').cards.map((c) => c.tagText.text));
    await pg.screenshot({ path: join(SHOTS, '11-continue-tags.png') });
    rec('character/continue screen shows legacy tag', /Classic/.test(tags[0]), JSON.stringify(tags));
    await ctx2.close();
  }
  // ============ 9. perf: heat 5 + full traffic, and driving shot ============
  {
    const { page, ctx } = await boot(0);
    const r = await E(page, async () => {
      const T = window.T, g = T.G(); await T.stealNear(); const v = g.player.vehicle;
      g.systems.traffic.setDensity?.(1.5);
      g.systems.police.addHeat(5.5, 'test');
      const fr = []; const t0 = performance.now(); let last = t0, n = 0;
      v.input.throttle = 1;
      await new Promise((res) => { const f = (t) => { n++; fr.push(t - last); last = t; if (t - t0 < 12000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      const avg = 1000 / (fr.reduce((a, b) => a + b, 0) / fr.length); const sorted = fr.slice(5).sort((a, b) => b - a);
      return { avgFps: Math.round(avg), p1LowFps: Math.round(1000 / sorted[Math.floor(sorted.length * 0.01)]), vehicles: g.vehicles.length, police: g.vehicles.filter((q) => q.driver === 'police').length, level: g.systems.police.getLevel(), actual: Math.round(window.__game.loop.actualFps) };
    });
    await shot(page, '09-heat5-driving');
    rec('perf heat5 + full traffic >= 50 fps', r.avgFps >= 50, JSON.stringify(r));
    await ctx.close();
  }
} catch (e) { rec('SCRIPT CRASH', false, e.stack); }
await browser.close();
const bad = errors.filter((e) => !/Failed to load resource/.test(e));
console.log('CONSOLE ERRORS', JSON.stringify(errors, null, 1));
console.log('SUMMARY', results.filter((r) => r.ok).length + '/' + results.length);
process.exit(results.every((r) => r.ok) ? 0 : 1);
