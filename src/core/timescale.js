// Test speed mode: runs simulation time N times faster than real time (debug/test only).
// Enable with `?timescale=N` in the URL or `window.__setTimeScale(N)` at runtime. Default 1 = exactly the old behaviour.
//
// GameScene.update asks `planFrame(deltaMs)` how to advance the simulation this frame: a number of fixed
// substeps `n`, each `dt` seconds long. Systems, vehicles and the economy clock are stepped `n` times with `dt`,
// so cars move at most `dt * speed` per step and cannot tunnel through buildings at 10-20x.
// `simNow()` is the simulation clock in ms: use it instead of `scene.time.now` for game-logic cooldowns/timeouts.
// `window.__sim` exposes { scale, effective, simMs, simSeconds, frames } for test helpers (waitGameMinutes etc.).
// Rendering-only work (camera, map chunks, effects) runs once per frame with the total simulated dt.

export const MAX_SCALE = 40;
/** Largest simulation step in seconds (the game's old per-frame cap was 0.05). */
export const MAX_STEP = 0.025;
/** Substeps per frame at most; beyond this the effective scale drops instead of the frame time exploding. */
export const MAX_SUBSTEPS = 10;

let scale = 1;
let simMs = 0;
let frames = 0;
let effective = 1;

function clampScale(n) {
  n = Number(n);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SCALE) : 1;
}

export function getTimeScale() { return scale; }
export function setTimeScale(n) { scale = clampScale(n); return scale; }

/** Simulation clock in ms (advances by exactly the simulated dt). Seed it with scene.time.now at scene start. */
export function simNow() { return simMs; }
export function seedSimClock(ms) { simMs = ms || 0; }

/**
 * Decide how to advance this frame.
 * Scale 1 returns { n: 1, dt: min(delta, 0.05), total: dt }: identical to the original loop.
 * Scale N returns n = ceil(delta*N / MAX_STEP) capped to MAX_SUBSTEPS, dt = delta*N / n (<= MAX_STEP unless capped).
 */
export function planFrame(deltaMs) {
  const real = Math.min(deltaMs / 1000, 0.05);
  frames++;
  if (scale <= 1) {
    effective = scale === 1 ? 1 : scale;
    const dt = real * scale;
    simMs += dt * 1000;
    publish();
    return { n: 1, dt, total: dt, ratio: scale };
  }
  const want = real * scale;
  let n = Math.ceil(want / MAX_STEP);
  if (n > MAX_SUBSTEPS) n = MAX_SUBSTEPS;
  const dt = Math.min(want / n, MAX_STEP);
  const total = dt * n;
  simMs += total * 1000;
  effective = real > 0 ? total / real : scale;
  publish();
  return { n, dt, total, ratio: effective };
}

function publish() {
  if (typeof window === 'undefined') return;
  const s = window.__sim || (window.__sim = {});
  s.scale = scale; s.effective = effective; s.simMs = simMs; s.simSeconds = simMs / 1000; s.frames = frames;
}

// Install the URL param and the console/test hook. Safe to import in node (no window).
export function installTimeScale() {
  if (typeof window === 'undefined') return;
  try {
    const q = new URLSearchParams(window.location.search).get('timescale');
    if (q != null) setTimeScale(q);
  } catch (e) { /* ignore */ }
  window.__setTimeScale = (n) => { setTimeScale(n); publish(); return scale; };
  publish();
}
