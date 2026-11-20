// Original procedural effects. No samples, downloads or changes to game physics.
// Public: unlock() from a user gesture, update(dt), setVolume(0..1),
// setMuted(bool), setPaused(bool), destroy(). GameScene owns this instance.
import { PX } from '../config.js';
import { EV, listen } from '../core/events.js';

const MAX_VOICES = 10;
const HEARING_DISTANCE = 45 * PX;

export class SoundEffects {
  constructor(ctx) {
    this.ctx = ctx;
    this.audio = null;
    this.master = null;
    this.engine = null;
    this.noise = null;
    this.voices = new Set();
    this.volume = 0.55;
    this.muted = false;
    this.paused = false;
    this.destroyed = false;
    this.lastHorn = -Infinity;
    this.lastImpact = -Infinity;
    this.lastBlast = -Infinity;
    this.stepDistance = 0;
    this.lastX = ctx.player.px;
    this.lastY = ctx.player.py;
    listen(ctx.scene, EV.HORN, () => this._horn());
    listen(ctx.scene, EV.VEHICLE_DAMAGED, ({ vehicle, impact }) => {
      if (!vehicle || !(impact > 2) || !this._ready()) return;
      const level = this._near(vehicle.x, vehicle.y);
      if (!level || this.audio.currentTime - this.lastImpact < 0.12) return;
      this.lastImpact = this.audio.currentTime;
      this._noiseBurst(0.12, level * Math.min(0.2, impact * 0.012), 900);
      this._tone(85, 35, 0.14, level * 0.13, 'sine');
    });
    listen(ctx.scene, EV.VEHICLE_DESTROYED, ({ x, y, cause }) => {
      if (!this._ready()) return;
      const level = this._near(x, y);
      if (!level || this.audio.currentTime - this.lastBlast < 0.15) return;
      this.lastBlast = this.audio.currentTime;
      this._noiseBurst(cause === 'sunk' ? 0.3 : 0.48, level * 0.22, cause === 'sunk' ? 1400 : 550);
      if (cause !== 'sunk') this._tone(95, 28, 0.45, level * 0.22, 'sine');
    });
  }

  /** Must be called directly from a keyboard/pointer gesture; failure is silent. */
  async unlock() {
    if (this.destroyed) return false;
    try {
      if (!this.audio) {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return false;
        this.audio = new AudioContext();
        this.master = this.audio.createGain();
        this.master.gain.value = this.muted || this.paused ? 0 : this.volume;
        this.master.connect(this.audio.destination);
        this.noise = this.audio.createBuffer(1, Math.ceil(this.audio.sampleRate * 0.5), this.audio.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.audio.state === 'suspended') await this.audio.resume();
      return !this.destroyed && this.audio.state === 'running';
    } catch {
      return false;
    }
  }

  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    this._applyLevel();
  }

  setMuted(muted) {
    this.muted = !!muted;
    this._applyLevel();
  }

  setPaused(paused) {
    this.paused = !!paused;
    this.stepDistance = 0;
    this.lastX = this.ctx.player.px;
    this.lastY = this.ctx.player.py;
    this._applyLevel();
  }

  _applyLevel() {
    const silent = this.muted || this.paused || this.volume === 0 || this.destroyed;
    if (this.master) this.master.gain.value = silent ? 0 : this.volume;
    if (silent) this._stopAll();
  }

  _ready() {
    return !this.destroyed && !this.muted && !this.paused && this.volume > 0 && this.audio?.state === 'running';
  }

  _near(x, y) {
    return Math.max(0, 1 - Math.hypot(x - this.ctx.player.px, y - this.ctx.player.py) / HEARING_DISTANCE);
  }

  _horn() {
    const v = this.ctx.player.vehicle;
    if (!v || !this._ready() || this.audio.currentTime - this.lastHorn < 0.3) return;
    this.lastHorn = this.audio.currentTime;
    if (v.def.cyclist) {
      this._tone(1650, 1600, 0.35, 0.12, 'sine');
      this._tone(2500, 2450, 0.22, 0.045, 'sine');
    } else {
      this._tone(350, 345, 0.24, 0.1, 'triangle');
      this._tone(440, 435, 0.24, 0.075, 'triangle');
    }
  }

  _tone(start, end, duration, level, type) {
    if (!this._ready() || this.voices.size >= MAX_VOICES) return;
    const source = this.audio.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(start, this.audio.currentTime);
    source.frequency.exponentialRampToValueAtTime(end, this.audio.currentTime + duration);
    this._play(source, null, duration, level);
  }

  _noiseBurst(duration, level, frequency) {
    if (!this._ready() || this.voices.size >= MAX_VOICES) return;
    const source = this.audio.createBufferSource();
    source.buffer = this.noise;
    const filter = this.audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    this._play(source, filter, duration, level);
  }

  _play(source, filter, duration, level) {
    const gain = this.audio.createGain();
    const now = this.audio.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter || gain);
    if (filter) filter.connect(gain);
    gain.connect(this.master);
    const voice = { source, gain, filter };
    this.voices.add(voice);
    source.onended = () => this._release(voice);
    source.start(now);
    source.stop(now + duration + 0.01);
  }

  _release(voice) {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.filter?.disconnect();
    voice.gain.disconnect();
    this.voices.delete(voice);
  }

  _startEngine() {
    const source = this.audio.createOscillator();
    const filter = this.audio.createBiquadFilter();
    const gain = this.audio.createGain();
    source.type = 'sawtooth';
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    this.engine = { source, filter, gain };
  }

  _stopEngine() {
    if (!this.engine) return;
    this.engine.source.stop();
    this.engine.source.disconnect();
    this.engine.filter.disconnect();
    this.engine.gain.disconnect();
    this.engine = null;
  }

  _stopAll() {
    this._stopEngine();
    for (const voice of this.voices) {
      voice.source.stop();
      this._release(voice);
    }
  }

  update(dt) {
    const p = this.ctx.player;
    const distance = Math.hypot(p.px - this.lastX, p.py - this.lastY);
    this.lastX = p.px; this.lastY = p.py;
    if (!this._ready()) { this._stopAll(); this.stepDistance = 0; return; }
    const v = p.vehicle;
    if (v && !v.def.cyclist && v.drivable && !p.dead) {
      if (!this.engine) this._startEngine();
      const speed = Math.min(1, v.speedMps / v.def.maxSpeed);
      const throttle = Math.max(0, v.input.throttle);
      const now = this.audio.currentTime;
      this.engine.source.frequency.setTargetAtTime(38 + speed * 95 + throttle * 18, now, 0.08);
      this.engine.filter.frequency.setTargetAtTime(220 + speed * 420, now, 0.1);
      this.engine.gain.gain.setTargetAtTime(0.035 + speed * 0.035 + throttle * 0.02, now, 0.08);
    } else this._stopEngine();
    if (!v && !p.dead && distance > 0.001 && distance < 4 * PX && dt > 0) {
      this.stepDistance += distance;
      const running = distance / dt > 5 * PX;
      const stride = (running ? 1.05 : 0.7) * PX;
      if (this.stepDistance >= stride) {
        this.stepDistance %= stride;
        const soft = this.ctx.world.surfaceAt(p.px, p.py) === 'green';
        this._noiseBurst(soft ? 0.065 : 0.045, running ? 0.065 : 0.045, soft ? 550 : 1300);
      }
    } else this.stepDistance = 0;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._stopAll();
    this.master?.disconnect();
    if (this.audio) this.audio.close().catch(() => {});
    this.noise = null;
  }
}
