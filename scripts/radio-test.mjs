import assert from 'node:assert/strict';
import { RadioPlayer } from '../src/audio/RadioPlayer.js';

const stations = [{ url: 'https://example.test/a', name: 'A' }, { url: 'https://example.test/b', name: 'B' }];
const created = [];
let rejectPlay = null;
const factory = () => {
  const media = {
    src: '', pauses: 0, loads: 0,
    play() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; if (rejectPlay) reject(rejectPlay); }); },
    pause() { this.pauses++; },
    removeAttribute() { this.src = ''; },
    load() { this.loads++; },
  };
  created.push(media);
  return media;
};
const radio = new RadioPlayer(stations, factory);
radio.setEnvironment(true, false, false, 0.4);
assert.equal(created.length, 0, 'no network until user enables radio');
radio.toggle();
assert.equal(created.length, 1);
assert.equal(created[0].src, stations[0].url);
created[0].onplaying();
assert.equal(radio.status, 'Live');
radio.setEnvironment(true, false, false, 0.2);
assert.equal(created.length, 1);
assert.equal(created[0].volume, 0.2);
radio.next();
assert.equal(created[0].src, '');
assert.equal(created[0].onplaying, null);
assert.equal(created[1].src, stations[1].url);
created[0].reject(new Error('stale station failed'));
await Promise.resolve();
assert.equal(radio.status, 'Connecting…', 'old rejection must not break new stream');
created[1].onerror();
assert.match(radio.status, /Unavailable/);
assert.equal(created[1].src, '');
radio.sync();
assert.equal(created.length, 2, 'no automatic retry storm');
radio.toggle(); radio.toggle();
assert.equal(created.length, 3);
radio.setEnvironment(false, false, false, 0.4);
assert.equal(created[2].src, '', 'exit releases stream');
assert.equal(radio.status, 'Available while riding');
radio.setEnvironment(true, true, false, 0.4);
assert.equal(created.length, 3, 'paused car does not connect');
radio.setEnvironment(true, false, true, 0.4);
assert.equal(created.length, 3, 'muted car does not connect');
radio.setEnvironment(true, false, false, 0);
assert.equal(created.length, 3, 'zero volume does not connect');
rejectPlay = { name: 'NotAllowedError' };
radio.setEnvironment(true, false, false, 0.4);
await Promise.resolve();
assert.match(radio.status, /Playback blocked/);
assert.equal(radio.timer, null);
radio.destroy();
radio.sync();
assert.equal(radio.media, null);
assert.equal(created.every(m => m.src === '' && m.onplaying === null), true);
console.log('Radio lifecycle checks passed: opt-in, switching/races, offline/autoplay, mute, pause, exit, teardown.');
