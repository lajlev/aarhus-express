// Mission tuning + templates. OWNER: missions specialist.
// Each template has 3 levels that unlock in sequence (level n needs n-1 completions).
export const TUNING = {
  speedMps: 11, // assumed average speed for time limits
  timeSlack: 1.5,
  timeBase: 25, // seconds added to every limit
  stopSeconds: 10, // extra seconds per pickup/drop stop
  baseTip: 0.1, // tip fraction of payout for a clean, quick delivery; x economy getEffects().tips
  payBase: 20,
  payPerMetre: 0.05,
  criminalMul: 2.0,
  loadSeconds: 1.5,
  pickupRadius: 80, // px
  dropRadius: 90,
  contactRadius: 130,
  contactCooldownDecline: 45e3, // ms
  contactCooldownDone: 90e3,
  orderAutoAccept: 8, // seconds before an order offer auto-accepts
  maxLevel: 3,
  loseTimeout: 150, // seconds to shake the police in a 'lose' stage before the job fails
};

export const LEVELS = [
  { timeMul: 1.25, payMul: 1.0 },
  { timeMul: 1.0, payMul: 1.45 },
  { timeMul: 0.85, payMul: 2.0 },
];

/** Contact mission templates. `legal` ones use real shops as pickup/drops; criminal ones only use street/area landmarks. */
export const TEMPLATES = {
  foodRush: {
    title: 'Lunch rush', legal: true,
    hub: 'latiner', hubRadius: 1500, // px around Latinerkvarteret for drops
    drops: [2, 3, 4], cargoNames: ['Lunch boxes', 'Smørrebrød trays', 'Hot street food'],
  },
  movingHelp: {
    title: 'Moving help', legal: true, vehicle: 'van',
    hub: 'jaegergard', hubRadius: 3000, // Frederiksbjerg
    moves: [1, 2, 3], sizes: [5, 5, 6], cargoNames: ['Sofa and boxes', 'Wardrobe', 'Piano (careful!)'],
  },
  taxiFare: {
    title: 'Taxi fares', legal: true,
    from: 'aarhush', fares: [1, 2, 3], minM: 350, maxM: 1500,
  },
  smuggle: {
    title: 'Quiet package', legal: false,
    from: 'containerhavn', heatLimit: [4, 3, 2], // delivery refused when heat level >= this
    drops: ['jaegergard', 'mejlgade', 'randersvej', 'ringgaden', 'aarhuso', 'latiner', 'godsbanen', 'train'],
    minM: 600, maxM: 2200,
  },
  hotCar: {
    title: 'Hot wheels', legal: false,
    from: 'containerhavn', heat: [2.0, 3.0, 4.0], cars: ['smallcar', 'smallcar', 'coupe'],
    drops: ['jaegergard', 'ringgaden', 'randersvej', 'aarhuso', 'godsbanen', 'train', 'havnebad'],
    minM: 700, maxM: 2200,
  },
  stealModel: {
    title: 'Car to order', legal: false,
    models: ['van', 'coupe', 'coupe'], minHealth: [0, 0, 0.7],
    garages: ['jaegergard', 'ringgaden', 'randersvej', 'mejlgade'],
    spawnRing: [500, 1400], // px from contact
  },
};

export const ORDER = {
  poiKinds: ['food', 'cafe', 'shop', 'bar', 'culture'],
  pickupM: [150, 700], // from player
  dropM: [400, 1800], // from pickup
  fragileChance: 0.3,
  bigChance: 0.2, // order needs more capacity than the stolen vehicle
  items: {
    food: ['Takeaway bag', 'Pizza boxes', 'Dinner for four'],
    cafe: ['Cake boxes', 'Coffee tray', 'Pastry order'],
    bar: ['Crate of beer', 'Glassware box'],
    shop: ['Parcel', 'Shopping bags', 'Flower bouquet'],
    culture: ['Exhibition crate', 'Museum shop order'],
    landmark: ['Parcel'],
  },
  fragileItems: ['Cake boxes', 'Glassware box', 'Flower bouquet', 'Exhibition crate'],
};

// ============================================================================ CAREERS (JOBS specialist)
// Courier (app "Bybud"), taxi driver (company taxi) and bus driver (real Aarhus routes). Progress lives in
// state.jobs.<career> = { xp, ... } (saved). Level 1..5 comes from xp; each level unlocks longer/harder work and better pay.
export const CAREER_XP = [0, 80, 220, 420, 700]; // xp needed to reach level 1..5
export const CAREER_NAMES = { courier: 'Courier', taxi: 'Taxi driver', bus: 'Bus driver' };
export const careerLevel = (xp) => { let l = 1; for (let i = 1; i < CAREER_XP.length; i++) if (xp >= CAREER_XP[i]) l = i + 1; return l; };

