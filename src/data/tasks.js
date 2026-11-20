// Task system tuning: street gigs, city events, quick challenges. OWNER: JOBS specialist.
// Spawn rates, payouts and event schedules are documented in ARCHITECTURE.md ("Tasks: gigs, events, challenges").

export const TASKS = {
  maxActive: 4, // accepted tasks at once (orders, gigs, challenges, shift)
  gig: {
    nearM: 600, // "visible" radius for the 3-6 gigs rule
    closeM: 250, // there is always at least one gig this close (about 30 s of riding at 7.5 m/s)
    minNear: 4, // refill below this many gigs inside nearM
    maxNear: 6,
    maxTotal: 9, // hard cap of gigs on the board
    spawnEvery: 1.5, // seconds between board checks (1 spawn per check, up to 3 when fewer than minNear gigs are near)
    ttl: [170, 300], // seconds a gig stays on the board
    despawnFarM: 1500, // gigs left far behind are dropped so the refill happens near you
    interactM: 9, // metres: press E within this distance of a gig pin to see its offer
    withdrawM: 16, // the offer card is withdrawn when you walk this far away
    pingEvery: 40, // seconds between "new gig nearby" pager lines (throttle)
    pingM: 420,
    declineHideSec: 25, // a declined gig cannot be re-offered for this long (so E does not loop)
  },
  speedMps: 4.2, // assumed pace for gig timers (foot/bike mix)
  event: {
    checkEvery: 3, // seconds between schedule checks
    maxActive: 3,
  },
  challenge: {
    firstAfter: 40, // seconds after the game starts before the first challenge is offered
    every: [150, 260], // seconds between challenge offers
    ttl: 150, // an offer expires after this long
    maxOffered: 2,
  },
  courierEventBoostOffers: 2, // extra courier offers kept inside an active event area
  nearbyListMax: 40,
};

/** Colours and short labels per task type (used by the HUD, minimap, map and the app). */
export const TASK_TYPES = {
  gig: { label: 'Street gig', color: 0x4cc38a, css: '#4CC38A' },
  courier: { label: 'Courier order', color: 0x4da3ff, css: '#4DA3FF' },
  taxi: { label: 'Taxi', color: 0xf2cf3a, css: '#F2CF3A' },
  bus: { label: 'Bus', color: 0xc9d1e0, css: '#C9D1E0' },
  event: { label: 'City event', color: 0xe05cff, css: '#E05CFF' },
  challenge: { label: 'Challenge', color: 0xff6a2b, css: '#FF6A2B' },
  mission: { label: 'Contact job', color: 0xf2b134, css: '#F2B134' },
};

/** Real Aarhus parks for dog walks. lat/lon are approximate; waypoints snap to the walk graph near the nearest park polygon. */
export const PARKS = [
  { name: 'Universitetsparken', lat: 56.1667, lon: 10.2035 },
  { name: 'Botanisk Have', lat: 56.1608, lon: 10.1957 },
  { name: 'Mindeparken', lat: 56.1384, lon: 10.2146 },
];

// Fictional people (first names only) for the gig blurbs.
export const NAMES = ['Birgit', 'Ove', 'Karen', 'Mads', 'Ingrid', 'Svend', 'Freja', 'Anker', 'Tove', 'Emil', 'Gudrun', 'Villads', 'Lone', 'Harald', 'Sofie', 'Bjarne'];
export const DOGS = ['Bella', 'Rusty', 'Bamse', 'Ludo', 'Molly', 'Fidus'];

/**
 * City events. `when(wd, hour, day)` decides whether the event may start now (wd 0 = Monday, the game starts Monday 08:00;
 * hour 0..24 as a float). `chance` is per schedule check (every 3 real seconds = 3 game minutes). Durations are game minutes
 * (1 real second = 1 game minute). Radii are metres. pay = extra courier/gig pay in the area, surge = taxi fare multiplier.
 */
export const EVENT_RULES = [
  {
    kind: 'rain', name: 'Rain shower', where: null, global: true, dur: [120, 240], cooldown: 300, chance: 0.0016, pay: 0.3, surge: 1.25,
    when: () => true, text: 'Rain over Aarhus: courier demand is up everywhere and the roads are slippery.',
  },
  {
    kind: 'concert', name: 'Concert', places: ['train', 'musikhuset'], r: 260, dur: [170, 200], cooldown: 600, chance: 0.12, pay: 0.5, surge: 1.5,
    when: (wd, h) => wd >= 2 && h >= 20.5 && h < 22.5, text: 'The concert is letting out: crowds want rides and food.',
  },
  {
    kind: 'match', name: 'AGF match', places: ['ceres'], r: 420, dur: [190, 230], cooldown: 600, chance: 0.12, pay: 0.4, surge: 1.4,
    when: (wd, h) => wd >= 5 && h >= 12.5 && h < 15, text: 'AGF are playing at Ceres Park: fans everywhere, orders and fares to match.',
  },
  {
    kind: 'barRush', name: 'Friday bar rush', places: ['latiner', 'jaegergard'], r: 380, dur: [210, 250], cooldown: 600, chance: 0.1, pay: 0.6, surge: 1.6,
    when: (wd, h) => wd >= 3 && wd <= 5 && h >= 21 && h < 23.5, text: 'The bars are filling up: late food orders and taxi demand.',
  },
  {
    kind: 'xmas', name: 'Julemarked', places: ['domkirke'], r: 300, dur: [270, 330], cooldown: 900, chance: 0.1, pay: 0.35, surge: 1.3,
    when: (wd, h, day) => day < 24 && h >= 11.5 && h < 16, text: 'The Christmas market is open at Store Torv: gifts, mulled wine and foot traffic.',
  },
];

/** Game calendar: day 0 is Monday 1 December 2025, so the Christmas market runs on the first 24 game days. */
export function gameDate(day) {
  const d = new Date(Date.UTC(2025, 11, 1 + day));
  return { month: d.getUTCMonth() + 1, dom: d.getUTCDate() };
}
