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
for (let i = 0; i < 3; i++) { await press('Enter'); await press('ArrowDown', 60); }
await press('Enter');
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
await wait(2000);


const E = () => G(() => { const g = window.__game.scene.getScene('Game'); return { opts: g.ctx.state.options, contacts: g.ctx.systems.missions.contacts.map((c) => c.id), job: !!g.ctx.state.job }; });
note('classic', await E());
// steal-order flow
await G(() => { const g = window.__game.scene.getScene('Game'); const v = g.vehicles.find((x) => x.type === 'smallcar') || g.vehicles[0]; g.ctx.systems.missions._onStolen({ vehicle: v }); });
note('theft offer', await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; return m.offer && m.offer.job.title; }));
await press('y'); await wait(400);
note('theft job active', await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && j.title; }));
await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.abandon());
// contacts: Mette (foodRush) and Ravn (smuggle)
for (const id of ['mette', 'ravn']) {
  await G((id) => { const g = window.__game.scene.getScene('Game'); const c = g.ctx.systems.missions.contacts.find((x) => x.id === id); g.player.x = c.x; g.player.y = c.y; g.ctx.state.contactCooldowns = {}; }, id);
  await wait(800);
  note(id + ' offer', await G(() => { const m = window.__game.scene.getScene('Game').ctx.systems.missions; return m.offer && m.offer.job.title; }));
  await press('y'); await wait(400);
  for (let st = 0; st < 5; st++) {
    const s = await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j && j.stages[j.stageIndex]; });
    if (!s || s.x == null || s.action === 'enter' || s.action === 'lose') break;
    await G(([x, y]) => { const g = window.__game.scene.getScene('Game'); g.player.x = x; g.player.y = y; }, [s.x, s.y]); await wait(2400);
  }
  note(id + ' after', await G(() => { const g = window.__game.scene.getScene('Game'); return { job: g.ctx.state.job && g.ctx.state.job.title, money: g.ctx.state.money, xp: g.ctx.state.jobs.courier.xp, levels: g.ctx.state.missions.levels }; }));
  await G(() => window.__game.scene.getScene('Game').ctx.systems.missions.abandon());
}
await press('j'); await wait(400); await page.screenshot({ path: OUT + 'classic-app.png' }); await press('Escape');
await browser.close();
console.log(JSON.stringify({ errors }, null, 1));
const L = Object.fromEntries(log);
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 200) : ''}`); };
check('classic options all crime ON', L.classic?.opts?.theft && L.classic.opts.criminalMissions && L.classic.opts.mayhem, L.classic?.opts);
check('classic contacts include Ravn and Sille', ['ravn', 'sille'].every((c) => L.classic?.contacts?.includes(c)), L.classic?.contacts);
check('theft offers an order and it starts', !!L['theft offer'] && !!L['theft job active'], [L['theft offer'], L['theft job active']]);
check('Mette offers a job and it is accepted', !!L['mette offer'] && !!L['mette after']?.job, L['mette after']);
check('Ravn smuggle job completes and levels up', !!L['ravn offer'] && L['ravn after']?.levels?.smuggle === 1, L['ravn after']);
check('no console errors', !errors.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]')), errors.slice(0, 3));
process.exit(failed ? 1 : 0);

