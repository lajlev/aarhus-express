// Fun stuff to spend money on, per city (DKK). OWNER: EconomySystem.
// at = landmark id (nearVenue check + map pin), tier 1..4,
// lq = base Life Quality gain (diminishes on repeat buys),
// cooldown = in-game minutes before it can be bought again (0 = none),
// max = lifetime purchase cap (omit = unlimited), grants = optional unlock.
// 1 real second = 1 in-game minute (see EconomySystem).
export const SHOP = {
  aarhus: [
    // tier 1: cheap treats
    { id: 'streetfood-feast', tier: 1, name: 'Feast at Aarhus Street Food', at: 'streetfood', price: 140, lq: 10, cooldown: 20, desc: 'Burgers, bao and a cold one under one roof.' },
    { id: 'havnebad-sauna', tier: 1, name: 'Sauna at the harbour bath', at: 'havnebad', price: 180, lq: 14, cooldown: 30, desc: 'Sweat out the week at Aarhus Ø, then jump in the fjord.' },
    { id: 'gamleby-visit', tier: 1, name: 'Afternoon in Den Gamle By', at: 'gamleby', price: 170, lq: 13, cooldown: 40, desc: 'Stroll through the old market town.' },
    { id: 'permanente-swim', tier: 1, name: 'Sunrise swim at Den Permanente', at: 'havnebad', price: 60, lq: 8, cooldown: 15, desc: 'Cold water, warm feeling.' },
    // tier 2: a proper outing
    { id: 'aros-ticket', tier: 2, name: 'Gallery day at ARoS', at: 'aros', price: 190, lq: 17, cooldown: 45, desc: 'Your rainbow panorama, in the sky above Aarhus.' },
    { id: 'harbour-kayak', tier: 2, name: 'Kayak on the bay', at: 'aarhuso', price: 250, lq: 20, cooldown: 45, desc: 'Paddle from Aarhus Ø out into Aarhus Bugt.' },
    { id: 'friheden-day', tier: 2, name: 'A day at Tivoli Friheden', at: 'friheden', price: 380, lq: 28, cooldown: 60, desc: 'Rollercoasters and candy floss.' },
    { id: 'agf-match', tier: 2, name: 'AGF match at Ceres Park', at: 'ceres', price: 320, lq: 26, cooldown: 60, desc: 'Hvid og blå, sang og brøl.' },
    { id: 'godsbanen-show', tier: 2, name: 'Show at Godsbanen', at: 'godsbanen', price: 280, lq: 22, cooldown: 60, desc: 'Culture in the old freight yard.' },
    // tier 3: big nights
    { id: 'train-concert', tier: 3, name: 'Concert at Train', at: 'train', price: 450, lq: 32, cooldown: 90, desc: 'Loud music on the harbour front.' },
    { id: 'latiner-dinner', tier: 3, name: 'Dinner in Latinerkvarteret', at: 'latiner', price: 600, lq: 38, cooldown: 90, desc: 'Three courses on cobblestones.' },
    { id: 'dokk1-weekend', tier: 3, name: 'Weekend at Dokk1 and the waterfront', at: 'dokk1', price: 900, lq: 48, cooldown: 120, desc: 'Books, coffee, and the best view of the harbour.' },
    // tier 4: big-ticket
    { id: 'salling-spree', tier: 4, name: 'Shopping spree at Salling', at: 'salling', price: 1500, lq: 70, cooldown: 180, desc: 'New jacket, new shoes, new you.' },
    { id: 'oe-spa', tier: 4, name: 'Spa weekend on Aarhus Ø', at: 'aarhuso', price: 3500, lq: 110, cooldown: 360, desc: 'The full treatment, harbour view included.' },
  ],
};

export const getShop = (cityId) => SHOP[cityId] || [];

// ---------------------------------------------------------------------------------------------
// Vehicle shops (HOME & VEHICLES). Real shops come from world.getVehicleShops() (OSM): bicycle shops,
// rental agencies and bike rentals. OSM has NO car dealers or scooter shops in Aarhus, so these are INVENTED local
// dealers (fictional names, no real brands) on real roads; coordinates are WGS84 and are snapped to a free spot.
// Prices of vehicles live in data/vehicles.js (price, rentPerDay, insurance).
// ---------------------------------------------------------------------------------------------

/** International chains and apps we do not use as shop names (matched against the OSM name). */
export const CHAIN_BLOCKLIST = /europcar|sixt|hertz|avis\b|budget|donkey|swapfiets|lime\b|voi\b|bolt|enterprise|nextbike|bycyklen/i;

/** What each kind of shop does. buy/rent = vehicle type ids from data/vehicles.js; repair = repair service. */
export const SHOP_KINDS = {
  bicycle: { label: 'Bicycle shop', buy: ['bike', 'ebike', 'cargobike'], rent: [], repair: true, color: 'blue' },
  bikeRental: { label: 'Bike rental', buy: [], rent: ['ebike', 'cargobike'], repair: false, color: 'gold' },
  rental: { label: 'Car rental', buy: [], rent: ['smallcar', 'van'], repair: false, color: 'gold' },
  dealer: { label: 'Dealer', buy: [], rent: [], repair: true, color: 'orange' }, // buy/rent set per dealer
};

export const DEALERS = {
  aarhus: [
    {
      id: 'dealer-viborgvej', name: 'Viborgvej Brugtvogne', street: 'Viborgvej', lat: 56.158271, lon: 10.191384,
      blurb: 'Honest used cars and delivery vans, no frills.', buy: ['smallcar', 'van'], rent: ['van'],
    },
    {
      id: 'dealer-randersvej', name: 'Østjysk Bilhandel', street: 'Randersvej', lat: 56.172554, lon: 10.203902,
      blurb: 'Family-run car dealer on Randersvej since 1978.', buy: ['smallcar', 'van'], rent: ['smallcar', 'van'],
    },
    {
      id: 'dealer-silkeborgvej', name: 'Silkeborgvej Scooter & Cykel', street: 'Silkeborgvej', lat: 56.156327, lon: 10.185953,
      blurb: 'Scooters, e-bikes and a workshop out the back.', buy: ['scooter', 'ebike', 'bike'], rent: ['ebike'],
    },
  ],
};

export const getDealers = (cityId) => DEALERS[cityId] || [];
