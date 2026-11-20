// Driving licence with "klip" (clips). Stored in state.licence = { clips, banLeft, decayT } (saved with the game; loadSave spreads unknown keys).
import { bus } from '../../../core/events.js';
import { POLICE_EV } from '../tuning.js';
import { RULES as R } from './config.js';

export class Licence {
  constructor(ctx) {
    this.ctx = ctx;
    const st = ctx.state;
    if (!st.licence || typeof st.licence !== 'object') st.licence = { clips: 0, banLeft: 0, decayT: 0 };
    this.s = st.licence;
  }

  get() {
    const s = this.s;
    return { clips: s.clips, maxClips: R.CLIPS_TO_BAN, banned: s.banLeft > 0, banLeft: Math.max(0, s.banLeft) };
  }

  get banned() { return this.s.banLeft > 0; }

  _emit(reason) { bus.emit(POLICE_EV.LICENCE, { ...this.get(), reason }); }

  /** Add clips (only for car drivers); returns true when this started a ban. */
  addClips(n) {
    if (!n || this.banned) return false;
    this.s.clips += n; this.s.decayT = 0;
    if (this.s.clips >= R.CLIPS_TO_BAN) {
      this.s.clips = 0; this.s.banLeft = R.BAN_SECONDS;
      this._emit('ban');
      return true;
    }
    this._emit('clip');
    return false;
  }

  update(dt) {
    const s = this.s;
    if (s.banLeft > 0) {
      s.banLeft -= dt;
      if (s.banLeft <= 0) { s.banLeft = 0; this._emit('ban-ended'); }
    } else if (s.clips > 0) {
      s.decayT += dt;
      if (s.decayT >= R.CLIP_DECAY) { s.decayT = 0; s.clips--; this._emit('decay'); }
    }
  }
}
