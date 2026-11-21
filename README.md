# Lillefar: Aarhus Express

An original top-down open-city courier game set in central Aarhus. The map is generated from OpenStreetMap. Built with Phaser 3.80.1 and Vite.

```bash
npm install
npm run dev        # open http://127.0.0.1:5173/
```

**The default game is a realistic courier life with no crime.** You rent a cheap basement room in Trøjborg (home marker on the map and minimap) and own a city bike parked at the door. You earn money from honest jobs (courier, taxi shifts and bus routes) and later rent or buy better vehicles. Police only enforce traffic rules.

Crime is opt-in. Four comfort/cheat toggles (**Infinite money**, **No driving ban**, **No speeding tickets**, **No red-light tickets**) and a separate **Gambling** toggle (scratch cards at kiosks, slot machines in Latinerkvarteret and Jægergårdsgade bars, a betting app; money only) sit below the Start button of the same screen (also off by default; they do not make the game "crime"). When you start a **new game** (after choosing a character) a toggles-only screen offers three game options, all OFF by default and fixed for that save:

- **Vehicle theft**: steal parked or driven vehicles (E); every stolen vehicle offers a delivery order.
- **Criminal missions**: Ravn's smuggling and hot-car jobs, Sille's steal-to-order.
- **Mayhem**: run over pedestrians and blow up cars with no rating or job penalty. Off: wrecks are "broken down" and towed (a fee), and knocking down pedestrians is an injury that gets fined.

Police heat (1-5), pursuit, roadblocks and busting are active only when theft or criminal missions is on. Old saves (made before options existed) load with all options ON, and the continue screen tags them "Classic: all options on". Saves show their active options as small tags on the character select screen.

Controls: WASD or arrows to walk and ride/drive, Shift to run, Space for the handbrake, E to get on/off a vehicle (with theft on it also steals), H for the horn, Y/N to accept or refuse a job, B shop, K skills, M map, J the phone job app (courier, taxi, bus, Tasks, Bills and Loans tabs, plus Bets with the gambling option; D declines an order there; E at a gambling pin plays), Tab to cycle the tracked task, E at a gig pin to see its offer (Y accepts), M the map (Up/Down select a task pin, Enter accepts or tracks, X abandons), E at your door (home: sleep, pay rent, garage) or on a vehicle-shop pad (buy, rent, repair), Esc to pause.

**Tasks:** you can hold up to four accepted tasks at once (courier orders, street gigs, challenges and a shift slot); one is tracked and drives the arrow, card and minimap line. Street gigs (groceries for a neighbour, a forgotten laptop, a dog walk, a flyer run, a sofa, library books and more) appear around you all the time as pins on the world, minimap and map. City events (concerts at Train, AGF matches, Friday bar rush, rain, the Christmas market) boost pay in their area while they last, and now and then a quick challenge is offered in the app.

Realistic mode: pay weekly rent (1,200 kr, Monday), sleep at home, take courier orders from the Bybud app (your rating drops with traffic fines), rent a van or buy a vehicle at a dealer, drive company taxis and city buses on real Aarhus routes. Traffic lights and speed limits apply: AI obeys them, speed-camera vans and a patrol car fine you (red light, speeding, ramming, pavement, wrong way), three clips on the licence mean a short driving ban (bikes still allowed).

Money: traffic fines are bills (7 days to pay in the Bills tab, then reminders, fees and debt collection that garnishes job pay), and the Loans tab offers satirical quick loans ("Kvikke Kasper", 30% interest per week). Features: AI traffic and pedestrians, a home and an owned city bike, delivery orders and legal contact missions (food, moving, taxi); with options on: car stealing, heat levels 1-5 with pursuit, roadblocks and busting, and criminal missions (smuggling, hot cars, steal-to-order). Shop and Life Quality, skills, HUD with minimap, and autosave.

- Regenerate the map: `npm run fetch-map -- aarhus && npm run fetch-transport -- aarhus && npm run build-map -- aarhus` (`fetch-transport` adds bus stops and routes, traffic signals, taxi stands and vehicle shops; the build still works without it, only those lists stay empty).
- Add a character: append an entry to `src/data/characters.js`.
- Add a city: add its bounds to `scripts/cities.mjs`, then fetch and build its map. Add an entry to `src/data/cities.js` with `available: true`, and add its contacts and shop items to `src/data/contacts.js` and `src/data/shop.js`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for modules, the event contract, state, file ownership and verification (`npm run check`).

Map data © OpenStreetMap contributors (ODbL).

## Graphics increment: walking movement

Player and pedestrians now have distance-driven footsteps, subtle body sway, ground shadows and smoother visual turns. Movement speeds and collisions are unchanged. Try walking, holding Shift to run, turning sharply, stopping against a wall and entering/exiting a vehicle. Cycling, driving and city scenery remain unchanged in this first pass.

Animation checks: `node scripts/walking-visual-test.mjs`.

City and cargo bicycles retain road speed on paths and unclassified ground (including plazas). Grass still slows them; buildings block them and deep water remains hazardous. Cars and scooters are unchanged. Physics regression checks: `node scripts/bike-terrain-test.mjs` (Node 22.15+).

## Sound and in-car radio

Original synthesized sound effects include engine pitch under acceleration, footsteps, car horns/bicycle bells (`H`), impacts, explosions and splashes. Sound unlocks on a keyboard or mouse gesture; unsupported/blocked audio leaves gameplay working.

- `R`: enable/disable live car radio (off by default; requires internet).
- `T`: next station. `V`: mute/unmute all game audio.
- The top-centre audio panel also has volume −/+ and an **Official player** fallback link.
- Radio is available on all rideable vehicles, including bicycles and scooters. It disconnects on exit, pause, loss of focus, mute, zero volume and shutdown. Effects also silence on pause/focus loss.
- Master volume/mute persist separately from game saves. Station selection and radio opt-in reset with the game scene.

Station candidates: [go!FM / Aarhus official player](https://radio.side-walk.dk/webplayer/gofm), [DR P3](https://www.dr.dk/lyd/live/p3), and [DR P4 Østjylland](https://www.dr.dk/lyd/live/p4aarhus). The go!FM player is linked from [its official site](https://www.gofm.dk/). HTTPS stream endpoints are configured in `src/data/radio.js`; **direct endpoint playback was not verified in this restricted environment**. Streams may move, reject browser playback or be geographically restricted. The UI reports connection failures after 15 seconds, with no automatic retry loop; toggle the radio or select another station to retry. Official-player links open externally and their audio is controlled separately from the game.

Broadcasts are not downloaded, recorded, proxied or bundled. Enabling radio connects the player's browser directly to the station provider. Station names identify external services, not endorsements. Public stream availability does not establish embedding/redistribution permission; broadcaster permissions and applicable rights must be checked before public release.

Audio regression checks (Node 22.15+):

```bash
node scripts/radio-test.mjs
node scripts/sound-effects-test.mjs
node scripts/game-audio-test.mjs
```

These use mocked media/Web Audio APIs; they do not prove live stream availability, sound quality or browser autoplay behavior. Browser listening, visual layout and performance play-tests remain required.
