// The player's home: a cheap rented basement room in a real residential building, with upgrade tiers.
// OWNER: HOME & VEHICLES specialist (rent, sleep, home overlay, moving).
//
// Each tier is a real residential area. The building is picked by lat/lon (WGS84) so it survives map rebuilds.
// World.resolveHome() snaps it to the nearest building polygon and computes the DOOR on the street side; the
// result is `ctx.world.home` (= ctx.home): { id, name, street, district, x, y (door), bx, by, angle, parkX, parkY }.
// The CURRENT tier is state.home.tier (0 = basement). getHomeConfig() returns the config of that tier, so GameScene
// resolves the right building on every load. Moving (economy.moveHome) re-resolves ctx.home live.
//
// Rent rules live in systems/economy/HomeService.js (in-game days, weeks start on day % 7 === 0, see there).
import { session } from '../core/state.js';

export const HOME_TIERS = {
  aarhus: [
    {
      tier: 0,
      id: 'basement-troejborg',
      name: 'Basement room, Trøjborg',
      area: 'Trøjborg',
      blurb: 'A damp, cheap basement room with a bike rack outside. It is yours as long as the rent is paid.',
      // Four-storey apartment block in Trøjborg (OSM building near Trøjborgvej / Tordenskjoldsgade).
      lat: 56.169474, lon: 10.215455,
      rentPerWeek: 1200, lqPerWeek: 0, moveCost: 0, parking: 0, insuranceDiscount: 0,
    },
    {
      tier: 1,
      id: 'flat-frederiksbjerg',
      name: 'Bright flat, Frederiksbjerg',
      area: 'Frederiksbjerg',
      blurb: 'Two rooms with a balcony in the Frederiksbjerg quarter, close to cafés and the Ceresbyen path. Rent includes a bike shed.',
      lat: 56.15104, lon: 10.200001,
      rentPerWeek: 2400, lqPerWeek: 8, moveCost: 4000, parking: 1, insuranceDiscount: 0,
    },
    {
      tier: 2,
      id: 'penthouse-aarhus-oe',
      name: 'Harbour flat, Aarhus Ø',
      area: 'Aarhus Ø',
      blurb: 'Top floor on Aarhus Ø with a view over the bay and a reserved parking space in the garage (insurance 25% cheaper).',
      lat: 56.163236, lon: 10.227608, // the OSM extract has few buildings on Aarhus Ø: this is its big harbour-side block
      rentPerWeek: 4800, lqPerWeek: 20, moveCost: 9000, parking: 2, insuranceDiscount: 0.25,
    },
  ],
};

export const getHomeTiers = (cityId) => HOME_TIERS[cityId] || [];

/** Config of the tier the save currently lives in (state.home.tier, default 0). Used by GameScene.resolveHome. */
export const getHomeConfig = (cityId, tier) => {
  const list = HOME_TIERS[cityId];
  if (!list) return null;
  const t = tier ?? session.state?.home?.tier ?? 0;
  return list[t] || list[0];
};
