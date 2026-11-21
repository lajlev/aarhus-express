// Game-time-faithful speed-up for scripts written against real time at timescale 1.
//
// The game runs at x1 whenever the script is NOT waiting, and at x TIMESCALE only while the script waits
// (page.waitForTimeout, page.waitForFunction, or the in-page window.__simSleep). A wait of `ms` returns once the game has
// simulated ms/1000 seconds (window.__sim, src/core/timescale.js), or after ms of real time (menus / paused game, where the
// sim does not advance). So:
//   - at x1 this is stock Playwright behaviour;
//   - at xN the game state the assertions see is the same as at x1 (every wait covers the same simulated time and the
//     round trips between waits stay x1), only reached about N times faster in wall time;
//   - timers that expire during UI round trips (key presses, evaluates) are not accelerated, so they cannot expire early.
// waitForFunction (waiting for something to HAPPEN) runs the game at xN until the condition holds.
const FLOOR_MS = 30; // real-time floor so a key can be held for a few frames

const SIM_SLEEP_SRC = (scale) => `(() => {
  if (window.__simSleep) return;
  window.__targetScale = ${scale};
  const setScale = (n) => { try { window.__setTimeScale && window.__setTimeScale(n); } catch (e) {} };
  window.__simSleep = (ms) => new Promise((resolve) => {
    const t0 = performance.now(), s0 = window.__sim ? window.__sim.simSeconds : null, floor = Math.min(ms, ${FLOOR_MS});
    if (s0 !== null) setScale(window.__targetScale);
    const done = () => { setScale(1); resolve(); };
    const tick = () => {
      const real = performance.now() - t0;
      const simDone = s0 !== null && window.__sim && (window.__sim.simSeconds - s0) * 1000 >= ms;
      if (real >= ms || (simDone && real >= floor)) return done();
      setTimeout(tick, 8);
    };
    tick();
  });
})();`;

export async function speedUp(page) {
  const scale = Number(process.env.TIMESCALE) || 1;
  await page.addInitScript(SIM_SLEEP_SRC(scale));
  if (scale <= 1) return page; // identical to stock Playwright at x1
  const realWait = page.waitForTimeout.bind(page);
  const realFn = page.waitForFunction.bind(page);
  const setScale = (n) => page.evaluate((n) => { if (window.__sim) window.__setTimeScale(n); }, n).catch(() => {});
  page.waitForTimeout = async (ms) => {
    if (!(ms > FLOOR_MS)) return realWait(ms);
    try { await page.evaluate((m) => (window.__simSleep ? window.__simSleep(m) : new Promise((r) => setTimeout(r, m))), ms); }
    catch { await realWait(ms); } // page navigating/closing
  };
  page.waitForFunction = async (...args) => {
    await setScale(scale);
    try { return await realFn(...args); } finally { await setScale(1); }
  };
  return page;
}
