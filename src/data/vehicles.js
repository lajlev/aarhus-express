// Vehicle types. Units: metres, m/s, m/s^2, rad/s. Converted to world px with PX.
// grip = lateral velocity decay per second (higher = less sliding).
// offroad = top-speed multiplier on grass/ground. capacity = cargo units.
// The foundation tunes `smallcar`; the traffic specialist tunes the rest.
export const VEHICLES = {
  smallcar: {
    price: 45000, rentPerDay: 600, insurance: 280, // used hatchback (HOME & VEHICLES: price, rent and ownership fields only)
    name: 'Hatchback', tex: 'veh-smallcar', length: 4.0, width: 1.85,
    maxSpeed: 31, accel: 11, brake: 26, reverse: 9, steer: 2.7, grip: 9, drag: 0.35,
    health: 100, capacity: 3, mass: 10, offroad: 0.45, tint: true, weight: 6,
  },
  van: {
    price: 90000, rentPerDay: 900, insurance: 420,
    name: 'Delivery van', tex: 'veh-van', length: 5.3, width: 2.1,
    maxSpeed: 25, accel: 7, brake: 20, reverse: 7, steer: 2.1, grip: 8, drag: 0.4,
    health: 150, capacity: 6, mass: 18, offroad: 0.4, tint: true, weight: 2,
  },
  scooter: {
    price: 18000, insurance: 90,
    name: 'Scooter', tex: 'veh-scooter', length: 1.9, width: 0.8, bike: true,
    maxSpeed: 17, accel: 7, brake: 18, reverse: 2, steer: 3.4, grip: 11, drag: 0.5,
    health: 35, capacity: 1, mass: 2, offroad: 0.7, tint: false, weight: 2,
  },
  // Classic Danish city bike. Full-colour art (no tint); 'veh-bike-rider' is swapped in while ridden.
  // cyclist = AI cyclist rules (bike lane, wobble, bell, falls over when hit); quickSteal = no theft delay.
  bike: {
    price: 2500,
    name: 'City bike', tex: 'veh-bike', riderTex: 'veh-bike-rider', length: 1.9, width: 0.6, bike: true, cyclist: true, quickSteal: true,
    maxSpeed: 7.5, accel: 3.6, brake: 11, reverse: 1.5, steer: 3.6, grip: 13, drag: 0.5, staminaSpeed: true,
    health: 30, capacity: 1, mass: 1.8, offroad: 0.8, tint: false, weight: 3,
  },
  // E-bike (HOME & VEHICLES addition, shares the city-bike art; physics are a starting point for the traffic specialist to tune).
  ebike: {
    price: 9000, rentPerDay: 200,
    name: 'E-bike', tex: 'veh-bike', riderTex: 'veh-bike-rider', length: 1.9, width: 0.6, bike: true, cyclist: true, quickSteal: true,
    maxSpeed: 9.5, accel: 4.6, brake: 12, reverse: 1.5, steer: 3.5, grip: 13, drag: 0.5, staminaSpeed: false,
    health: 32, capacity: 1, mass: 2.4, offroad: 0.8, tint: false, weight: 0,
  },
  cargobike: {
    price: 15000, rentPerDay: 300,
    name: 'Cargo bike', tex: 'veh-cargobike', length: 2.6, width: 1.0, bike: true, cyclist: true,
    maxSpeed: 9, accel: 3.2, brake: 12, reverse: 1.5, steer: 3.0, grip: 12, drag: 0.6,
    health: 40, capacity: 2, mass: 2.5, offroad: 0.85, tint: false, weight: 1,
  },
  coupe: {
    name: 'Sports coupé', tex: 'veh-coupe', length: 4.3, width: 1.9,
    maxSpeed: 39, accel: 14, brake: 30, reverse: 9, steer: 2.9, grip: 9.5, drag: 0.32,
    health: 90, capacity: 1, mass: 10, offroad: 0.35, tint: true, weight: 0,
  },
  police: {
    name: 'Police car', tex: 'veh-police', length: 4.7, width: 1.95,
    maxSpeed: 34, accel: 12, brake: 28, reverse: 9, steer: 2.8, grip: 10, drag: 0.33,
    health: 140, capacity: 2, mass: 13, offroad: 0.45, tint: false, weight: 0,
  },
  taxi: {
    name: 'Taxi', tex: 'veh-taxi', length: 4.5, width: 1.85,
    maxSpeed: 33, accel: 11, brake: 26, reverse: 9, steer: 2.6, grip: 9, drag: 0.34,
    health: 115, capacity: 3, mass: 11, offroad: 0.42, tint: true, weight: 2,
  },
  // Letbane-adjacent service van (blue paint on the delivery-van body)
  servicevan: {
    name: 'Letbane service van', tex: 'veh-van', length: 5.3, width: 2.1,
    maxSpeed: 24, accel: 7, brake: 20, reverse: 7, steer: 2.1, grip: 8, drag: 0.4,
    health: 150, capacity: 8, mass: 18, offroad: 0.4, tint: true, weight: 1,
  },
  // City bus (JOBS bus shifts only; never in traffic, not stealable). Physics: traffic specialist.
  bus: {
    name: 'City bus', tex: 'veh-bus', length: 12, width: 2.55,
    maxSpeed: 17, accel: 2.4, brake: 9, reverse: 3, steer: 1.05, grip: 8, drag: 0.5,
    health: 420, capacity: 0, mass: 60, offroad: 0.25, tint: false, weight: 0, stealable: false,
  },
  // Light-rail tram: rails only, not stealable, never spawned by TrafficSystem.spawnVehicle.
  tram: {
    name: 'Letbane tram', tex: 'veh-tram', length: 24, width: 2.65,
    maxSpeed: 20, accel: 1.5, brake: 8, reverse: 0, steer: 0.2, grip: 20, drag: 0.2,
    health: 1000, capacity: 0, mass: 120, offroad: 0.05, tint: false, weight: 0,
    rails: true, stealable: false,
  },
};

/** Paint colours for tinted vehicles (white texture * tint). */
export const PAINT = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e, 0x8e44ad, 0xe67e22, 0x7f8c8d, 0x1abc9c, 0x2c2c2c];
