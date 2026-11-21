/**
 * GamblingSystem: scratch cards, slot machines and the betting app.   OWNER: economy specialist
 * Constructed by GameScene ONLY when the `gambling` option is on (ctx.systems.gambling is null otherwise). Money only: never an LQ effect.
 * All names are invented (Skrab & Vind, Fyrtårnet, Bookie Bjarne); the maths and RTP live in ./games.js.
 *
 * VENUES (from the real map data, no international chains)
 *   scratch  kiosks and supermarkets: OSM POIs whose name matches kiosk / nærbutik / kolonial / SuperBrugsen / Letkøb / Netto / Føtex /
 *            Kvickly / Meny / købmand / 365discount (bakeries, co-ops and food stalls excluded)
 *   slot     bars within 300 m of Latinerkvarteret and Jægergårdsgade (landmarks `latiner`, `jaegergard`)
 *   E within 3.5 m of a venue pin opens the Gamble overlay (scenes/GamblingScene.js). Pins are drawn once into one Graphics.
 *
 * PUBLIC API (ctx.systems.gambling)
 *   venues[], nearest(), activeVenue (set before OPEN_OVERLAY 'gamble')
 *   buyScratch(tierId)   -> { ok, reason?, card: { tier, price, mult, prize, cells, winSymbol, paid } }  charges the price now
 *   payScratch(card)     -> pays the prize once (the scene calls it on reveal; closing the scene early still pays)
 *   spinSlot(stake)      -> { ok, reason?, spin: { stake, mult, prize, reels, near, line, paid } }  charges the stake now
 *   payWin(spin)         -> pays the prize once (after the reel animation; closing early still pays)
 *   markets()            -> betting markets with current odds; placeBet(marketId, stake) -> { ok, bet }
 *   Bets settle by REAL game events: the AGF result when the `match` city event ends, "an event starts within N hours" by
 *   TASKS_EV.EVENT_STARTED (rain included), and expire as lost at their deadline (checked every second).
 * State: state.gambling = { bets: [{ id, market, kind, pick, label, stake, odds, placedMin, endMin, status, payout, note }], betSeq, stats }
 * Events: ECON-style via bus: 'gambling:bet' { bet }, 'gambling:settled' { bet }, 'gambling:play' { game, stake, prize }
 */
import { PX, DEPTH, FONT } from '../../config.js';
import { bus, EV, listen, pager } from '../../core/events.js';
import { TASKS_EV } from '../missions/events.js';
import { EVENT_RULES } from '../../data/tasks.js';
import { SCRATCH, SLOT, BET, scratchPlay, slotPlay, matchResult, eventStartProb, oddsFor } from './games.js';

export const GAMBLING_EV = { BET: 'gambling:bet', SETTLED: 'gambling:settled', PLAY: 'gambling:play' };
const SCRATCH_RE = /kiosk|nærbutik|kolonial|brugsen|letkøb|netto|føtex|kvickly|meny|købmand|365discount/i;
const SCRATCH_NOT = /bager|cooperativet|asian|pølse/i;
const INTERACT_R = 3.5 * PX;
const kr = (n) => `kr ${Math.round(n).toLocaleString('da-DK')}`;

