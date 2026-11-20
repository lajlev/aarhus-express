import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Vehicle physics needs only Phaser's event emitter, not a browser renderer.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'phaser') return { url: 'data:text/javascript,import { EventEmitter } from "node:events"; export default { Events: { EventEmitter } };', shortCircuit: true };
    return next(specifier, context);
  },
});
const { Vehicle } = await import('../src/entities/Vehicle.js');
function simulate(type, surface, driver = 'player') {
  const sprite = new Proxy({}, { get: () => () => sprite });
  const world = {
    surfaceAt: () => surface,
    isWater: () => surface === 'water',
    isBuilding: () => surface === 'building',
    pushOut: (x, y) => ({ x, y, hit: false }),
  };
  const v = new Vehicle({ add: { image: () => sprite } }, world, type, 0, 0, { driver });
  v.input.throttle = 1;
  v.vx = 40;
  for (let i = 0; i < 60; i++) v.update(1 / 60);
  return v;
}
for (const type of ['bike', 'cargobike']) {
  for (const driver of ['player', 'ai']) {
    const road = simulate(type, 'road', driver);
    for (const surface of ['foot', 'ground']) {
      assert.equal(simulate(type, surface, driver).speed, road.speed, `${type}/${driver}: ${surface} matches road`);
    }
    assert.ok(simulate(type, 'green', driver).speed < road.speed, 'grass still slows bikes');
    const water = simulate(type, 'water', driver);
    assert.ok(water.speed < road.speed && water.health < road.health, 'deep water remains hazardous');
    assert.equal(simulate(type, 'building', driver).x, 0, 'buildings still block bikes');
  }
}
for (const type of ['smallcar', 'scooter']) {
  assert.ok(simulate(type, 'ground').speed < simulate(type, 'road').speed, `${type} retains ground penalty`);
}
console.log('Bike terrain checks passed (city/cargo, player/AI, grass, water, buildings, other vehicles).');
