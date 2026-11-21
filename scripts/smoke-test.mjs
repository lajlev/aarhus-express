// Headless smoke test: loads the game, goes through city + character select,
// starts a new (realistic) game, walks to a vehicle (the owned city bike), drives it, and reports console errors + screenshots.
// Usage: npm run dev (in another terminal), then npm run check [-- URL]
// Needs a Chromium: set CHROME_PATH, or have Playwright browsers installed.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { speedUp } from './test/lib/speed.mjs';

const url = process.argv[2] || process.env.TEST_URL || 'http://127.0.0.1:5173/';
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).sort().reverse()) {
      for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const SHOTS = process.env.SHOTS_DIR || 'screenshots';
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await speedUp(await browser.newPage({ viewport: { width: 1280, height: 720 } }));
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };

await page.goto(url);
await wait(1500);
await page.screenshot({ path: `${SHOTS}/1-city.png` });
await page.keyboard.press('Enter');
await wait(600);
await page.screenshot({ path: `${SHOTS}/2-character.png` });
await page.keyboard.press('Enter'); // character -> NewGameScene (new save)
await wait(600);
await page.screenshot({ path: `${SHOTS}/2b-newgame.png` });
for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await wait(150); } // down to "Start"
await page.keyboard.press('Enter'); // all options off: realistic courier game
await page.waitForFunction(() => window.__game?.scene.getScene('Game')?.player, null, { timeout: 20000 });
await wait(1500);
await page.screenshot({ path: `${SHOTS}/3-game.png` });

// teleport next to the nearest car, enter, and drive
const info = await page.evaluate(() => {
  const g = window.__game.scene.getScene('Game');
  const v = g.vehicles[0];
  if (!v) return { vehicles: 0 };
  const p = v.exitPoint();
  g.player.x = p.x; g.player.y = p.y;
  return { vehicles: g.vehicles.length };
});
await wait(300);
await hold('e', 80);
await wait(300);
const entered = await page.evaluate(() => !!window.__game.scene.getScene('Game').player.vehicle);
await hold('w', 2500);
await page.keyboard.down('w'); await hold('d', 700); await hold('Space', 500); await page.keyboard.up('w');
await wait(300);
const drive = await page.evaluate(() => {
  const g = window.__game.scene.getScene('Game');
  const v = g.player.vehicle;
  return v ? { speedKmh: Math.round(v.speedMps * 3.6), health: Math.round(v.health), x: Math.round(v.x), y: Math.round(v.y) } : null;
});
await page.screenshot({ path: `${SHOTS}/4-driving.png` });
const fps = await page.evaluate(() => Math.round(window.__game.loop.actualFps));
await page.keyboard.press('Escape');
await wait(400);
await page.screenshot({ path: `${SHOTS}/5-pause.png` });
await browser.close();

console.log(JSON.stringify({ ...info, entered, drive, fps, errors }, null, 2));
process.exit(errors.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]')) ? 1 : 0);
