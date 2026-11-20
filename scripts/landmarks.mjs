// Curated real Aarhus places used as pickup/drop-off points, mission givers and
// shop locations. `match` is tested against OSM names; `fallback` is an
// approximate [lat, lon] used only when OSM has no match.
export const LANDMARKS = [
  { id: 'aros', name: 'ARoS Kunstmuseum', kind: 'culture', match: /^ARoS Kunstmuseum$/, fallback: [56.1538, 10.1997] },
  { id: 'dokk1', name: 'Dokk1', kind: 'culture', match: /^Dokk1$/, fallback: [56.1532, 10.2142] },
  { id: 'radhus', name: 'Aarhus Rådhus', kind: 'landmark', match: /^Aarhus Rådhus$/, fallback: [56.1527, 10.2034] },
  { id: 'domkirke', name: 'Aarhus Domkirke', kind: 'landmark', match: /^Aarhus Domkirke$/, fallback: [56.1569, 10.2105] },
  { id: 'gamleby', name: 'Den Gamle By', kind: 'culture', match: /^Den Gamle By$/, fallback: [56.1588, 10.192] },
  { id: 'godsbanen', name: 'Godsbanen', kind: 'culture', match: /Godsbanen/, fallback: [56.1527, 10.1965] },
  { id: 'aarhush', name: 'Aarhus H', kind: 'landmark', match: /^Aarhus H$/, preferNode: true, fallback: [56.1503, 10.2045] },
  { id: 'salling', name: 'Salling', kind: 'shop', match: /^Salling$/, fallback: [56.1546, 10.2071] },
  { id: 'bruuns', name: 'Bruuns Galleri', kind: 'shop', match: /^Bruuns Galleri$/, fallback: [56.149, 10.2047] },
  { id: 'streetfood', name: 'Aarhus Street Food', kind: 'food', match: /Aarhus Street Food/i, fallback: [56.1497, 10.2008] },
  { id: 'train', name: 'Train', kind: 'culture', match: /^Train$/, fallback: [56.1543, 10.2128] },
  { id: 'havnebad', name: 'Aarhus Havnebad (Aarhus Ø)', kind: 'sport', match: /Havnebad|Havsvømmebane/, fallback: [56.1556, 10.2272] },
  { id: 'friheden', name: 'Tivoli Friheden', kind: 'landmark', match: /^Tivoli Friheden$/, fallback: [56.1373, 10.2] },
  { id: 'ceres', name: 'Ceres Park', kind: 'sport', match: /^Ceres Park|Aarhus Stadion|Atletion/, fallback: [56.1318, 10.1966] },
  { id: 'latiner', name: 'Latinerkvarteret', kind: 'landmark', match: /^Latinerkvarteret$/, fallback: [56.1584, 10.2093] },
  { id: 'aarhuso', name: 'Aarhus Ø', kind: 'landmark', match: /^Aarhus Ø$/, fallback: [56.1598, 10.2255] },
  { id: 'containerhavn', name: 'Container harbour docks', kind: 'landmark', match: /^Containerterminal/i, fallback: [56.1435, 10.2295] },
  { id: 'hospital', name: 'Aarhus Hospital (Nørrebrogade)', kind: 'hospital', match: /Kommunehospital|Universitetshospital|Aarhus Sygehus/, fallback: [56.1632, 10.1992] },
  { id: 'police', name: 'Aarhus Hovedpolitistation', kind: 'police', match: /^Aarhus Hovedpolitistation$/, fallback: [56.1489, 10.2005] },
  { id: 'kon', name: 'KØN Museum', kind: 'culture', match: /^KØN$/, fallback: null },
  { id: 'trojborg', name: 'Trøjborg Centret', kind: 'shop', match: /^Trøjborg Centret$/, fallback: [56.172, 10.208] },
  { id: 'osterpar', name: 'Øst for Paradis', kind: 'culture', match: /^Øst for Paradis$/, fallback: null },
];

// Streets used as landmarks: position = a midpoint of the named OSM street.
export const STREET_LANDMARKS = [
  { id: 'mejlgade', street: 'Mejlgade', name: 'Mejlgade', kind: 'landmark' },
  { id: 'jaegergard', street: 'Jægergårdsgade', name: 'Jægergårdsgade', kind: 'landmark' },
  { id: 'randersvej', street: 'Randersvej', name: 'Randersvej', kind: 'landmark' },
  { id: 'ringgaden', street: 'Søndre Ringgade', name: 'Ringgaden (Søndre Ringgade)', kind: 'landmark' },
  { id: 'aboulevarden', street: 'Åboulevarden', name: 'Åboulevarden', kind: 'landmark' },
  { id: 'strøget', street: 'Søndergade', name: 'Strøget (Søndergade)', kind: 'landmark' },
];

// International/non-Danish chains are skipped so POIs feel local.
export const POI_BLOCKLIST = [
  /mc ?donald/i, /burger king/i, /starbucks/i, /7-eleven/i, /^subway/i, /\bkfc\b/i, /domino/i, /pizza hut/i,
  /espresso house/i, /\blidl\b/i, /\baldi\b/i, /^h&m/i, /^zara/i, /circle k/i, /^shell/i, /^q8/i, /rema 1000/i,
  /starbucks/i, /dunkin/i, /costa coffee/i, /\bok plus\b/i,
];

