// Game-owned audio lifecycle. Public UI API: unlock, toggleMute, changeVolume,
// toggleRadio, nextStation, getStatus. No changes to gameplay/save state.
import { SoundEffects } from './SoundEffects.js';
import { RadioPlayer } from './RadioPlayer.js';
import { RADIO_STATIONS } from '../data/radio.js';

const SETTINGS_KEY = 'aarhus-express:audio:v1';

export class GameAudio {
  constructor(ctx) {
    this.ctx = ctx;
    this.volume = 0.45;
    this.muted = false;
    this.paused = false;
    this.blurred = document.hidden;
    this.inCar = false;
    this.disposed = false;
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (Number.isFinite(settings?.volume)) this.volume = Math.max(0, Math.min(1, settings.volume));
      this.muted = settings?.muted === true;
    } catch { /* Audio remains optional when storage is unavailable. */ }
    this.effects = new SoundEffects(ctx);
    this.radio = new RadioPlayer(RADIO_STATIONS);
    this.onGesture = () => this.unlock();
    this.onPause = () => { this.paused = true; this.sync(); };
    this.onResume = () => { this.paused = false; this.sync(); };
    this.onBlur = () => { this.blurred = true; this.sync(); };
    this.onFocus = () => { this.blurred = document.hidden; this.sync(); };
    this.onVisibility = () => { this.blurred = document.hidden; this.sync(); };
    ctx.scene.input.on('pointerdown', this.onGesture);
    ctx.scene.input.keyboard.on('keydown', this.onGesture);
    ctx.scene.events.on('pause', this.onPause);
    ctx.scene.events.on('resume', this.onResume);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.sync();
  }

  unlock() { if (!this.disposed) this.effects.unlock(); }

  sync() {
    if (this.disposed) return;
    const v = this.ctx.player.vehicle;
    this.inCar = !!v && v.drivable && !this.ctx.player.dead;
    this.effects.setVolume(this.volume);
    this.effects.setMuted(this.muted);
    this.effects.setPaused(this.paused || this.blurred);
    this.radio.setEnvironment(this.inCar, this.paused || this.blurred, this.muted, this.volume);
  }

  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* optional */ }
  }

  toggleMute() { this.muted = !this.muted; this.sync(); this.save(); }
  changeVolume(delta) {
    this.volume = Math.round(Math.max(0, Math.min(1, this.volume + delta)) * 100) / 100;
    this.sync(); this.save();
  }
  toggleRadio() { this.unlock(); this.sync(); this.radio.toggle(); }
  nextStation() { this.unlock(); this.radio.next(); }

  getStatus() {
    return {
      muted: this.muted, volume: this.volume, inCar: this.inCar,
      radioEnabled: this.radio.enabled, stationName: this.radio.station?.name || 'No station',
      stationPage: this.radio.station?.page,
      radioStatus: this.radio.status,
    };
  }

  update(dt) {
    const v = this.ctx.player.vehicle;
    const inCar = !!v && v.drivable && !this.ctx.player.dead;
    if (inCar !== this.inCar) this.sync();
    this.effects.update(dt);
  }

  destroy() {
    this.disposed = true;
    const scene = this.ctx.scene;
    scene.input.off('pointerdown', this.onGesture);
    scene.input.keyboard.off('keydown', this.onGesture);
    scene.events.off('pause', this.onPause);
    scene.events.off('resume', this.onResume);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.radio.destroy();
    this.effects.destroy();
  }
}
