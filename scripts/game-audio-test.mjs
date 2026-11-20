import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'phaser') return { url: 'data:text/javascript,import { EventEmitter } from "node:events"; export default { Events: { EventEmitter }, Scenes: { Events: { SHUTDOWN: "shutdown" } } };', shortCircuit: true };
  return next(specifier, context);
} });
const dom = () => {
  const e = new EventEmitter();
  e.addEventListener = e.on; e.removeEventListener = e.off;
  return e;
};
globalThis.window = dom();
globalThis.document = dom();
document.hidden = false;
globalThis.localStorage = { getItem() { throw Error('storage denied'); }, setItem() { throw Error('storage denied'); } };
const media = [];
globalThis.Audio = class {
  constructor() { media.push(this); }
  play() { return Promise.resolve(); }
  pause() { this.stopped = true; }
  load() {}
  removeAttribute() { this.src = ''; }
};
const { GameAudio } = await import('../src/audio/GameAudio.js');
const scene = { events: new EventEmitter(), input: new EventEmitter() };
scene.input.keyboard = new EventEmitter();
const player = { px: 0, py: 0, vehicle: null, dead: false };
const audio = new GameAudio({ scene, player, world: { surfaceAt: () => 'road' } });
assert.equal(media.length, 0);
audio.toggleRadio();
assert.equal(media.length, 0, 'no radio on foot');
player.vehicle = { def: { bike: true, cyclist: true }, drivable: true };
audio.update(1 / 60);
assert.equal(media.length, 1, 'radio plays on bicycles');
player.vehicle = { def: { bike: true }, drivable: true };
audio.update(1 / 60);
assert.equal(media.length, 1, 'radio continues on scooters');
player.vehicle = { def: {}, drivable: true };
audio.update(1 / 60);
assert.equal(media.length, 1, 'radio continues in cars');
scene.events.emit('pause');
assert.equal(media[0].src, '');
scene.events.emit('resume');
assert.equal(media.length, 2);
window.emit('blur');
assert.equal(media[1].src, '');
window.emit('focus');
assert.equal(media.length, 3);
audio.toggleMute();
assert.equal(media[2].src, '');
audio.changeVolume(-10);
assert.equal(audio.volume, 0);
audio.changeVolume(10);
assert.equal(audio.volume, 1);
audio.destroy();
scene.events.emit('shutdown');
assert.equal(window.listenerCount('blur'), 0);
assert.equal(document.listenerCount('visibilitychange'), 0);
assert.equal(scene.input.keyboard.listenerCount('keydown'), 0);
assert.equal(scene.events.listenerCount('pause'), 0);
console.log('Game audio integration checks passed: storage failure, on-foot/bike/car eligibility, pause/focus, volume and cleanup.');
