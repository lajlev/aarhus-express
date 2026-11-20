// Bounding boxes for cities the map pipeline knows about.
// Add a new city here, then run: npm run fetch-map -- <id> && npm run build-map -- <id>
export const CITY_BOUNDS = {
  aarhus: {
    name: 'Aarhus',
    // Centre, Latinerkvarteret, Åboulevarden, harbour + Aarhus Ø edge,
    // Frederiksbjerg, Trøjborg, the Aarhus Ø harbour basins, plus a southern strip for Tivoli Friheden
    // and Ceres Park.
    bbox: { south: 56.129, west: 10.182, north: 56.175, east: 10.236 },
  },
};