// ---------------------------------------------------------------------------
// Landmark BUILDINGS: footprints that get a generated rooftop sprite
// (public/art/landmarks/<sprite>.png). Matching order per entry:
//   1. osmIds   explicit OSM way/relation ids (stable, preferred)
//   2. name     regex tested against the building's OSM name
//   3. near     [lat, lon, maxMetres, minAreaM2]  the largest footprint near a coordinate
//   within      OSM way id of an area; every footprint whose centroid lies inside gets the sprite
//   groupNear   [metres, minAreaM2]  also take neighbouring footprints around the matched one
// `mode`: 'fit' = sprite fitted to the footprint's oriented bounding box and clipped to the polygon,
//         'swatch' = sprite used as a roof texture on each footprint (clustered landmarks).
// `lm` links to the landmark id in LANDMARKS (name label + nearestLandmark()).
// ---------------------------------------------------------------------------
export const LANDMARK_BUILDINGS = [
  { id: 'aros', lm: 'aros', sprite: 'lm_aros', mode: 'fit', label: 'ARoS', osmIds: ['w23568150'], name: /^ARoS Kunstmuseum$/, near: [56.1539, 10.1997, 60, 1500] },
  { id: 'dokk1', lm: 'dokk1', sprite: 'lm_dokk1', mode: 'fit', label: 'Dokk1', osmIds: ['w522107914'], name: /^Dokk1$/, near: [56.1535, 10.2141, 60, 3000] },
  { id: 'domkirke', lm: 'domkirke', sprite: 'lm_domkirke', mode: 'fit', label: 'Domkirken', osmIds: ['w254079854'], name: /Domkirke$/, near: [56.1569, 10.2105, 60, 1000] },
  { id: 'radhus', lm: 'radhus', sprite: 'lm_radhus', mode: 'fit', label: 'Rådhuset', osmIds: ['w428972747'], name: /^Aarhus Rådhus$/, near: [56.1521, 10.203, 60, 1500] },
  { id: 'isbjerget', lm: null, sprite: 'lm_isbjerget', mode: 'swatch', label: 'Isbjerget', osmIds: ['w446730040', 'w446730041', 'w329409873'], near: [56.164, 10.229, 120, 900] },
  { id: 'gamleby', lm: 'gamleby', sprite: 'lm_gamleby', mode: 'swatch', label: 'Den Gamle By', within: 'w143766187' },
  { id: 'salling', lm: 'salling', sprite: 'lm_salling', mode: 'fit', label: 'Salling', osmIds: ['w107363057'], name: /^Salling$/, near: [56.1544, 10.2071, 60, 1500] },
  { id: 'aarhush', lm: 'aarhush', sprite: 'lm_aarhush', mode: 'fit', label: 'Aarhus H', osmIds: ['w231436752'], near: [56.1501, 10.2047, 80, 3000] },
  { id: 'musikhuset', lm: null, sprite: 'lm_musikhuset', mode: 'fit', label: 'Musikhuset', osmIds: ['r21395181'], name: /^Musikhuset Aarhus$/, near: [56.1531, 10.1986, 80, 3000] },
  { id: 'godsbanen', lm: 'godsbanen', sprite: 'lm_godsbanen', mode: 'swatch', label: 'Godsbanen', osmIds: ['w1415158056'], near: [56.1534, 10.1952, 80, 1500], groupNear: [70, 300] },
];

// Overlay landmarks: no single OSM footprint, so the sprite is placed by coordinate (centre, size in metres, rotation in degrees)
// and drawn over the ground, under any building roofs.
export const LANDMARK_OVERLAYS = [
  // Ceres Park stadium (OSM maps it only as an Atletion sports_centre area, no building) and the container cranes.
  { id: 'ceres', lm: 'ceres', sprite: 'lm_ceres', label: 'Ceres Park', at: [56.1331, 10.1928], wM: 150, hM: 100, rot: 0 },
  { id: 'cranes', lm: 'containerhavn', sprite: 'lm_cranes', label: 'Container harbour', at: [56.1440, 10.2330], wM: 75, hM: 50, rot: 0, quay: true },
];

// Hand-set district seeds [name, lat, lon, reachBias]. Nearest seed wins (distance minus reachBias metres) so this is a
// weighted Voronoi. OSM place=suburb/neighbourhood/quarter nodes (data/<city>/osm-places.json, from scripts/fetch-places.mjs)
// are added on top and override a seed with the same name.
export const DISTRICT_SEEDS = [
  ['Indre By', 56.1560, 10.2085, 150],
  ['Latinerkvarteret', 56.1592, 10.2030, 60],
  ['Midtbyen', 56.1522, 10.2050, 40],
  ['Frederiksbjerg', 56.1430, 10.2010, 330],
  ['Trøjborg', 56.1695, 10.1960, 330],
  ['Aarhus Ø', 56.1635, 10.2265, 330],
  ['Vesterbro', 56.1500, 10.1880, 200],
  ['Øgaderne', 56.1645, 10.2150, 90],
  ['Havnen', 56.1435, 10.2300, 220],
  ['Åbyhøj', 56.1500, 10.1640, 0], // west of the bbox: only wins if the bbox is ever widened
  ['Marselisborg', 56.1320, 10.2110, 150],
];
