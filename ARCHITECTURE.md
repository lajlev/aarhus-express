# Lillefar: Aarhus Express — Architecture

Top-down open-city courier game. Phaser 3.80.1 + Vite 5. The map is built from OpenStreetMap data for central Aarhus. The default game is a realistic courier life with no crime; crime is opt-in (see **Realistic mode & options** below).

## Run and verify

```bash
npm install
npm run dev            # http://127.0.0.1:5173/
npm run build          # production build in dist/ (npm run preview serves it on :4173)
npm run check          # headless smoke test against the dev server (needs `npm run dev` running)
npm run check -- http://127.0.0.1:4173/   # smoke test the production build
```

`npm run check` (scripts/smoke-test.mjs) clicks through city and character select, enters a car, drives it, opens pause, writes screenshots to `screenshots/` and prints JSON with console errors, FPS and driving state. It exits non-zero on any page error or console error. It needs a Chromium: it finds Playwright's cached browsers in `~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`, or you can set `CHROME_PATH`.

**Definition of done for any change:** `npm run build` succeeds, `npm run check` reports `"errors": []`, and your system's feature works in a manual play test.

Debug handle: `window.__game` is the Phaser game. `__game.scene.getScene('Game')` exposes `.player`, `.vehicles`, `.world`, `.systems` and `.ctx`.

## Map pipeline

```bash
npm run fetch-map -- aarhus   # Overpass API -> data/aarhus/osm-raw.json (retries + mirrors, generic User-Agent)
npm run fetch-transport -- aarhus   # Overpass -> data/aarhus/osm-transport.json (bus stops + route relations, signals, taxi, vehicle shops)
npm run build-map -- aarhus   # raw (+ transport) -> public/maps/aarhus.json (about 2.1 MB)
node scripts/fetch-places.mjs aarhus   # optional: suburb/neighbourhood place nodes -> data/aarhus/osm-places.json (district seeds)
```

- `scripts/cities.mjs`: bounding box per city.
- `scripts/landmarks.mjs`: curated real places (ARoS, Dokk1, Rådhus, Domkirken, Den Gamle By, Godsbanen, Aarhus H, Salling, Bruuns Galleri, Aarhus Street Food, Train, Havnebad, Tivoli Friheden, Ceres Park, Latinerkvarteret, Aarhus Ø, the container harbour docks, the hospital, the police HQ, plus streets such as Mejlgade, Jægergårdsgade, Randersvej, Ringgaden, Åboulevarden and Strøget). Each one is matched by OSM name where possible; otherwise it uses approximate coordinates (the build log prints `osm`, `osm-street` or `approx`). It also has a blocklist of non-Danish chains, which are dropped from the POIs.
- Map JSON (all coordinates are integer **world px**, `scale` = 8 px per metre, origin at the north-west corner, y points down):
  - `roads: [kind, widthPx, flags(1=bridge), x0,y0,x1,y1…]`, where kind is an index into `roadKinds` (`major, tertiary, minor, service, pedestrian, footway, cycleway, busway`)
  - `buildings: [cls, x0,y0,…]` (cls 0 normal, 1 church, 2 public/culture, 3 industrial/commercial)
  - `water`, `sea`, `islands: [x0,y0,…]` polygons (the sea is built from coastline ways, closed along the bbox edge), `waterLines: [widthPx, x0,y0,…]`
  - `green: [kind, x0,y0,…]` (park, pitch, forest, cemetery, harbour)
  - `pois: [{ n, k, x, y, lx, ly }]`, where (x, y) is snapped to the nearest drive-graph node and (lx, ly) is the real location. `k` is one of cafe, food, bar, shop, culture, landmark, hotel, hospital, police or sport.
  - `landmarks: { id: { n, k, x, y, lx, ly, src } }`
  - `buildingMeta: [int]` parallel to `buildings`: kind (bits 0-3, see build-map.mjs), levels (bits 4-9), roof shape (bits 10-13); `buildingColours: {idx: rgb}` from roof:colour; `buildingNames`
  - `landmarkBuildings: { id: { sprite, mode: 'fit'|'swatch', label, lm, bi: [building idx], how } }` and `landmarkOverlays: [{ id, sprite, label, x, y, w, h, rot }]` (rooftop art, see public/art/landmarks/README.md)
  - `streets: [name]` (0 = none) and `roadStreet: [idx]` parallel to `roads`; `districts: [[name, x, y, reachBias]]` (weighted nearest seed)
  - `bikeLanes: [type, x0,y0,...]` (0 cycleway, 1 track, 2 lane, 3 shared) and `bike`: graph of cycle infrastructure (components >= 6 nodes)
  - `drive`, `walk`: graphs `{ n: [x0,y0,…], e: [a, b, oneway, widthPx, …] }` (only the largest connected component is kept). `drive.s` is a string with one base-36 char per drive edge: speed limit in km/h divided by 10
  - `busStops`, `busRoutes`, `trafficSignals` (flat `[x,y,node,…]`), `taxiStands`, `vehicleShops`: see **Realistic mode & options**

## Module map