export class GamblingSystem {
  constructor(ctx) {
    this.ctx = ctx;
    const st = ctx.state;
    st.gambling ||= { bets: [], betSeq: 1, stats: { staked: 0, won: 0, plays: 0 } };
    st.gambling.bets ||= [];
    st.gambling.betSeq ||= 1;
    this.st = st.gambling;
    this.rng = Math.random; // tests may replace
    this.activeVenue = null;
    this.venues = this._buildVenues();
    this._near = null;
    this._shown = null;
    this._seenGamePrompt = undefined;
    this._checkT = 0;
    this._scanT = 0;
    this.g = ctx.scene.add.graphics().setDepth(DEPTH.marker);
    this._drawPins();
    this.labels = [];
    for (let i = 0; i < 3; i++) {
      this.labels.push(ctx.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#ffd9f4', stroke: '#16181d', strokeThickness: 4, fontStyle: 'bold' }).setOrigin(0.5, 1).setDepth(DEPTH.label).setScale(0.8).setVisible(false));
    }
    this._onE = (ev) => { if (!ev?.repeat) this._pressE(); };
    ctx.scene.input.keyboard?.on('keydown-E', this._onE);
    listen(ctx.scene, TASKS_EV.EVENT_STARTED, ({ event }) => this._onEventStarted(event));
    listen(ctx.scene, TASKS_EV.EVENT_ENDED, ({ event }) => this._onEventEnded(event));
  }

  get eco() { return this.ctx.systems.economy; }
  now() { return this.eco.getClock().minutes; }

  // ------------------------------------------------------------------ venues
  _buildVenues() {
    const w = this.ctx.world, out = [];
    const pois = w.pois || [];
    for (const p of pois) {
      if ((p.k === 'shop' || p.k === 'food') && SCRATCH_RE.test(p.n || '') && !SCRATCH_NOT.test(p.n || '')) out.push({ id: `sc${out.length}`, kind: 'scratch', name: p.n, x: p.x, y: p.y });
    }
    for (const lmId of ['latiner', 'jaegergard']) {
      const lm = w.landmark(lmId);
      if (!lm) continue;
      const lx = lm.lx ?? lm.x, ly = lm.ly ?? lm.y;
      for (const p of pois) {
        if (p.k !== 'bar' || !p.n) continue;
        if (Math.hypot((p.lx ?? p.x) - lx, (p.ly ?? p.y) - ly) / PX > 300) continue;
        if (out.some((v) => v.kind === 'slot' && v.name === p.n)) continue;
        out.push({ id: `sl${out.length}`, kind: 'slot', name: p.n, x: p.x, y: p.y, area: lm.n });
      }
    }
    return out;
  }

  _drawPins() {
    const g = this.g;
    for (const v of this.venues) {
      const r = 1.9 * PX, c = v.kind === 'slot' ? 0xe05cff : 0x4cc38a;
      g.fillStyle(c, 0.2).fillCircle(v.x, v.y, r);
      g.lineStyle(2, c, 0.9).strokeCircle(v.x, v.y, r);
      g.fillStyle(0x16181d, 1).fillCircle(v.x, v.y, 0.95 * PX);
      g.fillStyle(c, 1);
      if (v.kind === 'slot') for (let i = -1; i <= 1; i++) g.fillRect(v.x + i * 0.5 * PX - 0.18 * PX, v.y - 0.4 * PX, 0.36 * PX, 0.8 * PX);
      else { g.fillRoundedRect(v.x - 0.55 * PX, v.y - 0.4 * PX, 1.1 * PX, 0.8 * PX, 2); g.lineStyle(1.5, 0x16181d, 1).lineBetween(v.x - 0.35 * PX, v.y + 0.25 * PX, v.x + 0.35 * PX, v.y - 0.25 * PX); }
    }
  }

  pins() { return this.venues.map((v) => ({ kind: v.kind === 'slot' ? 'slot' : 'scratch', name: v.name, x: v.x, y: v.y })); }

  nearest(r = INTERACT_R) {
    const p = this.ctx.player;
    if (!p || p.dead || p.vehicle) return null;
    let best = null, bd = r;
    for (const v of this.venues) { const d = Math.hypot(v.x - p.px, v.y - p.py); if (d < bd) { bd = d; best = v; } }
    return best;
  }

  _blocked() {
    const sc = this.ctx.scene;
    return sc.scene.isActive('Overlay') || sc.scene.isActive('JobApp') || sc.scene.isActive('Gamble') || !sc.scene.isActive();
  }

  _pressE() {
    if (this._blocked()) return;
    const v = this.nearest();
    if (!v) return;
    if (this.eco?._nearest?.()) return; // home door / shop pad wins
    this.ctx.player.keys.enter.reset();
    this.open(v);
  }

  open(v) {
    this.activeVenue = v;
    bus.emit(EV.OPEN_OVERLAY, { mode: 'gamble' });
  }

  _updatePrompt() {
    const sc = this.ctx.scene;
    const v = !this._blocked() ? this.nearest() : null;
    const eco = v && this.eco?._nearest?.();
    if (v && !eco) {
      const text = v.kind === 'slot' ? `[E] Slot machine: ${v.name}` : `[E] Scratch cards: ${v.name}`;
      if (text !== this._shown || sc.lastPrompt !== this._seenGamePrompt || this._clock - (this._promptAt || -1) > 0.25) {
        this._shown = text; this._seenGamePrompt = sc.lastPrompt; this._promptAt = this._clock;
        bus.emit(EV.PROMPT, { text });
      }
    } else if (this._shown) {
      this._shown = null;
      bus.emit(EV.PROMPT, { text: sc.lastPrompt ?? null });
    }
  }

  // ------------------------------------------------------------------ plays
  _charge(stake, why) {
    const e = this.eco;
    if (!e.canAfford(stake) && !this.ctx.state.options?.infiniteMoney) return false;
    e.pay(-stake, `gamble: ${why}`, 'gambling');
    this.st.stats.staked += stake;
    this.st.stats.plays++;
    return true;
  }

  _win(prize, why) {
    if (prize <= 0) return;
    this.eco.pay(prize, `gamble win: ${why}`, undefined, { income: false });
    this.st.stats.won += prize;
  }

  buyScratch(tierId) {
    const tier = SCRATCH.tiers.find((t) => t.id === tierId);
    if (!tier) return { ok: false, reason: 'Unknown card' };
    if (!this._charge(tier.price, 'scratch card')) return { ok: false, reason: `You need ${kr(tier.price)}` };
    const r = scratchPlay(this.rng);
    const card = { tier, price: tier.price, mult: r.mult, prize: r.mult * tier.price, cells: r.cells, winSymbol: r.winSymbol, paid: false };
    bus.emit(GAMBLING_EV.PLAY, { game: 'scratch', stake: tier.price, prize: card.prize });
    return { ok: true, card };
  }

  payScratch(card) {
    if (!card || card.paid) return 0;
    card.paid = true;
    this._win(card.prize, 'scratch card');
    if (card.prize > 0) pager(`Skrab & Vind: you won ${kr(card.prize)}!`, 'info', 'Skrab & Vind');
    return card.prize;
  }

  spinSlot(stake) {
    if (!SLOT.stakes.includes(stake)) return { ok: false, reason: 'Stake not offered' };
    if (!this._charge(stake, 'slot machine')) return { ok: false, reason: `You need ${kr(stake)}` };
    const r = slotPlay(this.rng);
    const spin = { stake, mult: r.mult, prize: r.mult * stake, reels: r.reels, near: r.near, line: r.line, paid: false };
    bus.emit(GAMBLING_EV.PLAY, { game: 'slot', stake, prize: spin.prize });
    return { ok: true, spin };
  }

  payWin(spin) {
    if (!spin || spin.paid) return 0;
    spin.paid = true;
    this._win(spin.prize, 'slot machine');
    return spin.prize;
  }

  // ------------------------------------------------------------------ betting
  /** Markets with live odds. Ids: 'match:win|draw|loss' and 'event:<kind>'. */
  markets() {
    const now = this.now(), board = this.ctx.systems.missions?.board;
    const out = [];
    for (const pick of ['win', 'draw', 'loss']) {
      out.push({ id: `match:${pick}`, market: 'match', pick, label: `AGF match: ${BET.match.labels[pick]}`, sub: 'Settled when the next AGF match event ends', odds: BET.match.odds[pick] });
    }
    const cd = board?.st?.cd || {};
    const mul = board?.chanceMul || 1;
    for (const rule of EVENT_RULES) {
      const win = (rule.kind === 'rain' ? BET.rainWindowH : BET.eventWindowH) * 60;
      const p = eventStartProb(rule.kind, win, now, cd, mul);
      const ok = p >= BET.minProb && p <= BET.maxProb;
      out.push({
        id: `event:${rule.kind}`, market: 'event', kind: rule.kind, pick: 'yes', windowMin: win, p, available: ok,
        label: rule.kind === 'rain' ? `Rain starts within ${win / 60} h` : `${rule.name} starts within ${win / 60} h`,
        sub: ok ? `Settled by the city events board (${Math.round(p * 100)}% chance, the book pays ${Math.round(BET.margin * 100)}%)` : p > BET.maxProb ? 'Too likely: no odds offered' : 'Too unlikely right now: no odds offered',
        odds: ok ? oddsFor(p) : 0,
      });
    }
    for (const m of out) if (m.available === undefined) m.available = true;
    return out;
  }

  placeBet(marketId, stake) {
    if (!BET.stakes.includes(stake)) return { ok: false, reason: 'Stake not offered' };
    const m = this.markets().find((q) => q.id === marketId);
    if (!m) return { ok: false, reason: 'Unknown market' };
    if (!m.available) return { ok: false, reason: m.sub };
    if (this.st.bets.filter((b) => b.status === 'open').length >= 8) return { ok: false, reason: 'Max 8 open bets' };
    if (!this._charge(stake, 'bet')) return { ok: false, reason: `You need ${kr(stake)}` };
    const now = this.now();
    const bet = { id: `bt${this.st.betSeq++}`, market: m.market, kind: m.kind || 'match', pick: m.pick, label: m.label, stake, odds: m.odds, placedMin: now, endMin: m.windowMin ? now + m.windowMin : null, status: 'open', payout: 0, note: '' };
    this.st.bets.push(bet);
    bus.emit(GAMBLING_EV.BET, { bet });
    pager(`Bet placed: ${m.label}, ${kr(stake)} at x${m.odds.toFixed(2)}.`, 'info', 'Bookie Bjarne');
    return { ok: true, bet };
  }

  openBets() { return this.st.bets.filter((b) => b.status === 'open'); }

  _settle(bet, won, note) {
    bet.status = won ? 'won' : 'lost';
    bet.payout = won ? Math.round(bet.stake * bet.odds) : 0;
    bet.note = note || '';
    if (won) this._win(bet.payout, 'bet');
    bus.emit(GAMBLING_EV.SETTLED, { bet });
    pager(won ? `Bet won: ${bet.label}. ${kr(bet.payout)} paid. ${note || ''}` : `Bet lost: ${bet.label}. ${note || ''}`, won ? 'info' : 'warn', 'Bookie Bjarne');
    const done = this.st.bets.filter((b) => b.status !== 'open');
    if (done.length > 12) this.st.bets.splice(this.st.bets.indexOf(done[0]), 1); // keep the slip short
  }

  _onEventStarted(ev) {
    const now = this.now();
    for (const b of this.openBets()) {
      if (b.market === 'event' && b.kind === ev.kind && now >= b.placedMin && now <= b.endMin) this._settle(b, true, `${ev.name} started.`);
    }
  }

  _onEventEnded(ev) {
    if (ev.kind !== 'match') return;
    const open = this.openBets().filter((b) => b.market === 'match');
    if (!open.length) return;
    const r = matchResult(this.rng);
    const note = `AGF ${r.agf}-${r.opp}.`;
    for (const b of open) this._settle(b, b.pick === r.result, note);
  }

  _expire() {
    const now = this.now();
    for (const b of this.openBets()) if (b.market === 'event' && now > b.endMin) this._settle(b, false, 'It did not happen in time.');
  }

  // ------------------------------------------------------------------ loop
  update(dt) {
    this._clock = (this._clock || 0) + dt;
    this._updatePrompt();
    this._checkT -= dt;
    if (this._checkT <= 0) { this._checkT = 1; this._expire(); }
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = 0.2;
      const p = this.ctx.player, cam = this.ctx.scene.cameras.main.worldView;
      let li = 0;
      for (const v of this.venues) {
        if (li >= this.labels.length) break;
        if (v.x < cam.x || v.x > cam.right || v.y < cam.y || v.y > cam.bottom) continue;
        if (Math.hypot(v.x - p.px, v.y - p.py) > 40 * PX) continue;
        this.labels[li++].setVisible(true).setText(v.name.toUpperCase()).setPosition(v.x, v.y - 2.4 * PX);
      }
      for (; li < this.labels.length; li++) this.labels[li].setVisible(false);
    }
  }

  destroy() {
    this.ctx.scene.input?.keyboard?.off('keydown-E', this._onE);
    this.g.destroy();
    this.labels.forEach((t) => t.destroy());
  }
}
