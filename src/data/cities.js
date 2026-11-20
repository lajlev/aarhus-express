// City definitions. To add a city: add bounds in scripts/cities.mjs, run
// `npm run fetch-map -- <id> && npm run build-map -- <id>`, then add an entry
// here with `available: true`. Landmark ids refer to map.landmarks in the JSON.
// City-specific contacts live in data/contacts.js and shop items in data/shop.js.
export const CITIES = [
  {
    id: 'aarhus',
    name: 'Aarhus',
    country: 'Denmark',
    available: true,
    tagline: 'Smilets by. Cobbles, cargo bikes and a harbour full of cranes.',
    mapUrl: 'maps/aarhus.json',
    accent: 0xf2b134,
    spawn: 'radhus', // landmark id: new games start here
    hospital: 'hospital', // respawn after knock-out
    policeStation: 'police', // respawn after being busted
  },
  { id: 'odense', name: 'Odense', country: 'Denmark', available: false, tagline: 'Coming later.' },
  { id: 'kobenhavn', name: 'København', country: 'Denmark', available: false, tagline: 'Coming later.' },
];

export const getCity = (id) => CITIES.find((c) => c.id === id);