```
src/
  main.js                 Phaser config + scene list
  config.js               constants (PX, TEX_RES, DEPTH, fonts, title)
  core/events.js          event bus `bus`, event names `EV`, listen(scene, ev, fn), pager()
  core/state.js           session.state, createInitialState, skillLevel, load/write/deleteSave
  core/options.js         game options (theft, criminalMissions, mayhem): opt(), crimeEnabled(), pursuitEnabled(), OPTION_INFO
  core/math.js            clamp, lerp, angleDiff, weightedPick, MinHeap…
  data/home.js            the basement room (lat/lon of a real Trøjborg building, rent)
  data/cities.js          cities (only Aarhus is available) + spawn/hospital/police landmark ids
  data/characters.js      5 playable characters (append up to 20)
  data/vehicles.js        vehicle types + paint colours
  data/contacts.js        mission contacts per city
  data/shop.js            fun-stuff shop items per city
  world/World.js          occupancy grid, building collision (pushOut), surfaces, LOS, road graphs + A*
  world/HomeMarker.js     world marker at the home door
  world/MapRenderer.js    on-demand baked 1024px chunks (pooled RenderTextures) + 'minimap' texture
  world/textures.js       programmatic textures (vehicles, characters, pedestrians, particles, arrow)
  world/effects.js        smoke, fire, explosion, splash particles
  entities/Vehicle.js     arcade physics, damage, burn -> explode, sink; collideVehicles()
  entities/Player.js      on foot, enter/exit/steal, driving input, health/death
  entities/WalkingVisual.js  presentation-only distance-driven footsteps, sway, shadow and eased heading
  scenes/BootScene.js     generates textures -> CitySelect
  scenes/CitySelectScene.js
  scenes/CharacterSelectScene.js   picks a character; a save continues, no save goes to NewGameScene
  scenes/NewGameScene.js  toggles-only screen for the game options (all OFF by default), creates the state, starts Game
  scenes/JobAppScene.js   phone job app overlay on J (courier, taxi, bus tabs)
  scenes/GameScene.js     world, player, vehicle registry, camera, systems loop, respawn, autosave
  scenes/HUDScene.js      HUD: money, LQ, heat, bust meter, order card, pager, minimap, banners, waypoint arrow
  scenes/OverlayScene.js  pause, shop (B), skills (K), map (M)
  ui/                     Pager.js, theme.js (HUD helpers)
  systems/TrafficSystem.js   AI traffic, parked cars, pedestrians (+ systems/traffic/)
  systems/PoliceSystem.js    heat, pursuit, roadblocks, officers, busting (+ systems/police/)
  systems/MissionSystem.js   delivery orders + contact missions, owns the [Y]/[N] keys (+ systems/missions/)
  systems/EconomySystem.js   money, shop, LQ, skills (+ systems/economy/)
scripts/  fetch-osm.mjs, build-map.mjs, cities.mjs, landmarks.mjs, smoke-test.mjs
data/aarhus/osm-raw.json   raw Overpass response (kept so the game works offline)
public/maps/aarhus.json    processed map loaded by the game
```

## System contract

Every system is a class with this interface. GameScene constructs it and updates it each frame:

```js
class XSystem {
  constructor(ctx)        // subscribe with listen(ctx.scene, EV.X, fn): auto-removed on scene shutdown
  update(dt, time)        // dt in seconds (capped at 0.05), time in ms
  destroy()               // free sprites/state; called on Game shutdown
}
```

Construction order: economy, police, missions, traffic. Update order: traffic, police, missions, economy.

`ctx` (GameCtx, see GameScene.js):

| field | meaning |
|---|---|
| `scene` | GameScene (Phaser scene for `add`, `time`, `cameras`) |
| `world` | World: `pushOut`, `surfaceAt`, `isBuilding`, `isWater`, `isRoad`, `lineOfSight`, `findFreeSpot`, `landmark(id)`, `pois`, `drive`/`walk` graphs |
| `state` | `session.state` |
| `city` | entry from data/cities.js |
| `player` | Player: `px, py, vx, vy, vehicle, capacity, health, maxHealth, dead, respawn(x,y)` |
| `vehicles` | live Vehicle array (read-only; use spawn/remove) |
| `spawnVehicle(type, x, y, { angle, color, owned, tag, driver })` | creates and registers a Vehicle |
| `removeVehicle(v)` | unregisters and destroys a Vehicle |
| `home` | `world.home` or null: `{ id, name, street, district, x, y (door), bx, by (building centre), angle, parkX, parkY }` |
| `options` | `state.options`; read it through `core/options.js` |
| `effects` | Effects (`explosion(x, y)`) |
| `systems` | `{ traffic, police, missions, economy }` for direct calls that are documented as public |

Map knowledge API on `world`: `streetAt(x, y)` (nearest named road within about 25 m or null, cached), `districtAt(x, y)`, `nearestLandmark(x, y, radiusPx)` returning `{ id, name, x, y, dist }` or null, `getBikeGraph()` (same shape as drive/walk), `getBikeLanes()` (`[{ type, pts }]`) and `buildingInfo(i)`. The HUD shows "Street · District" (plus "Near <landmark>" within 60 m) above the minimap, debounced 0.6 s with a cross-fade.

Graph API (`world.drive`, `world.walk`): `count, x[], y[], out[i] = [{to, w}]` (directed; drive respects oneway), `und[i]` (undirected), `nearest(x, y, maxPx)`, `randomNodeInRing(x, y, rMinPx, rMaxPx)`, `path(a, b)` (A* over `und`, returns node indices).

