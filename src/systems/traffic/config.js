// Traffic tuning. Distances in metres unless suffixed Px. Speeds in m/s.
import { PX } from '../../config.js';

export const T = {
  // ---- cars ----
  CAR_TARGET: 26, // AI cars kept alive around the player (scaled by density)
  CAR_MAX: 40, // hard cap
  CAR_SPAWN_MIN: 70 * PX, // spawn ring, px (camera half-diagonal is ~65 m)
  CAR_SPAWN_MAX: 170 * PX,
  CAR_DESPAWN: 230 * PX,
  CAR_SPAWN_EVERY: 0.25, // s between spawn attempts
  BRAKE: 5, // comfortable deceleration used for car-following, m/s^2
  MIN_GAP: 1.6, // m bumper gap kept when queueing
  TICK_NEAR: 1 / 30, // AI decision period, on screen
  TICK_FAR: 1 / 6, // off screen
  NEAR_MARGIN: 220, // px around the camera that counts as "near"
  // ---- parked ----
  PARK_TARGET: 28,
  PARK_MIN: 10 * PX,
  PARK_MAX: 140 * PX,
  PARK_DESPAWN: 200 * PX,
  PARK_MIN_ROAD: 6 * PX, // only park on roads at least this wide
  PARK_EVERY: 0.5,
  // ---- pedestrians ----
  PED_TARGET: 48,
  PED_MAX: 60,
  PED_SPAWN_MIN: 20 * PX,
  PED_SPAWN_MAX: 115 * PX,
  PED_DESPAWN: 150 * PX,
  PED_SPAWN_EVERY: 0.1,
  PED_WALK: [1.1, 1.8], // m/s
  PED_FLEE: [5.2, 7.0],
  PED_NEAR_MARGIN: 80,
  PED_TICK_FAR: 1 / 5,
  // ---- AI cyclists (separate pool, counted apart from cars) ----
  CYC_TARGET: 26, // kept alive around the player in the city centre
  CYC_MAX: 32, // hard cap
  CYC_CENTRE: 'radhus', // landmark id that defines "central Aarhus"
  CYC_CENTRE_R: 2600 * PX, // inside this radius (2.6 km) of the centre = full density
  CYC_OUTSKIRTS: 0.45, // density multiplier far from the centre
  CYC_SPAWN_MIN: 45 * PX,
  CYC_SPAWN_MAX: 150 * PX,
  CYC_SPEED: [4.2, 6.2], // m/s cruise
  CYC_LANE_OFF: 0.9, // m from the road edge to the cyclist centre line (kerb side, outside the car lane)
  CYC_WOBBLE: 0.16,
  CYC_PATH_SHARE: 0.55, // share of cyclists spawned on the separate cycleway graph (map.bike) when it exists
  // ---- parked bike racks (clusters near landmarks) ----
  RACK_ACTIVATE: 105 * PX, // spawn when the player is this close
  RACK_DESPAWN: 190 * PX,
  RACK_SIZE: [3, 8],
  RACK_SLOT: 0.72, // m between bikes in a rack
  // ---- mixes (weights) ----
  TRAFFIC_MIX: { smallcar: 10, van: 2.5, scooter: 3.2, taxi: 2.2, servicevan: 0.7, coupe: 0.6 },
  CYCLE_MIX: { bike: 8, cargobike: 2.4 }, // cargo bike ~23% of cyclists (was ~7% of all traffic)
  PARK_MIX: { smallcar: 8, van: 2.2, scooter: 3.0, bike: 3.4, cargobike: 2.4, taxi: 0.9, servicevan: 0.7, coupe: 0.4 },
};

/** Fixed paint per type (otherwise random PAINT). */
export const TYPE_COLORS = {
  taxi: [0xf4d03f],
  servicevan: [0x2f6bb0],
};

/** Bike-rack clusters. `lm` = landmark id in the map (uses its x,y); `ll` = [lat, lon] when the map has no such landmark.
 *  `racks` = how many racks to try near the anchor, `spread` = search radius in metres. */
export const RACK_SITES = [
  { id: 'aarhush', lm: 'aarhush', racks: 4, spread: 90 }, // Aarhus H
  { id: 'dokk1', lm: 'dokk1', racks: 3, spread: 70 },
  { id: 'latiner', lm: 'latiner', racks: 3, spread: 90 }, // Latinerkvarteret
  { id: 'uni', ll: [56.1688, 10.2030], racks: 5, spread: 120 }, // Aarhus Universitet / Universitetsparken (approximate)
  { id: 'streget', lm: 'strøget', racks: 3, spread: 90 },
  { id: 'radhus', lm: 'radhus', racks: 2, spread: 70 },
];
