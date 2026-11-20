// Browser-independent regression checks for procedural audio and its lifecycle.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'phaser') {
      return {
        url: 'data:text/javascript,import { EventEmitter } from "node:events"; export default {Events:{EventEmitter},Scenes:{Events:{SHUTDOWN:"shutdown"}}};',
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});
const { SoundEffects } = await import('../src/audio/SoundEffects.js');
const { bus, EV } = await import('../src/core/events.js');

class Param {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}

class AudioNode {
  constructor() {
    this.gain = new Param();
    this.frequency = new Param();
  }
  connect() {}
  disconnect() { this.disconnected = true; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

let created = 0;
class MockAudioContext {
  constructor() {
    created++;
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = {};
  }
  createGain() { return new AudioNode(); }
  createOscillator() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createBufferSource() { return new AudioNode(); }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  async resume() {
    if (this.rejectResume) throw new Error('Browser denied audio activation');
    this.state = 'running';
  }
  async close() { this.state = 'closed'; }
}

const player = { px: 0, py: 0, vehicle: null, dead: false };
const scene = { events: new EventEmitter() };
const ctx = { player, scene, world: { surfaceAt: () => 'road' } };
const sound = new SoundEffects(ctx);
assert.equal(await sound.unlock(), false, 'missing Web Audio fails silently');
globalThis.AudioContext = MockAudioContext;
assert.equal(created, 0, 'AudioContext is created only on unlock');
assert.equal(await sound.unlock(), true);
assert.equal(created, 1);

const car = { def: { maxSpeed: 30 }, input: { throttle: 1 }, speedMps: 10, drivable: true };
player.vehicle = car;
sound.update(1 / 60);
const engine = sound.engine;
assert.ok(engine.source.started);
sound.update(1 / 60);
assert.equal(sound.engine, engine, 'engine nodes are reused across frames');
bus.emit(EV.HORN, {});
assert.equal(sound.voices.size, 2);
bus.emit(EV.HORN, {});
assert.equal(sound.voices.size, 2, 'horn has a cooldown');

const pausedVoices = [...sound.voices];
sound.setPaused(true);
assert.equal(sound.master.gain.value, 0);
assert.equal(sound.engine, null);
assert.equal(sound.voices.size, 0);
assert.ok(engine.source.stopped && engine.source.disconnected);
assert.ok(pausedVoices.every(v => v.source.stopped && v.source.disconnected && v.gain.disconnected));
sound.audio.currentTime = 1;
bus.emit(EV.HORN, {});
sound.update(1 / 60);
assert.equal(sound.voices.size, 0, 'paused events stay silent');
assert.equal(sound.engine, null);

sound.setPaused(false);
player.vehicle = { ...car, def: { ...car.def, cyclist: true } };
sound.update(1 / 60);
assert.equal(sound.engine, null, 'bicycles have no motor loop');
bus.emit(EV.HORN, {});
assert.equal(sound.voices.size, 2, 'bicycle bell plays');
const mutedVoices = [...sound.voices];
sound.setMuted(true);
assert.equal(sound.master.gain.value, 0);
assert.equal(sound.voices.size, 0);
assert.ok(mutedVoices.every(v => v.source.stopped && v.source.disconnected));
sound.audio.currentTime = 2;
bus.emit(EV.HORN, {});
assert.equal(sound.voices.size, 0, 'muted events stay silent');
sound.setMuted(false);

player.vehicle = null;
for (let i = 0; i < 10; i++) {
  player.px += 1;
  sound.update(1 / 60);
}
assert.equal(sound.voices.size, 1, 'footsteps follow travelled distance');
const step = [...sound.voices][0];
step.source.onended();
assert.equal(sound.voices.size, 0, 'finished voices leave the pool');
assert.ok(step.source.disconnected && step.filter.disconnected && step.gain.disconnected);
for (let i = 0; i < 30; i++) sound.update(1 / 60);
assert.equal(sound.voices.size, 0, 'stationary player makes no footsteps');
player.px += 1000;
sound.update(1 / 60);
assert.equal(sound.voices.size, 0, 'teleports make no footsteps');

for (let i = 0; i < 100; i++) sound._tone(50, 30, 0.1, 0.1, 'sine');
assert.equal(sound.voices.size, 10, 'one-shot voices are bounded');
sound.setVolume(0);
assert.equal(sound.voices.size, 0);
sound.setVolume(0.5);
assert.equal(sound.master.gain.value, 0.5);
sound.setVolume(NaN);
assert.equal(sound.volume, 0.5, 'invalid volume is ignored');
sound.setVolume(2);
assert.equal(sound.volume, 1, 'volume is clamped');
sound.setVolume(0.5);

bus.emit(EV.VEHICLE_DAMAGED, { vehicle: { x: player.px + 10000, y: 0 }, impact: 10 });
assert.equal(sound.voices.size, 0, 'distant collisions are silent');
bus.emit(EV.VEHICLE_DAMAGED, { vehicle: { x: player.px, y: 0 }, impact: 0 });
assert.equal(sound.voices.size, 0, 'non-impact damage makes no crash');
bus.emit(EV.VEHICLE_DAMAGED, { vehicle: { x: player.px, y: 0 }, impact: 10 });
assert.equal(sound.voices.size, 2, 'nearby collision plays');

player.vehicle = car;
sound.update(1 / 60);
const finalEngine = sound.engine;
const finalVoices = [...sound.voices];
sound.destroy();
assert.equal(sound.voices.size, 0);
assert.equal(sound.engine, null);
assert.equal(sound.audio.state, 'closed');
assert.ok(sound.master.disconnected);
assert.ok(finalEngine.source.stopped && finalEngine.source.disconnected);
assert.ok(finalVoices.every(v => v.source.stopped && v.source.disconnected && v.gain.disconnected));
assert.equal(await sound.unlock(), false, 'destroyed audio cannot be reactivated');
assert.doesNotThrow(() => sound.destroy(), 'destroy is idempotent');
scene.events.emit('shutdown');
for (const event of [EV.HORN, EV.VEHICLE_DAMAGED, EV.VEHICLE_DESTROYED]) {
  assert.equal(bus.listenerCount(event), 0, 'scene shutdown removes listeners');
}

// Rejected resume is contained, and a later trusted gesture can retry.
const rejectedScene = { events: new EventEmitter() };
const rejected = new SoundEffects({ ...ctx, scene: rejectedScene });
class RejectingAudioContext extends MockAudioContext {
  constructor() { super(); this.rejectResume = true; }
}
globalThis.AudioContext = RejectingAudioContext;
assert.equal(await rejected.unlock(), false, 'resume rejection is contained');
rejected.update(1 / 60);
assert.equal(rejected.engine, null, 'suspended context stays silent');
rejected.audio.rejectResume = false;
assert.equal(await rejected.unlock(), true, 'later activation can retry');
rejected.destroy();
rejectedScene.events.emit('shutdown');
delete globalThis.AudioContext;

console.log('Sound effects checks passed: lazy/rejected unlock, engine reuse, bell, footsteps, voice bounds, distance, pause/mute/volume, destruction and scene listener cleanup.');
