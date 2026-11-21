// Shared helpers for browser suites: launch, wait for the game, new game with options, teleport, time-scale-aware waits.
//
//   import { openGame } from './lib/game.mjs';
//   const t = await openGame();                       // url from argv[2] / TEST_URL, scale from TIMESCALE
//   await t.newGame({ theft: false });                // city -> character -> NewGame (options) -> Game scene
//   await t.waitGameMinutes(5);                       // 5 in-game minutes (1 real second = 1 game minute at scale 1)
//   t.check('name', cond, info);  process.exit(t.finish());
import { launchBrowser, IGNORED_CONSOLE } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const env = {
  url: () => process.env.TEST_URL || process.argv[2] || 'http://127.0.0.1:4173/',
  timescale: () => Math.max(1, Number(process.env.TIMESCALE) || 1),
  shots: (def = 'screenshots/test') => process.env.SHOTS_DIR || def,
};

/** Add ?timescale=N to a URL (keeps any existing query). */
export function withScale(url, scale) {
  if (!scale || scale === 1) return url;
  const u = new URL(url);
  u.searchParams.set('timescale', String(scale));
  return u.toString();
}

export async function openGame({ url = env.url(), scale = env.timescale(), shotsDir = env.shots(), viewport = { width: 1280, height: 720 } } = {}) {
  mkdirSync(shotsDir, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED_CONSOLE.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(withScale(url, scale));
  const G = (fn, arg) => page.evaluate(fn, arg);
  let pass = 0, fail = 0;

  const t = {
    page, browser, errors, scale, G,
    wait: (ms) => page.waitForTimeout(ms), // real time: UI settling, key spacing. Use waitGameMinutes/waitSim for game time.
    press: async (k, ms = 80) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(150); },
    shot: (name) => page.screenshot({ path: join(shotsDir, name + '.png') }),
    check(name, ok, info) {
      if (ok) pass++; else fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 220) : ''}`);
      return ok;
    },
    /** Exit code for process.exit(): 1 when a check failed or the page logged an error. */
    finish() {
      const bad = errors.filter((e) => e.startsWith('[pageerror]') || e.startsWith('[error]'));
      if (bad.length) console.log('CONSOLE ERRORS', JSON.stringify(bad.slice(0, 10)));
      console.log(`RESULT ${pass} passed, ${fail} failed, ${bad.length} console errors`);
      return fail || bad.length ? 1 : 0;
    },
    async close() { await browser.close(); },

    /** Simulated seconds since the page loaded (window.__sim, installed by src/core/timescale.js). */
    simSeconds: () => G(() => window.__sim?.simSeconds ?? 0),
    setScale: (n) => G((n) => window.__setTimeScale?.(n), n),
    /** Wait until `s` simulated seconds have passed. Falls back to scaled wall time when __sim is missing. */
    async waitSim(s, { timeout = Math.max(15000, (s / Math.max(1, scale)) * 4000 + 10000) } = {}) {
      const has = await G(() => !!window.__sim);
      if (!has) return page.waitForTimeout((s * 1000) / scale);
      const t0 = await t.simSeconds();
      await page.waitForFunction((end) => (window.__sim?.simSeconds ?? 0) >= end, t0 + s, { timeout, polling: 50 });
    },
    /** Wait `n` in-game minutes (economy clock: 1 simulated second = 1 game minute). */
    waitGameMinutes: (n) => t.waitSim(n),
    /** Poll a page-side predicate (function or source string) until truthy; `timeout` is real ms. */
    waitFor: (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }),

    async waitForGame(timeout = 20000) { await t.waitFor(() => window.__game?.scene.getScene('Game')?.player, null, timeout); },
    /**
     * City -> character -> NewGameScene -> Start. `options` = { theft, criminalMissions, mayhem } toggles (default all off).
     * Phase 2: the options are applied through the NewGameScene keyboard UI exactly like the smoke test (no state poking).
     */
    async newGame(options = {}) {
      await t.wait(1500);
      await t.press('Enter'); await t.wait(500);
      await t.press('Enter'); await t.wait(600);
      // NewGameScene lists the options first, then "Start" (3 options -> 3x ArrowDown reaches Start); toggle with Space/Enter.
      const names = ['theft', 'criminalMissions', 'mayhem'];
      for (let i = 0; i < names.length; i++) {
        if (options[names[i]]) { await t.press('Enter', 60); }
        await t.press('ArrowDown', 60);
      }
      await t.press('Enter');
      await t.waitForGame();
      await t.waitSim(1);
    },
    /** Move the player (or the vehicle they drive) to world px (x, y). */
    teleport: (x, y) => G(([x, y]) => { const p = window.__game.scene.getScene('Game').player; const o = p.vehicle || p; if (p.vehicle) { o.x = x; o.y = y; o.vx = 0; o.vy = 0; } else { p.x = x; p.y = y; } }, [x, y]),
    /** Hold a key for `s` simulated seconds (game time), e.g. driving. */
    async holdSim(key, s) { await page.keyboard.down(key); try { await t.waitSim(s); } finally { await page.keyboard.up(key); } },
    state: () => G(() => { const c = window.__game.scene.getScene('Game').ctx; return { money: c.state.money, clock: c.state.economy.clock, options: c.state.options }; }),
  };
  return t;
}