Vehicles are driven only by writing `vehicle.input = { throttle, steer, handbrake }`; `Vehicle.update` does the physics. `vehicle.driver` is `null | 'player' | 'ai' | 'police'`. AI state lives in `vehicle.ai`. `vehicle.state` is `'ok' | 'burning' | 'wreck' | 'sunk' | 'broken'` (`broken` = mayhem off: 0 health, smoking, undriveable, towed). `vehicle.owned`, `vehicle.rentedBy` (`'player'`) and `vehicle.jobVehicle` decide whether the player may use it with theft off (`vehicle.playerUsable`). `vehicle.tag` is free for mission markers.

Units: world px, with `PX = 8` px per metre. Vehicle data is in metres and m/s. `vehicle.speedMps` gives speed in metres per second.

## Event contract (core/events.js)

| event | payload | emitted by | typical listeners |
|---|---|---|---|
| `PLAYER_ENTERED_VEHICLE` | `{ vehicle, stolen, method: carjack\|parked\|own\|abandoned }` | Player | GameScene (camera), missions |
| `PLAYER_EXITED_VEHICLE` | `{ vehicle }` | Player | GameScene |
| `VEHICLE_STOLEN` | `{ vehicle, method: carjack\|parked, driverEjected }` | Player | police (heat), missions (new order) |
| `DRIVER_EJECTED` | `{ vehicle, x, y, police }` | Player | traffic (spawns a fleeing pedestrian), police if `police` |
| `VEHICLE_DAMAGED` | `{ vehicle, amount, impact, other }` | Vehicle | police (player rams police), missions (fragile cargo, taxi tips) |
| `VEHICLE_DESTROYED` | `{ vehicle, x, y, cause: explosion\|sunk }` | Vehicle | GameScene (splash damage, cleanup), effects, police, traffic |
| `VEHICLE_BROKEN` | `{ vehicle, mine }` (mayhem OFF: 0 health, no explosion; `mine` = player's own, rented, job or driven vehicle) | Vehicle | GameScene (tow), traffic (abandons AI cars) |
| `VEHICLE_TOWED` | `{ vehicle, fee, x, y, home }` | GameScene | anyone |
| `PLAYER_DAMAGED` | `{ amount, source }` | Player | HUD |
| `PLAYER_DIED` | `{ x, y, cause }` | Player | GameScene (respawn at hospital after 2.5 s), economy (bill), police (reset), missions (fail) |
| `PLAYER_RESPAWNED` | `{ x, y, where: hospital\|police }` | GameScene | anyone |
| `HORN` | `{ x, y }` | Player | traffic |
| `CRIME` | `{ type, severity, x, y }` | anyone | police |
| `HEAT_CHANGED` | `{ heat, level, prevLevel, reason }` | police | HUD |
| `BUST_PROGRESS` | `{ t }` (0..1) | police | HUD |
| `BUSTED` | `{ fine }` | police | GameScene (respawn at police station), missions (fail), HUD |
| `JOB_OFFERED` / `JOB_STARTED` / `JOB_STAGE` / `JOB_COMPLETED` / `JOB_FAILED` | `{ job, contact? , stageIndex?, payout?, reason? }` | missions | HUD |
| `traffic:honk` (`TRAFFIC_EV.HONK`) | `{ x, y, vehicle }` | traffic | police/anyone |
| `traffic:pedestrianDown` (`PED_DOWN`) | `{ x, y, killed, byPlayer, vehicle }` | traffic | anyone |
| `traffic:carPanic` (`CAR_PANIC`) | `{ vehicle, mode: flee\|angry }` | traffic | anyone |
| `traffic:injury` (`TRAFFIC_EV.INJURY`) | `{ severity: 1\|2, byPlayer, killed, x, y, vehicle }`: a pedestrian or cyclist was knocked down while **mayhem is OFF** (instead of `CRIME pedestrianHit`) | traffic | fines module (penalises `byPlayer`) |
| `police:searching` (`POLICE_EV.SEARCHING`) | `{ active, t, level, delay }` | police | HUD |
| `police:pursuit` (`POLICE_EV.PURSUIT`) | `{ active, level, units }` | police | HUD |
| `police:escaped` (`POLICE_EV.ESCAPED`) | `{ level }` (heat decayed to 0; not on bust/death) | police | missions (hotCar lose-the-police stage) |
| `police:ticket` (`POLICE_EV.TICKET`) | `{ type, fine, clips, label, text, ratingPenalty, x, y, source: camera\|patrol\|auto, bike, speedKmh?, limitKmh? }`: a traffic fine was issued (already charged once via `REQUEST_PAY` reason `fine`) | traffic rules (police/traffic) | HUD (ticket popup), jobs (courier rating, taxi tip) |
| `police:licence` (`POLICE_EV.LICENCE`) | `{ clips, banned, banLeft, maxClips, reason: clip\|ban\|ban-ended\|decay }` | traffic rules | HUD, economy (dealer), Player (refuses cars while banned) |
| `jobs:*` (`JOBS_EV`, also exported from `core/events.js`) | `signedUp {career}`, `shiftStarted {career, shift}`, `shiftEnded {career, ok, reason, pay, shift}`, `fare {job, fare, tip, km, minutes, hardBrakes}`, `fareHail {job, where}`, `busStop {index, name, served, skipped, lateness, onTime, boarded, alighted}`, `offers {offers}`, `levelUp {career, level}`, `rating {rating}` | missions/careers | job app (J), HUD |
| `economy:*` rent | `rentDue {amount, dueDay, stage: reminder\|due}`, `rentPaid {amount, paidUntilDay, auto, late}`, `rentLate {amount, daysLate, stage: late\|warning\|evicted}`, `slept {day, hour, lqGained, healed}`, `moved {tier, name, rent}`, `week {summary}` | economy (HomeService) | HUD, home overlay |
| `economy:*` vehicles | `vehicleBought {type, price, shop}`, `vehicleRented {type, days, price, shop, endsAt}`, `rentalEnded {type, shop}`, `vehicleRepaired {type, cost}`, `insurance {premium, paid}` | economy (VehicleService) | HUD, dealer overlay |
| `mission:accepted` (`MISSION_EV.ACCEPTED`) | `{ job }` | missions | HUD |
| `mission:offerCancelled` (`OFFER_CANCELLED`) | `{ job, reason: declined\|left\|busy }` | missions | HUD |
| `mission:target` (`TARGET`) | `{ x, y, name, action, stageIndex, job }` or `{ job: null }` | missions | HUD/minimap |
| `mission:timer` (`TIMER`) | `{ job, timeLeft, timeLimit }` (about 4x/s) | missions | HUD |
| `mission:loading` (`LOADING`) | `{ job, t }` | missions | HUD |
| `mission:cargo` (`CARGO`) | `{ job, damage, integrity }` | missions | HUD |
| `mission:hint` (`HINT`) | `{ text }` | missions | HUD |
| `economy:milestone` (`ECON_EV.MILESTONE`) | `{ n, lq, skillPointsGained, skillPoints }` | economy | HUD |
| `economy:buyFailed` (`BUY_FAILED`) | `{ id, reason }` | economy | Overlay |
| `economy:lqDecay` (`LQ_DECAY`) | `{ lq, delta }` | economy | HUD |
| `REQUEST_PAY` | `{ amount, reason }` (negative = charge) | anyone | economy (the only writer of money) |
| `MONEY_CHANGED` | `{ money, delta, reason }` | economy | HUD |
| `LQ_CHANGED`, `SKILL_POINT`, `SKILL_UPGRADED`, `PURCHASED` | see events.js | economy | HUD, overlay |
| `PAGER` | `{ text, from?, kind?: info\|job\|warn\|crime }` | anyone (`pager()`) | HUD feed |
| `PROMPT` | `{ text \| null }` | GameScene | HUD |
| `BANNER` | `{ text, color?, ms? }` | anyone | HUD |
| `OPEN_OVERLAY` | `{ mode: pause\|shop\|skills\|map\|jobs\|home\|dealer }` | anyone/keys | GameScene (pauses Game, launches Overlay) |
| `OVERLAY_CLOSED` | `{}` | Overlay | anyone |
| `GAME_READY` | `{ scene }` | GameScene | anyone |
| `REQUEST_SAVE` / `SAVED` | `{}` | anyone / GameScene | |

`CRIME` types in use: `pedestrianHit` and `vehicleHit` (traffic, with `severity` 1|2), `mission` (missions, for criminal jobs), plus the police's own sources (carjack, parked theft, ramming, destruction).

The namespaced constants (`TRAFFIC_EV`, `POLICE_EV`, `MISSION_EV`, `ECON_EV`) live next to their systems and are re-exported from `src/core/events.js`, so `import { TRAFFIC_EV } from '../core/events.js'` works. Only `MissionSystem` handles [Y]/[N]; the HUD only displays the hint.

Add new events to `EV` with a payload comment and add a row to this table in the same change.

## State shape (core/state.js) and owners

```js
session.state = {
  version, cityId, characterId,
  options: { theft, criminalMissions, mayhem },      // lead only; set once at new-game time, saved (core/options.js)
  optionsLegacy,                                      // true for an old save loaded as all-ON (continue screen tag)
  home: { id, rentPerWeek, paidUntilDay, tier, lateSince, evicted, remindedFor }, // HomeService; 1200 kr/week, first week prepaid; lateSince = day rent became overdue (arrears, one week max), evicted locks sleep, remindedFor = day of the last reminder
  jobs: { courier, taxi, bus },                       // careers (missions/careers/shared.js defaults): courier { xp, rating, scores, decisions, done, failed, declined, earned, lastTicket }, taxi { signed, xp, shifts, fares, earned, best }, bus { signed, xp, shifts, stops, earned, punctual }
  licence: { clips, banLeft, decayT },                // traffic rules: clips on the licence, seconds of driving ban left, clean-driving timer
  money, lq, skillPoints, milestonesReached,         // EconomySystem
  skills: { driving, stamina, charm, streetSmarts, navigation }, // EconomySystem
  purchases: { [itemId]: count }, ownedVehicles: [], // EconomySystem; no-theft games start with ['bike'], spawned at the home door each session
  heat,                                               // PoliceSystem (transient, 0..5.99)
  job, contactCooldowns: { [contactId]: ms },         // MissionSystem (job is transient; stale clocks reset on load)
  missions: { levels: { [template]: completedCount } }, // MissionSystem (saved)
  economy: { clock, cooldowns, week, lastWeek, insured, rentals: [{ uid, type, endsAt, shop }], rentalSeq, lastWakeDay }, // EconomySystem (clock = in-game minutes, new game starts Monday 08:00; week = running income/cost summary; saved)
  player: { x, y, health },                           // GameScene (written on save)
  stats: { deliveries, missions, stolen, busted, knockouts, earned, playSeconds }, // each module increments its own counters
  savedAt,
}
```

- Read effective skills with `skillLevel(state, key)` (purchased level plus character bonus). Skill effects: driving gives speed/grip/steer (already applied in Player), stamina gives run speed and max health (applied in Player), charm gives payouts, streetSmarts gives heat gain/decay, navigation gives time limits.
- Saves: localStorage key `aarhus-express:v1:<city>:<character>`, wrapped in try/catch. GameScene autosaves every 30 s, on `REQUEST_SAVE`, and on shutdown. `job` and `heat` are never saved.

## File ownership

One owner per file. To change a file you do not own, ask its owner (or the lead), or emit or listen to events instead. New files go inside your own folder. **Lead-only shared files** (`src/core/state.js`, `src/core/events.js`, `src/core/options.js`, `src/scenes/GameScene.js`, `src/entities/Player.js`, `src/entities/Vehicle.js`, `src/main.js`) are never edited by specialists: send the lead a change request (what and why, with the exact lines) instead.

| file(s) | owner |
|---|---|
| `package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/config.js` | lead (lead-only) |
| `src/core/*` (events, state, options, math) | lead (lead-only; new events and state fields through the lead) |
| `src/entities/*`, `src/scenes/GameScene.js` | lead (lead-only) |
| `src/world/*`, `scripts/*`, `public/maps/*`, `data/*` (map pipeline and World API) | lead |
| `src/scenes/BootScene.js`, `CitySelectScene.js`, `CharacterSelectScene.js`, `NewGameScene.js` | lead |
| `src/data/cities.js`, `src/data/characters.js`, `src/audio/**`, `src/data/radio.js` | lead |
| **JOBS:** `src/systems/MissionSystem.js`, `src/systems/missions/**`, `src/data/contacts.js`, `src/data/missions.js`, **new** `src/scenes/JobAppScene.js` (phone job board on J; registered as a stub in main.js), **new** bus art in `public/art/vehicles/` and its registration lines in `src/world/textures.js` (lead applies the textures.js lines on request) | JOBS specialist |
| **TRAFFIC RULES & POLICE:** `src/systems/PoliceSystem.js`, `src/systems/police/**` (including `police/traffic/`, the fines hook), `src/systems/TrafficSystem.js`, `src/systems/traffic/**` (AI obeys traffic lights and speed limits), `src/scenes/HUDScene.js` (speed-limit sign, fines feed, heat widget) | TRAFFIC RULES & POLICE specialist |
| **HOME & VEHICLES:** `src/systems/EconomySystem.js`, `src/systems/economy/**` (including new `economy/vehicles/**`), `src/data/shop.js`, `src/data/home.js`, `src/data/vehicles.js` prices (not physics), `src/scenes/OverlayScene.js` (dealer/rental overlay and home overlay) | HOME & VEHICLES specialist |
| `src/ui/**` | shared: HUD/Overlay owners may add to it; `theme.js` stays stable |
| `ARCHITECTURE.md`, `README.md`, `AGENTS.md` | lead (specialists send their additions to the lead) |

Overlaps to be careful about: `src/data/vehicles.js` physics values belong to the traffic specialist, prices to HOME & VEHICLES (split by field, ask first); `HUDScene.js` is TRAFFIC RULES & POLICE, other specialists ask them for HUD changes (events are the contract); `world/textures.js` registration lines are applied by the lead.

Art is wired in: runtime files live in `public/art/` (manifest.json, vehicles, characters, portraits, tiles, ui, keyart) and the originals in `art-source/`. Programmatic textures in `world/textures.js` remain the fallback. Texture keys: `veh-<type>`, `veh-wreck`, `char-<id>`, `ped-0..5`, `dot`, `soft`, `arrow`, `minimap`.

## Conventions

- ES modules, 2-space indent, single quotes, semicolons, named exports (no default exports).
- No globals other than `window.__game`. Talk to other systems through `bus`/`EV`. Call another system directly only through the methods listed as public in its header comment.
- Always subscribe with `listen(scene, ev, fn)` so listeners are removed on scene restart.
- World units are px; convert metres with `PX`. Keep per-frame allocations low in hot loops.
- Sprites made from generated textures use `setScale(1 / TEX_RES)`. Use `DEPTH.*` for layering.
- Everything is original: no names, logos, music or UI styling copied from existing games. Real Aarhus places are fine as locations, but criminal parties must be fictional. Prefer Danish/local names and avoid international chains.
- Wrap every localStorage access in try/catch (see state.js).
- Keep `npm run build` and `npm run check` clean.

## Controls

| key | action |
|---|---|
| W/A/S/D or arrows | walk, or accelerate/steer/brake-reverse |
| Shift | run |
| Space | handbrake (drift) |
| E | enter or exit a vehicle; with theft on it also steals (the driver is ejected); with theft off only owned, rented or job vehicles work ("Not your vehicle") |
| H | horn |
| Esc / P | pause (controls help, Q = save and quit) |
| B / K / M / J | shop / skills / map overlays / the phone job app (courier, taxi and bus tabs) |
| E at the home door / on a vehicle-shop pad | home overlay (sleep, pay rent, garage, move) / dealer overlay (buy, rent, repair) |
| D (in the job app) | decline the selected courier order |
| Y / N | accept / refuse a job offer (MissionSystem only; orders auto-accept after 8 s) |

### Walking presentation

Player and pooled pedestrians share `WalkingVisual`; it changes rendering only, not collision positions or speeds. Walking/running stride follows distance travelled, stops against walls, and resets on spawn/teleport. Extra shapes are hidden in vehicles, off-screen and for fallen pedestrians. Scene shutdown owns player shapes; the pedestrian pool explicitly destroys its helpers. Run `node scripts/walking-visual-test.mjs` for cadence, idle, heading-wrap, teleport and lifecycle checks.

### Audio (GameScene-owned)

- `src/audio/GameAudio.js`: `scene.audio` owns audio integration; constructed after systems and updated after vehicle physics. Public HUD API: `unlock()`, `toggleMute()`, `changeVolume(delta)`, `toggleRadio()`, `nextStation()`, `getStatus()`. GameScene calls `update(dt)` and `destroy()`; scene pause/resume and browser focus/visibility listeners gate output and are removed at shutdown.
- `src/audio/SoundEffects.js`: lazy, gesture-unlocked Web Audio synthesis. Subscribes through `listen` to existing HORN, VEHICLE_DAMAGED and VEHICLE_DESTROYED events; reads player movement for footsteps/engine. Bounded transient voices, one reusable engine, no downloaded sound assets.
- `src/audio/RadioPlayer.js`: optional native HTMLAudioElement streaming, separate from Web Audio. No request before explicit opt-in and car eligibility. Disconnects on exit/pause/mute/zero volume/shutdown; failed/autoplay-blocked streams latch until toggle/tune or a new trip. No proxy/recording. A 15-second connection/buffering timeout bounds stalled requests.
- `src/data/radio.js`: station names, candidate HTTPS stream endpoints and official player links. Runtime availability and public-release permissions remain external dependencies.
- Audio preferences use `aarhus-express:audio:v1` localStorage (guarded); only `volume` and `muted` persist. No changes to session/save state or events.
- Controls: **R** radio toggle, **T** next station, **V** master mute; HUD click targets for those controls, volume −/+ and external official-player fallback. Keyboard bindings belong to GameScene; HUD owns presentation. Radio supports all drivable vehicles, including bicycles and scooters (`inCar` is the legacy status field for riding any vehicle); engine sounds exclude `def.cyclist`.
- Ownership: `src/audio/**`, `src/data/radio.js` and audio regression scripts belong to lead/foundation. Test with `node scripts/radio-test.mjs`, `node scripts/sound-effects-test.mjs`, `node scripts/game-audio-test.mjs`.

## Realistic mode & options

The default game is a **realistic courier life with no crime**. Crime is opt-in and chosen once when a new game starts (`NewGameScene`, after character select; a save with that character continues instead).

### `src/core/options.js` (lead-only)

`state.options = { theft: false, criminalMissions: false, mayhem: false }`, saved per save, never changed after new-game time.

| export | meaning |
|---|---|
| `opt(name)` | one option of the live session |
| `crimeEnabled()` | `theft \|\| criminalMissions` |
| `pursuitEnabled()` | `= crimeEnabled()`: police heat, pursuit, roadblocks and busting are active only then |
| `isRealistic(options?)`, `optionTags(state)` | all off; small tag strings for the continue screen |
| `playerMayUse(v)` | theft on, or `v.owned`, `v.rentedBy === 'player'`, `v.jobVehicle`, or the target car of a criminal mission (`tag === 'mission'` with criminalMissions on) |
| `contactEnabled(c)` | legal contacts always, criminal ones only with criminalMissions |
| `OPTION_INFO`, `OPTION_IDS`, `REALISTIC` | UI text; tunables (`towFee` 300 kr, `towDelaySec` 6) |

**Legacy saves** (no `state.options`) load with all three options ON and `state.optionsLegacy = true` (continue screen tag "Classic: all options on"). Brand-new games never have `optionsLegacy`.

### Gating rules (what each option does)

- **Player/Vehicle:** with theft off, E enters only vehicles for which `playerMayUse` is true. Anything else gives the prompt "Not your vehicle" and a pager line on E. No driver is ejected and `VEHICLE_STOLEN` is never emitted. Entering owned, rented or job vehicles is method `own`, not a theft. Vehicles supplied by a legal job set `jobVehicle: true` (the moving-help van does).
- **MissionSystem:** steal-triggered delivery orders exist only with theft on. Criminal contacts (Ravn, Sille: `legal: false`) are removed from `MissionSystem.contacts`, the minimap and the map overlay unless criminalMissions is on. Legal contacts stay. Job vehicles for criminal templates are not `jobVehicle`: with criminalMissions on, their target car may be taken (that is the job).
- **PoliceSystem:** `pursuitEnabled()` false means `addHeat` is a no-op, no units spawn, nothing is busted, and the HUD heat widget and bust meter are hidden. The code paths are intact. Every frame `update()` still calls `this.trafficRules.update(dt, time)`, the **fines hook** in `src/systems/police/traffic/` (see its README: interface `createTrafficRules(ctx) -> { update, destroy }`; fines go through `REQUEST_PAY` with reason `'fine'`).
- **Mayhem off:** vehicles do not explode. At 0 health a vehicle becomes `state 'broken'` (smoking, undriveable) and emits `VEHICLE_BROKEN`. If it is the player's (owned, rented, job or being driven), GameScene sends a pager line, waits `REALISTIC.towDelaySec`, charges `REALISTIC.towFee` once (`REQUEST_PAY` reason `'tow'`), repairs it and respawns it at the home door if owned, otherwise next to the player, and emits `VEHICLE_TOWED`. Other broken AI cars stay for 30 s and are removed, no fee. Pedestrian and cyclist hits still knock them down but emit `traffic:injury { severity, byPlayer, killed, x, y, vehicle }` instead of `CRIME pedestrianHit`, for the fines module to penalise. Mayhem on keeps the old behaviour (burn, explode, `CRIME`).
- Mayhem has no heat effect by itself: with theft and criminalMissions off, even `CRIME` events do nothing.

### Home and start

- `src/data/home.js` picks a real four-storey apartment block in Trøjborg by lat/lon (HOME & VEHICLES specialist may change it). `world.resolveHome(cfg)` snaps it to the nearest building polygon and finds the door on the street side. Result: `world.home` = `ctx.home` = `{ id, name, street, district, x, y, bx, by, angle, parkX, parkY }` (door and parking spot in world px, `angle` = door direction towards the street).
- `state.home = { id, rentPerWeek: 1200, paidUntilDay: 7 }`. Rent, sleep and the home overlay are built (see **Realistic mode: systems** below). The owned-vehicle parking spot (`parkX/parkY`) is 4.5 m to the side of the door so that E at the door (home overlay) never grabs the bike.
- **Theft off** (realistic start): the player spawns at the home door and every id in `state.ownedVehicles` is spawned owned along the pavement (new games start with `['bike']`). **Theft on** (classic start and legacy saves): spawn at the Rådhus with the starter hatchback; the home still exists and is drawn.

### Map data for the specialists (public/maps/aarhus.json, World API)

Built by `scripts/fetch-transport.mjs` (Overpass, separate from the main extract; relations fetched without geometry) and `scripts/build-map.mjs`. The main map data is byte-identical to before (landmarks, streets, bike graph, roads, buildings unchanged). Aarhus counts: 169 bus stops (clustered from 2644 OSM elements), 45 bus routes from route relations (`derived: false`; if relations are unavailable the build derives routes from stops grouped along named main roads, `derived: true`), 267 traffic signals, 12 taxi stands (OSM) plus an Aarhus H fallback only when none is within 120 m, 40 vehicle shops (26 bicycle, 7 rental, 7 bike rental; OSM has no `shop=car` or `shop=motorcycle` in this bbox), speed limits on all 7194 drive edges (`maxspeed`; default 50 urban, 80 for motorway/trunk and ring roads, 30 for service and living streets; Aarhus has 20, 30, 40, 50 and 60 km/h edges). Size cost is about 40 KB.

| World method | returns |
|---|---|
| `getBusStops()` | `[{ name, x, y (snapped drive node), lx, ly (real position), node, routes: [routeIdx] }]` |
| `getBusRoutes()` | `[{ id, ref, name, from, to, stops: [stopIdx], derived }]`, stops in travel order |
| `getTrafficSignals()` | `[{ x, y, node }]`, one per drive-graph node |
| `edgeSpeedLimit(edge)` | km/h of drive edge index `edge` (`drive.e[edge*4..]`) |
| `speedLimitAt(x, y)` | km/h of the nearest drive edge within 30 m (cached, cheap per frame), else 50 |
| `getTaxiStands()` | `[{ name, x, y, node, src: 'osm'\|'fallback' }]` |
| `getVehicleShops()` | `[{ name, kind: bicycle\|car\|motorcycle\|rental\|bikeRental, x, y, lx, ly, node }]` |
| `resolveHome(cfg)` / `home` | see Home above |

### Where each upcoming specialist plugs in

- **JOBS:** `MissionSystem` public API plus `JobAppScene` (J). Work in realistic games comes only from legal contacts and the job board. Use `jobVehicle: true` for vehicles a job supplies (bus, taxi) via `ctx.spawnVehicle(type, x, y, { jobVehicle: true })`. Bus stops and routes come from the World API.
- **TRAFFIC RULES & POLICE:** `police/traffic/index.js` hook, `world.speedLimitAt`, `getTrafficSignals`, `TRAFFIC_EV.INJURY`, `VEHICLE_BROKEN/TOWED`. HUD (`HUDScene`) already hides the heat widget when `!pursuitEnabled()`: put the speed-limit sign and fines feed there.
- **HOME & VEHICLES:** `state.home`, `world.home`, `getVehicleShops()`, `Vehicle` `owned`/`rentedBy`. Spawn bought or rented vehicles with `ctx.spawnVehicle(type, x, y, { owned: true })` or `{ rentedBy: 'player' }`. The flat tow fee in GameScene (`_onBroken`, constants in `REALISTIC`) is a placeholder for a real tow service: request changes from the lead.


## Realistic mode: systems (jobs, rules, home, vehicles)

### Careers (`ctx.systems.missions.careers`, `src/systems/missions/careers/`)
Used by `scenes/JobAppScene.js` (key **J**, three tabs: Bybud courier, Midtby Taxa taxi, bus). Courier: `courier.offers`, `courier.rating` (1..5), `accept(id)`, `decline(id)`, `pickupMetres(offer)`. Taxi: `taxi.signUp()`, `startShift()`, `endShift()`, `shift`. Bus: `bus.signUp()`, `routes()`, `startShift(routeIdx)`, `endShift()`, `shift`, `aheadBehind()`. Common: `levelInfo(career)`, `shiftActive()`, `summary()`, `abortShift(reason)` (ends any running shift from outside; GameScene uses it when a shift vehicle breaks down: no repair, the company tows it). Shift vehicles are `jobVehicle: true`. Taxi and bus pay through `REQUEST_PAY`; courier offers become ordinary MissionSystem orders.

Courier pickups: on a bike or on foot offers come from restaurants within about 800 m (`COURIER.pickupRangeBikeM`; widens 15% per retry only when nothing is nearby), in a car up to 1,600 m.
Fines and jobs: every `police:ticket` with `ratingPenalty > 0` pushes one bad score into the courier rating (penalty 15 is about -0.3 stars; `state.jobs.courier.lastTicket` is shown in the app) and a ticket while a taxi passenger is aboard removes the tip of that fare.

### Traffic rules and police (`src/systems/police/traffic/`, `TrafficSystem.signals/limits`)
- Signals API: `traffic.signals.approach(from,to)`, `stateOf(ap)` (0 green, 1 amber, 2 red), `redAge(ap)`, `nearby(x,y,r,out)`. Limits API: `traffic.limits.get(a,b)` km/h; AI cruises at the posted limit x 0.82..1.02 and stops at red.
- Fines (`police/traffic/config.js` `RULES`): red light 2,000 kr (bike 1,000), speeding 1,000-4,000, ramming 1,500, pavement 800, wrong way 1,500 (bike 500), injury 8,000, kill 25,000, driving while banned 3,000, **all multiplied by `RULES.FINE_SCALE` (0.4)**. Clips: 3 clips on the licence is a 240 s ban on cars (bikes stay allowed; `Player.tryEnter` refuses non-bike vehicles while `police.isLicenceBanned()`); one clip decays per 600 s clean.
- Speed cameras are parked "fotovogn" vans (`v.fotovogn`, mass 90 so they do not slide; never enterable and not stealable) and one AI patrol car (`v.patrol`). Players can never use either with theft off (`playerMayUse`). With theft on, stealing a patrol car adds `policeCarjack` heat.
- HUD shows the posted speed-limit sign, a ticket popup, the clip count and the ban timer.

### Home and rent (`economy/HomeService.js`)
One real second is one in-game minute (a day is 24 real minutes, a week 2.8 hours). Rent 1,200 kr falls due Monday 00:00 (first week prepaid); reminder the day before; auto-debited when affordable, otherwise one week of arrears, then late (days 0-1), warning (2-3), evicted (day 4+: no sleep, -3 LQ per day) until paid. Sleep skips to 07:00, heals, +2 LQ. E at the door opens the home overlay (sleep, pay rent, garage, housing upgrades to Frederiksbjerg 2,400 kr/week and Aarhus Ø).

### Vehicles (`economy/vehicles/VehicleService.js`)
E on a shop pad opens the dealer overlay: buy (one per type, spawns owned at the door each session), rent 1-3 days (saved in `state.economy.rentals`, removed at `endsAt`), repair (12 kr per missing health point, half price while insured), weekly insurance for owned cars and scooters. Vehicles are `owned`, `rentedBy: 'player'` or `jobVehicle`; broken-down owned or rented vehicles are towed (300 kr, 6 s), broken job vehicles end the shift.

### Balance (realistic but fun)
Measured on a production build (25 random start nodes x 3 offers; bike, theft off):

| quantity | value |
|---|---|
| pickup distance (straight line, bike) | avg about 600 m, up to about 800 m (1.4 km only when the area has no restaurant) |
| delivery distance | avg about 575 m |
| bike speed | max 7.5 m/s, about 5.5 m/s average in town with stops |
| reward per delivery | about 81 kr at `payMul 1.5`; **raised to `COURIER.payMul` 1.85 giving about 100 kr** (+ about 10% tip) |
| time per delivery | about 1,360 m route / 5.5 m/s = 250 s |
| deliveries per in-game day (1,440 s) | about 5.5 non-stop, about 3.5 at a realistic 60% duty |
| courier income | about 550 kr per day working non-stop, about 350 kr at 60% duty |

Decisions:
- `RULES.FINE_SCALE = 0.4`: a bike red light costs 400 kr (about 0.7-1.1 days of courier income), a car red light 800 kr (1.5-2 days at 60% duty, about 1.5 non-stop), speeding 400-1,600 kr, injury 3,200 kr. A fine always stings but money floors at 0 (no debt) and the bike plus the job app always earn again, so there is no soft-lock. Realistic raw amounts stay visible in the config for the full-scale mode (`FINE_SCALE 1`).
- Starting money in realistic games is the character value plus 250 kr (450-650 kr): about one early fine of buffer, low enough to need work. The first week of rent is prepaid.
- Rent 1,200 kr per week is about 25-35% of one week of steady courier play (2.8 real hours at 350-550 kr per day gives 2,450-3,850 kr), so about 1-1.5 hours of working covers it and leaves room for insurance, repairs and a van rental.
