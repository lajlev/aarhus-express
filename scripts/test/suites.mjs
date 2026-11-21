// Suite manifest for scripts/test/run.mjs.
//
// Fields
//   name        unique id (used by --only)
//   file        script path relative to the repo root (run with `node`)
//   args        extra argv; '{url}' = this worker's preview URL (with ?timescale=N), '{shots}' = per-suite screenshot dir
//   server      true = needs a preview server (gets TEST_URL/TIMESCALE env + the url as argv[2] unless args mention {url})
//   tags        quick (every change), full (pre-deploy), unit (node only, no browser), realistic, classic, ...
//   covers      source globs: `run.mjs --changed` runs the suite when a changed file matches
//   maxScale    highest TIMESCALE this suite is known to pass at (physics-sensitive suites stay low). Documented per suite.
//   timeoutMs   hard kill after this long (real time)
//
// Legacy scratchpad scripts are listed at their FUTURE location scripts/test/legacy/ (moved there in phase 2).
// A suite whose file does not exist yet is reported as SKIP (missing), not a failure, so the manifest can lead the files.

/** Default game speed for test runs. Phase 2 raises this after measuring (target 10-20). */
export const DEFAULT_TIMESCALE = 10;

const CORE = ['src/core/**', 'src/main.js', 'src/config.js', 'src/scenes/GameScene.js', 'src/scenes/BootScene.js', 'src/entities/**', 'src/world/**', 'index.html', 'vite.config.js', 'public/**'];
const ECON = ['src/systems/EconomySystem.js', 'src/systems/economy/**', 'src/data/home.js', 'src/data/shop.js', 'src/data/vehicles.js'];
const MISSIONS = ['src/systems/MissionSystem.js', 'src/systems/missions/**', 'src/data/missions.js', 'src/data/tasks.js', 'src/data/contacts.js'];
const TRAFFIC = ['src/systems/TrafficSystem.js', 'src/systems/traffic/**', 'src/systems/PoliceSystem.js', 'src/systems/police/**'];
const UI = ['src/scenes/**', 'src/ui/**'];

