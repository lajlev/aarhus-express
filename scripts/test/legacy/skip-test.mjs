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


await G(() => { const g = window.__game.scene.getScene('Game'); const b = g.ctx.systems.missions.careers.bus; b.signUp(); b.startShift(b.routes()[0].idx); const v = b.shift.vehicle; const p = v.exitPoint(); g.player.x = p.x; g.player.y = p.y; });
await wait(300); await press('e', 100); await wait(800);
const mv = (x, y) => G(([x, y]) => { const v = window.__game.scene.getScene('Game').player.vehicle; v.x = x; v.y = y; v.vx = 0; v.vy = 0; }, [x, y]);
const st = await G(() => { const j = window.__game.scene.getScene('Game').ctx.state.job; return j.stages[1]; });
await mv(st.x + 160, st.y); await wait(300); await mv(st.x + 400, st.y); await wait(600);
note('skip', await G(() => { const b = window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus; return { skipped: b.shift.skipped, pay: b.shift.pay, stage: b.shift.job.stageIndex }; }));
await G(() => { const g = window.__game.scene.getScene('Game'); g.player.exitVehicle(); g.player.x += 3000; });
await wait(1000);
await G(() => { const sh = window.__game.scene.getScene('Game').ctx.systems.missions.careers.bus.shift; sh.awayT = 44.9; });
await wait(1500);
note('away', await G(() => { const g = window.__game.scene.getScene('Game'); return { shift: !!g.ctx.systems.missions.careers.bus.shift, job: !!g.ctx.state.job, money: g.ctx.state.money, buses: g.vehicles.filter((v) => v.type === 'bus').length }; }));
await browser.close();
console.log(JSON.stringify({ errors }, null, 1));
const L = Object.fromEntries(log);
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 200) : ''}`); };
check('bus: skipping a stop is recorded with a penalty', L.skip?.skipped === 1 && L.skip.pay < 0, L.skip);
check('bus: leaving the bus ends the shift', L.away?.shift === false && L.away.job === false, L.away);
check('no console errors', !errors.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]')), errors.slice(0, 3));
process.exit(failed ? 1 : 0);