/** Places that are chains or not real eateries are never used as courier pickups. */
export const CHAIN_RE = /carl'?s jr|joe & the|bill'?s|caf[eé] nero|mcdonald|burger king|starbucks|subway|domino|pizza hut|kfc|sunset boulevard|7-?eleven|espresso house|danske bank|bestseller|trifork|jyllandsposten|kantine|kantina|kemisk|badminton|tennis|bowling|camping|vin danmark|shared beauty|yogo|byens forlag|\btv\b|minigolf|\bbiks\b|comwell/i;

export const COURIER = {
  appName: 'Bybud',
  hubs: ['latiner', 'jaegergard', 'streetfood', 'mejlgade', 'aboulevarden', 'strøget'], // busy order areas get more offers
  hubRadiusM: 450,
  maxMetres: [900, 1400, 2000, 2800, 3800], // longest restaurant -> home trip by career level
  minMetres: 250,
  sizeMax: [1, 1, 2, 2, 3], // largest order (capacity units) by level
  payMul: 1.5, // on top of TUNING.payBase + payPerMetre
  levelPay: [1.0, 1.1, 1.22, 1.36, 1.5],
  offerEvery: [14, 24], // seconds between new offers (random)
  offerLife: [90, 150], // seconds an offer stays listed
  pickupRangeM: [120, 1600],
  startRating: 4.0,
  ratingWindow: 20, // last N delivery scores + last N accept/decline decisions
  items: ['Takeaway bag', 'Pizza boxes', 'Dinner for two', 'Sushi box', 'Burger menu', 'Kebab wrap', 'Dim sum basket', 'Ramen bowls', 'Cake box', 'Coffee tray'],
  fragile: ['Cake box', 'Coffee tray', 'Ramen bowls'],
};

export const TAXI = {
  company: 'Midtby Taxa',
  base: 35, perKm: 38, perMin: 5, // meter (kr)
  levelSurcharge: [1.0, 1.06, 1.12, 1.2, 1.3], // night/airport style surcharge unlocked by level
  maxMetres: [1200, 1800, 2600, 3400, 4500],
  minMetres: 450,
  shiftSeconds: [420, 480, 540, 600, 720], // real seconds of shift before "return the taxi"
  hailEvery: [9, 20], // seconds between fare requests while idle
  hardBrake: 14, // m/s^2 decel (from > 6 m/s) that scares the passenger
  hardBrakePenalty: 0.1, // fraction of the passenger's patience (integrity) lost per hard stop
  tipMax: 0.28, // fraction of the meter for a perfect ride
  awaySeconds: 45, // leaving the taxi this long ends the shift
  returnRadiusM: 14,
  shiftBonus: 30, perFareXp: 12, shiftXp: 30,
  abandonPenalty: 150,
  standOnly: 0.45, // chance a hail is at a taxi stand (otherwise on the street)
};

export const BUS = {
  company: 'Linjetid',
  stopsPerShift: [7, 9, 11, 14, 18], // by level (route is cut after this many stops)
  minRouteStops: 4,
  avgMps: 7.5, // schedule pace
  dwellSeconds: 8, // schedule allowance per stop
  stopRadiusM: 15, // stop zone
  stopSpeed: 2, // m/s: slower than this inside the zone counts as stopped
  boardSeconds: 3,
  holdMax: 25, // seconds a bus that is ahead of schedule is held at a stop (to keep to the timetable)
  onTimeWindow: [-30, 45], // seconds early/late that still count as punctual
  payPerStop: 22, punctualBonus: 12, completeBonus: 80, perfectBonus: 60,
  skipPenalty: 20, damagePenalty: 150, // kr x damage fraction
  levelPay: [1.0, 1.1, 1.22, 1.36, 1.5],
  awaySeconds: 45, abandonPenalty: 100,
  stopXp: 4, shiftXp: 40, punctualXp: 2,
  vehicle: { // registered as VEHICLES.bus at runtime if data/vehicles.js has none (see careers/bus.js)
    name: 'City bus', tex: 'veh-bus', length: 12, width: 2.55,
    maxSpeed: 17, accel: 2.4, brake: 9, reverse: 3, steer: 1.05, grip: 8, drag: 0.5,
    health: 420, capacity: 0, mass: 60, offroad: 0.25, tint: false, weight: 0,
  },
};