export const suites = [
  // ---- quick check: always included by --changed
  { name: 'smoke', file: 'scripts/smoke-test.mjs', server: true, tags: ['quick', 'full', 'realistic'], covers: [...CORE, ...UI, 'src/**'], always: true, maxScale: 20, timeoutMs: 90000 },

  // ---- node-only unit checks (no browser, a second or two each)
  { name: 'unit-bike', file: 'scripts/bike-terrain-test.mjs', tags: ['quick', 'full', 'unit'], covers: ['src/entities/Vehicle.js', 'src/data/vehicles.js', 'src/world/World.js'], timeoutMs: 30000 },
  { name: 'unit-audio', file: 'scripts/game-audio-test.mjs', tags: ['quick', 'full', 'unit'], covers: ['src/audio/GameAudio.js'], timeoutMs: 30000 },
  { name: 'unit-radio', file: 'scripts/radio-test.mjs', tags: ['quick', 'full', 'unit'], covers: ['src/audio/RadioPlayer.js', 'src/data/radio.js'], timeoutMs: 30000 },
  { name: 'unit-sfx', file: 'scripts/sound-effects-test.mjs', tags: ['quick', 'full', 'unit'], covers: ['src/audio/SoundEffects.js'], timeoutMs: 30000 },
  { name: 'unit-walking', file: 'scripts/walking-visual-test.mjs', tags: ['quick', 'full', 'unit'], covers: ['src/entities/WalkingVisual.js', 'src/entities/Player.js'], timeoutMs: 30000 },

  // ---- area suites
  { name: 'realistic-loop', file: 'scripts/realistic-loop.mjs', server: true, args: ['{url}', '{shots}'], tags: ['full', 'realistic', 'economy', 'missions'], covers: [...CORE, ...ECON, ...MISSIONS, 'src/systems/missions/**', 'src/data/home.js', 'src/scenes/JobAppScene.js', 'src/scenes/HUDScene.js', 'src/scenes/NewGameScene.js'], maxScale: 10, timeoutMs: 360000 },
  { name: 'tasks', file: 'scripts/tasks-test.mjs', server: true, args: ['{url}', '{shots}'], tags: ['full', 'realistic', 'missions'], covers: [...MISSIONS, 'src/ui/taskIcons.js', 'src/scenes/HUDScene.js', 'src/scenes/JobAppScene.js', 'src/scenes/OverlayScene.js'], maxScale: 10, timeoutMs: 300000 },
  { name: 'traffic-rules', file: 'scripts/traffic-rules-test.mjs', server: true, args: ['{url}', '{shots}', 'realistic'], tags: ['full', 'realistic', 'traffic'], covers: [...TRAFFIC, 'src/entities/Vehicle.js'], maxScale: 10, timeoutMs: 240000 },
  { name: 'traffic-rules-classic', file: 'scripts/traffic-rules-test.mjs', server: true, args: ['{url}', '{shots}', 'classic'], tags: ['full', 'classic', 'traffic'], covers: [...TRAFFIC, 'src/core/options.js'], maxScale: 10, timeoutMs: 240000 },

  // ---- legacy scratchpad scripts (moved to scripts/test/legacy/ in phase 2)
  { name: 'e2e-a', file: 'scripts/test/legacy/e2eA.mjs', server: true, tags: ['full', 'realistic', 'classic'], covers: [...CORE, ...ECON, ...MISSIONS, ...TRAFFIC, ...UI], maxScale: 10, timeoutMs: 360000 },
  { name: 'e2e-b', file: 'scripts/test/legacy/e2eB.mjs', server: true, tags: ['full', 'realistic', 'classic'], covers: [...CORE, ...ECON, ...MISSIONS, ...TRAFFIC, ...UI], maxScale: 10, timeoutMs: 360000 },
  { name: 'home', file: 'scripts/test/legacy/home-test.mjs', server: true, tags: ['full', 'realistic', 'economy'], covers: [...ECON, 'src/world/HomeMarker.js', 'src/scenes/OverlayScene.js'], maxScale: 10, timeoutMs: 240000 },
  { name: 'jobs', file: 'scripts/test/legacy/jobs-test.mjs', server: true, tags: ['full', 'realistic', 'missions'], covers: [...MISSIONS, 'src/scenes/JobAppScene.js', 'src/systems/economy/**'], maxScale: 10, timeoutMs: 240000 },
  { name: 'classic', file: 'scripts/test/legacy/classic-test.mjs', server: true, tags: ['full', 'classic'], covers: ['src/core/options.js', 'src/systems/PoliceSystem.js', 'src/systems/police/**', ...MISSIONS, 'src/scenes/NewGameScene.js'], maxScale: 10, timeoutMs: 240000 },
  { name: 'skip', file: 'scripts/test/legacy/skip-test.mjs', server: true, tags: ['full', 'realistic'], covers: [...ECON, 'src/systems/missions/**', 'src/scenes/HUDScene.js'], maxScale: 10, timeoutMs: 240000 },

  // ---- new (money agent)
  { name: 'money', file: 'scripts/money-test.mjs', server: true, tags: ['full', 'realistic', 'economy'], covers: ['src/systems/gambling/**', 'src/scenes/GamblingScene.js', ...ECON, 'src/core/options.js', 'src/scenes/NewGameScene.js', 'src/scenes/HUDScene.js', 'src/scenes/JobAppScene.js', 'src/systems/PoliceSystem.js'], maxScale: 10, timeoutMs: 240000 },
];

// Scale policy (measured, 4 workers): the default is x10. All 17 suites passed 3 of 3 full runs at x10 after the flaky checks
// were fixed at their root cause. At x20 everything but `tasks` passed once, but the full suite is only ~10% faster
// (wall time is bound by real-time floors and the longest suites: e2e-b, money, tasks), so there is no reason to go higher.
//   smoke         maxScale 20  short drive, no timers; passes at x20.
//   tasks         maxScale 10  at x20 a task expired during the 4-task HUD checks ("TASKS 3/4"): frames are 0.33 game seconds at x20.
//   every other   maxScale 10  verified at x10; not enough runs at x20 to promise it.
// How scripts stay faithful at x10: scripts/test/lib/speed.mjs runs the game at x1 while a script is not waiting and at xN only
// while it waits, and every wait still covers the same simulated time as at x1 (see that file). `--timescale 1` gives the old real-time run.
// The runner clamps --timescale to each suite's maxScale.

/** Files that, when changed, invalidate every quick suite (test infrastructure itself). */
export const INFRA_GLOBS = ['scripts/test/**', 'package.json', 'package-lock.json', 'vite.config.js'];
