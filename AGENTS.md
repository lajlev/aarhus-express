# AGENTS.md — Aarhus Express

Instructions for AI coding agents (Codex, Claude Code and others) working in this repo. `CLAUDE.md` imports this file, so both tools follow the same rules. Edit this file, not `CLAUDE.md`.

## What this is

A top-down open-city courier game set in real Aarhus, Denmark. **The default game is a realistic courier life with no crime**: you rent a cheap basement room (`state.home`), own a city bike, earn money from honest jobs (courier, taxi and bus shifts via the J job app) and pay weekly rent and buy or rent better vehicles. There is a shop of local "fun stuff" that raises Life Quality (LQ), and LQ milestones unlock skill points.

Work is organised as **tasks**: `MissionSystem` keeps up to 4 accepted jobs (courier orders, street gigs, quick challenges, shifts) with one tracked (Tab cycles); `systems/missions/tasks/` (TaskBoard) spawns street gigs around the player, city events (concert, match, bar rush, rain, Christmas market) and challenges, and lists everything nearby for the HUD stack, the J app Tasks tab and the M map. Read the "Tasks" section of `ARCHITECTURE.md` before touching it, and run `node scripts/tasks-test.mjs <url>` after changes.

Crime is opt-in "game options" chosen once in `NewGameScene` when a new game starts, all OFF by default: `theft` (steal vehicles, every stolen vehicle offers an order), `criminalMissions` (Ravn and Sille) and `mayhem` (hit pedestrians and explode cars without penalty). **Police heat (1-5) and pursuit are not an option of their own**: they are active only when theft or criminalMissions is on (`pursuitEnabled()`). Old saves load with all options ON.

Always go through `src/core/options.js` (`opt('theft')`, `crimeEnabled()`, `pursuitEnabled()`, `playerMayUse(v)`); never read `state.options` ad hoc and never add crime-only behaviour without a gate. Test both modes: realistic (all off) and classic (all on).

- Stack: **Phaser 3.80.1 + Vite 5**, plain ES modules (no TypeScript, no framework).
- The map is generated from **OpenStreetMap** for central Aarhus (`scripts/` → `public/maps/aarhus.json`).
- Art is AI-generated original pixel art in `public/art/` (game-ready) and `art-source/` (full-size originals).

Read **`ARCHITECTURE.md`** before changing code. It covers the module map, the system contract, the event table, the state shape, file ownership and the World API.

## Commands

```bash
npm install
npm run dev                                # http://127.0.0.1:5173/
npm run build                              # production build to dist/
npm run preview                            # serves dist/ on http://127.0.0.1:4173/
npm run check                              # headless smoke test against the dev server
npm run check -- http://127.0.0.1:4173/    # smoke test the production build (preferred)
npm run fetch-map && npm run fetch-transport && npm run build-map   # re-download OSM data (+ bus/signals/taxi/shops) and rebuild the map JSON
```

`npm run check` (`scripts/smoke-test.mjs`) uses Playwright with a cached Chromium (or `CHROME_PATH`). It clicks through the menus (including NewGameScene, with a short wait between key presses, because rapid headless key presses can be dropped), starts a realistic game, rides the city bike, pauses, writes `screenshots/`, prints JSON, and exits non-zero on any console or page error.

## Definition of done

