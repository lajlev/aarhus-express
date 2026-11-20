// Native streaming audio, deliberately separate from Web Audio (no CORS routing,
// recording, proxy or bundled broadcasts). No network request until enabled in a car.
export class RadioPlayer {
  constructor(stations, createMedia = () => new Audio()) {
    this.stations = stations;
    this.createMedia = createMedia;
    this.index = 0;
    this.enabled = false;
    this.inCar = false;
    this.paused = false;
    this.muted = false;
    this.volume = 0.45;
    this.status = 'Off';
    this.media = null;
    this.timer = null;
    this.disposed = false;
  }

  get station() { return this.stations[this.index]; }

  toggle() {
    this.enabled = !this.enabled;
    this.sync();
  }

  next() {
    if (!this.stations.length) return;
    this.index = (this.index + 1) % this.stations.length;
    this.stop();
    this.sync();
  }

  setEnvironment(inCar, paused, muted, volume) {
    this.inCar = inCar; this.paused = paused; this.muted = muted;
    this.volume = volume;
    this.sync();
  }

  sync() {
    if (this.disposed) return;
    if (!this.enabled || !this.inCar || this.paused || this.muted || this.volume === 0) {
      this.stop();
      this.status = !this.enabled ? 'Off' : !this.inCar ? 'Available while riding' : 'Paused';
      return;
    }
    if (this.media) { this.media.volume = this.volume; return; }
    // Failed streams are retried only by an explicit toggle/tune or a new car trip.
    if (!this.station) { this.status = 'No stations available'; return; }
    const media = this.createMedia();
    this.media = media;
    media.preload = 'none';
    media.volume = this.volume;
    this.status = 'Connecting…';
    const fail = (message) => {
      if (this.media !== media) return;
      clearTimeout(this.timer);
      this.timer = null;
      media.onplaying = media.onwaiting = media.onstalled = media.onerror = media.onended = null;
      media.pause();
      media.removeAttribute('src');
      media.load();
      this.status = message;
      // Keep the failed object as a latch; stop() releases it on retry.
    };
    const watchdog = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => fail('Unavailable — try next station'), 15000);
    };
    media.onplaying = () => {
      if (this.media !== media) return;
      clearTimeout(this.timer); this.timer = null;
      this.status = 'Live';
    };
    media.onwaiting = media.onstalled = () => {
      if (this.media !== media) return;
      this.status = 'Buffering…';
      watchdog();
    };
    media.onerror = () => fail('Unavailable — try next station');
    media.onended = () => fail('Stream ended — try next station');
    media.src = this.station.url;
    watchdog();
    try {
      Promise.resolve(media.play()).catch((error) => fail(error?.name === 'NotAllowedError'
        ? 'Playback blocked — toggle radio to retry' : 'Unavailable — try next station'));
    } catch { fail('Unavailable — try next station'); }
  }

  stop() {
    clearTimeout(this.timer); this.timer = null;
    const media = this.media;
    this.media = null;
    if (!media) return;
    media.onplaying = media.onwaiting = media.onstalled = media.onerror = media.onended = null;
    media.pause();
    media.removeAttribute('src');
    media.load();
  }

  destroy() { this.stop(); this.disposed = true; }
}
