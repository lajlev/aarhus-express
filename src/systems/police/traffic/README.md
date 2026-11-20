# Traffic rules and fines

`createTrafficRules(ctx)` (index.js) is called by `PoliceSystem` and updated every frame in every game mode.
Realistic games: police enforce rules with fines, no heat. Pursuit games: the same rules run next to the heat system.

- `config.js`: every tunable (fines, tiers, cooldowns, camera counts, licence/ban lengths, `FINE_SCALE`).
- `Licence.js`: `state.licence = { clips, banLeft, decayT }`; three clips = temporary car ban.
- `Cameras.js`: `planCameraSpots` / `CameraVans` (8 "fotovogn" vans on main roads) and `Patrols` (AI police cars that ticket on sight).
- `index.js`: red light, speeding, ramming, pavement, wrong way, injury and ban-driving checks.

Events: `POLICE_EV.TICKET` `police:ticket` and `POLICE_EV.LICENCE` `police:licence` (see `../tuning.js`).
Fines are charged only via `REQUEST_PAY { amount: -fine, reason: 'fine' }`, once per offence.