1. `npm run build` succeeds.
2. `npm run check -- <url>` reports `"errors": []`, ideally against `npm run preview` (the dev server hot-reloads on every edit, which breaks long scripted tests).
3. The feature works in a play test. For visual changes, take a screenshot and **look at it**.
4. Headless fps stays at 80 or above (it's about 110–120 today), including a heat-5 pursuit with full traffic.
5. `ARCHITECTURE.md` and `README.md` are updated if you added events, state fields, controls or public APIs.

## Code layout (short version)

```
src/main.js, src/config.js        game config, constants (PX, TEX_RES, DEPTH)
src/core/                         events.js (bus, EV, listen), state.js (state + save), options.js (game options), math.js
src/world/                        World.js (map, graphs, streetAt/districtAt/nearestLandmark),
                                  MapRenderer.js (pooled chunk RenderTextures), textures.js (art + fallbacks)
src/entities/                     Player.js, Vehicle.js
src/systems/                      TrafficSystem, PoliceSystem, MissionSystem, EconomySystem
                                  (+ traffic/, police/, missions/, economy/ subfolders)
src/scenes/                       Boot, CitySelect, CharacterSelect, NewGame, Game, HUD, Overlay, JobApp
src/ui/                           theme.js, Pager.js, taskIcons.js
src/data/                         cities, characters, vehicles, contacts, missions, tasks, shop, home
scripts/                          fetch-osm, fetch-places, build-map, landmarks, smoke-test
public/maps/aarhus.json           generated map (~2 MB), do not hand-edit
public/art/                       manifest.json (+ landmarks/manifest.json), game-ready PNGs
art-source/                       full-size originals (not shipped)
```

## Conventions

- ES modules, 2-space indent, single quotes, semicolons, **named exports only**.
- Systems talk through the event bus (`bus`, `EV`, plus the namespaced `TRAFFIC_EV`, `POLICE_EV`, `MISSION_EV` and `ECON_EV`, re-exported from `src/core/events.js`). Call another system directly only through the public methods in its header comment.
- Always subscribe with `listen(scene, ev, fn)` so listeners are removed on scene restart.
- Skill effects come from `ctx.systems.economy.getEffects()`. Never hard-code skill math in other systems.
- Money changes only through `REQUEST_PAY` events handled by EconomySystem. Don't double-charge: police charges the busted fine, and economy charges the hospital bill.
- World units are px; convert metres with `PX`. Avoid per-frame allocations in hot loops, pool sprites, and tick off-screen AI at a lower rate.
- Texture keys are stable (`veh-<type>`, `char-<id>`, `ped-N`, `marker-*`, `icon-*`, `prop-*`). New art registers under a key in `textures.js`, with a programmatic fallback.
- Generated sprites face **up**. `textures.js` rotates them to face +x when baking.
- Wrap every `localStorage` access in try/catch.
- Keep debug handles to `window.__game` (and `window.__bus`). `__game.scene.getScene('Game')` exposes `.player`, `.vehicles`, `.world`, `.systems` and `.ctx`, which is useful for scripted tests.

## Content rules (important)

- **Everything is original.** The game draws on the classic 90s overhead open-city genre, but never copy any commercial game's name, logos, characters, sprites, HUD look, fonts or music. Never name a commercial game in image prompts.
- **Keep it local to Aarhus.** Use real Aarhus streets, shops, venues and landmarks for locations (Latinerkvarteret, Mejlgade, ARoS, Dokk1, Salling, Train, Tivoli Friheden, Ceres Park, Aarhus Ø, and so on). Prefer Danish and local names, and avoid international chains.
- **Criminal parties are always fictional.** Real places may be pickup or drop-off locations only.
- The playable characters are fictional Aarhus archetypes, not real people.

## Art pipeline

- Style prompt: *"late-1990s top-down overhead city game, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no logos"*.
- Use OpenAI images (`OPENAI_API_KEY` from the environment; **never print, log or commit keys**). `gpt-image-1.5` with `background: transparent` for sprites, and `gpt-image-2` for opaque roofs, tiles and key art. The Gemini key on this machine is invalid.
- Put originals in `art-source/`, game sizes in `public/art/`, and add entries to `manifest.json` and `README.md` there. Keep `public/art` small, because it ships in `dist/`.

## Working with multiple agents

When several agents (Claude and/or Codex) work at the same time:

- Follow the **file ownership** table in `ARCHITECTURE.md`. The shared files (`state.js`, `events.js`, `options.js`, `GameScene`, `Player`, `Vehicle`, `main.js`) are **lead-only**: specialists send change requests instead of editing them. Edit only your area, coordinate through events and public APIs, and write change requests for files you don't own instead of editing them.
- Give each agent its **own dev port** (`npx vite --port 51xx --strictPort --host 127.0.0.1`) and **its own build dir** (`npx vite build --outDir <tmp dir>`). Don't run plain `npm run build` in parallel, because it writes the shared `dist/`.
- Stop any server you start. Don't kill servers you didn't start.
- Phaser and game-mechanics guidance for specialist agents is in `.claude/agents/phaser-game-dev.md`.

## Repo notes

- This folder is **not a git repository**. Don't run git commands unless the user asks for them.
- The parent folder `/Users/lajlev/Sites/lillefar/` contains other unrelated projects. Stay inside `aarhus-express/`.
- `node_modules/`, `dist/` and `screenshots/` are ignored, and `public/maps/aarhus.json` is generated.
