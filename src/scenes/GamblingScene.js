// GamblingScene: the scratch-card and slot-machine overlay (opened with E at a gambling venue, option `gambling`).
// OWNER: economy specialist. Pauses Game like the J app. All art is drawn with Graphics (original symbols, no real brands).
//   scratch: 1-3 or Left/Right pick the card (20/50/100 kr), Enter buys, arrows move the cursor, Space/Enter or the mouse scratches a cell,
//            A reveals all, Enter again buys the next card. The prize is decided at purchase and paid when the card is done or you leave.
//   slot:    Left/Right change the stake, Enter/Space spins. Three reels stop one after another; a losing "near miss" lets the third reel
//            tease the missing symbol. The win is paid when the reels stop (or at once when you leave).
// Esc closes. All logic and RTP live in systems/gambling (GamblingSystem + games.js).
import Phaser from 'phaser';
import { bus, EV } from '../core/events.js';
import { C, S, txt, panel, ensureFonts, fmtKr } from '../ui/theme.js';
import { GAME_W, GAME_H } from '../config.js';
import { SCRATCH, SLOT } from '../systems/gambling/games.js';

const W = 760, H = 620;
const COL = { Æble: 0xe5484d, Bølge: 0x4da3ff, Cykel: 0x4cc38a, Kaffe: 0xc98b5a, Bus: 0xf2b134, Stjerne: 0xffe066, Krone: 0xf2b134 };

/** Original symbols, drawn from primitives. s = half size. */
export function drawSymbol(g, name, cx, cy, s) {
  const c = COL[name] || C.paper;
  if (name === 'Æble') {
    g.fillStyle(c, 1).fillCircle(cx - s * 0.28, cy + s * 0.1, s * 0.5).fillCircle(cx + s * 0.28, cy + s * 0.1, s * 0.5);
    g.fillStyle(0x4cc38a, 1).fillEllipse(cx + s * 0.25, cy - s * 0.55, s * 0.5, s * 0.25);
    g.lineStyle(3, 0x6b3b1a, 1).lineBetween(cx, cy - s * 0.35, cx + s * 0.05, cy - s * 0.7);
  } else if (name === 'Bølge') {
    g.lineStyle(s * 0.16, c, 1);
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      for (let i = 0; i <= 16; i++) { const x = cx - s * 0.8 + (i / 16) * s * 1.6, y = cy + k * s * 0.4 + Math.sin(i / 16 * Math.PI * 4) * s * 0.14; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.strokePath();
    }
  } else if (name === 'Cykel') {
    g.lineStyle(s * 0.1, c, 1).strokeCircle(cx - s * 0.5, cy + s * 0.25, s * 0.38).strokeCircle(cx + s * 0.5, cy + s * 0.25, s * 0.38);
    g.lineBetween(cx - s * 0.5, cy + s * 0.25, cx - s * 0.1, cy - s * 0.3).lineBetween(cx - s * 0.1, cy - s * 0.3, cx + s * 0.5, cy + s * 0.25).lineBetween(cx - s * 0.1, cy - s * 0.3, cx + s * 0.25, cy - s * 0.3).lineBetween(cx - s * 0.5, cy + s * 0.25, cx + s * 0.1, cy + s * 0.25);
  } else if (name === 'Kaffe') {
    g.fillStyle(0xb5703a, 1).fillRoundedRect(cx - s * 0.5, cy - s * 0.25, s * 0.85, s * 0.7, 6);
    g.lineStyle(s * 0.1, 0xb5703a, 1).strokeCircle(cx + s * 0.5, cy + s * 0.05, s * 0.2);
    g.fillStyle(0x3b2412, 1).fillRect(cx - s * 0.42, cy - s * 0.2, s * 0.7, s * 0.14);
    g.lineStyle(3, 0x7a808b, 1).lineBetween(cx - s * 0.2, cy - s * 0.4, cx - s * 0.1, cy - s * 0.7).lineBetween(cx + s * 0.1, cy - s * 0.4, cx + s * 0.2, cy - s * 0.7);
  } else if (name === 'Bus') {
    g.fillStyle(c, 1).fillRoundedRect(cx - s * 0.8, cy - s * 0.45, s * 1.6, s * 0.9, 8);
    g.fillStyle(0x16181d, 1);
    for (let i = 0; i < 4; i++) g.fillRect(cx - s * 0.7 + i * s * 0.38, cy - s * 0.32, s * 0.3, s * 0.3);
    g.fillCircle(cx - s * 0.4, cy + s * 0.45, s * 0.14).fillCircle(cx + s * 0.4, cy + s * 0.45, s * 0.14);
  } else if (name === 'Stjerne') {
    g.fillStyle(c, 1).beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.38 : s * 0.85; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.closePath().fillPath();
  } else { // Krone: a gold coin with a crown
    g.fillStyle(c, 1).fillCircle(cx, cy, s * 0.8).lineStyle(3, 0x8a5d00, 1).strokeCircle(cx, cy, s * 0.8).strokeCircle(cx, cy, s * 0.6);
    g.fillStyle(0x8a5d00, 1).beginPath().moveTo(cx - s * 0.4, cy + s * 0.25).lineTo(cx - s * 0.4, cy - s * 0.25).lineTo(cx - s * 0.2, cy).lineTo(cx, cy - s * 0.35).lineTo(cx + s * 0.2, cy).lineTo(cx + s * 0.4, cy - s * 0.25).lineTo(cx + s * 0.4, cy + s * 0.25).closePath().fillPath();
  }
}

export class GamblingScene extends Phaser.Scene {
  constructor() { super('Gamble'); }

  create() {
    ensureFonts();
    this._closed = false;
    this.game3 = this.scene.get('Game');
    this.ctx = this.game3.ctx;
    this.gam = this.ctx.systems.gambling;
    this.venue = this.gam?.activeVenue;
    this.mode = this.venue?.kind === 'slot' ? 'slot' : 'scratch';
    this.msg = '';
    this.tier = 0; this.card = null; this.rev = []; this.cur = 0;
    this.stakeI = 1; this.spin = null; this.reelShow = [[0, 1, 2], [1, 2, 3], [2, 3, 4]]; this.spinT = 0;
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x05070b, 0.78);
    this.x0 = GAME_W / 2 - W / 2; this.y0 = (GAME_H - H) / 2;
    this.layer = this.add.container(0, 0);
    this.g = this.add.graphics();
    this.layer.add(this.g);
    this.texts = [];
    this.render();
    const kb = this.input.keyboard;
    kb.on('keydown', (e) => this.onKey(e));
    this.input.on('pointerdown', (p) => this.onPointer(p, true));
    this.input.on('pointermove', (p) => { if (p.isDown) this.onPointer(p, false); });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.flush());
  }

  T(x, y, s, o) { const t = txt(this, x, y, s, o); this.layer.add(t); this.texts.push(t); return t; }

  // ------------------------------------------------------------------ render
  render() {
    for (const t of this.texts) t.destroy();
    this.texts = [];
    const g = this.g.clear(), { x0, y0 } = this, st = this.ctx.state;
    panel(g, x0, y0, W, H, { fill: C.ink, alpha: 0.98, r: 28, accent: this.mode === 'slot' ? 0xe05cff : C.green });
    const slot = this.mode === 'slot';
    this.T(x0 + 32, y0 + 18, slot ? 'FYRTÅRNET' : 'SKRAB & VIND', { head: true, size: 34, color: slot ? '#E05CFF' : S.green });
    this.T(x0 + 32, y0 + 62, `${this.venue?.name || ''} · ${slot ? 'slot machine' : 'scratch cards'} · 18+`, { size: 14, color: S.muted });
    this.T(x0 + W - 32, y0 + 24, fmtKr(st.money), { head: true, size: 26, color: S.gold, ox: 1 });
    if (slot) this.renderSlot(g); else this.renderScratch(g);
    const hint = slot ? 'Left/Right stake · Enter or Space spin · Esc leave' : 'Left/Right or 1-3 card · Enter buy/scratch · arrows cell · A reveal all · Esc leave';
    this.T(x0 + W / 2, y0 + H - 54, this.msg, { head: true, size: 22, color: this.msgColor || S.paper, ox: 0.5 });
    this.T(x0 + W / 2, y0 + H - 26, hint, { size: 13, color: S.muted, ox: 0.5 });
    this.T(x0 + W - 32, y0 + 64, `RTP about ${Math.round((slot ? SLOT.rtp : SCRATCH.rtp) * 100)}%: the house wins`, { size: 12, color: S.muted, ox: 1 });
  }

  cellRect(i) { const cw = 190, ch = 150, gx = 18; const col = i % 3, row = Math.floor(i / 3); return { x: this.x0 + W / 2 - (cw * 3 + gx * 2) / 2 + col * (cw + gx), y: this.y0 + 190 + row * (ch + gx), w: cw, h: ch }; }

  renderScratch(g) {
    const { x0, y0 } = this;
    SCRATCH.tiers.forEach((t, i) => {
      const bx = x0 + 32 + i * 226, on = i === this.tier;
      g.fillStyle(on ? C.green : C.ink2, 1).fillRoundedRect(bx, y0 + 96, 212, 54, 14);
      this.T(bx + 106, y0 + 102, `${i + 1} ${t.name}`, { head: true, size: 17, color: on ? S.ink : S.paper, ox: 0.5 });
      this.T(bx + 106, y0 + 126, fmtKr(t.price), { size: 14, bold: true, color: on ? S.ink : S.gold, ox: 0.5 });
    });
    for (let i = 0; i < 6; i++) {
      const r = this.cellRect(i), shown = this.card && this.rev[i];
      g.fillStyle(shown ? C.ink3 : 0x8d949f, 1).fillRoundedRect(r.x, r.y, r.w, r.h, 16);
      if (this.cur === i && this.card) g.lineStyle(3, C.orange, 1).strokeRoundedRect(r.x, r.y, r.w, r.h, 16);
      if (shown) {
        const win = this.card.mult > 0 && this.card.cells[i] === this.card.winSymbol;
        if (win) g.lineStyle(4, C.gold, 1).strokeRoundedRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 14);
        drawSymbol(g, SCRATCH.symbols[this.card.cells[i]], r.x + r.w / 2, r.y + r.h / 2 - 8, 46);
        this.T(r.x + r.w / 2, r.y + r.h - 26, SCRATCH.symbols[this.card.cells[i]], { size: 13, color: S.muted, ox: 0.5 });
      } else {
        for (let k = 0; k < 6; k++) g.lineStyle(2, 0xb8bec8, 0.7).lineBetween(r.x + 16 + k * 28, r.y + r.h - 12, r.x + 40 + k * 28, r.y + 12);
        this.T(r.x + r.w / 2, r.y + r.h / 2, this.card ? 'SKRAB' : '?', { head: true, size: 24, color: '#3b414c', ox: 0.5, oy: 0.5 });
      }
    }
    this.T(x0 + W / 2, y0 + 520, 'Match 3 equal symbols to win. Prizes 1x to 50x the price.', { size: 14, color: S.muted, ox: 0.5 });
  }

  renderSlot(g) {
    const { x0, y0 } = this;
    SLOT.stakes.forEach((v, i) => {
      const bx = x0 + 32 + i * 136, on = i === this.stakeI;
      g.fillStyle(on ? 0xe05cff : C.ink2, 1).fillRoundedRect(bx, y0 + 96, 124, 44, 12);
      this.T(bx + 62, y0 + 106, fmtKr(v), { head: true, size: 18, color: on ? S.ink : S.paper, ox: 0.5 });
    });
    const rw = 170, rh = 300, gap = 20, sx = x0 + W / 2 - (rw * 3 + gap * 2) / 2, sy = y0 + 170;
    g.fillStyle(0x0b0d12, 1).fillRoundedRect(sx - 14, sy - 14, rw * 3 + gap * 2 + 28, rh + 28, 18);
    for (let i = 0; i < 3; i++) {
      const rx = sx + i * (rw + gap);
      g.fillStyle(0xf3eee4, 1).fillRoundedRect(rx, sy, rw, rh, 12);
      for (let r = 0; r < 3; r++) drawSymbol(g, SLOT.symbols[this.reelShow[i][r]], rx + rw / 2, sy + 50 + r * 100, 36);
    }
    g.lineStyle(4, this.flash ? C.gold : 0xe5484d, 1).lineBetween(sx - 14, sy + 150, sx + rw * 3 + gap * 2 + 14, sy + 150);
    this.T(x0 + W / 2, y0 + 504, 'Three equal symbols pay 2x-100x. Two Krone pay 1x.', { size: 14, color: S.muted, ox: 0.5 });
  }

  // ------------------------------------------------------------------ actions
  setMsg(m, color) { this.msg = m; this.msgColor = color; }

  buy() {
    if (this.card && !this.card.paid && this.rev.some((r) => !r)) { this.revealAll(); return; }
    const res = this.gam.buyScratch(SCRATCH.tiers[this.tier].id);
    if (!res.ok) { this.setMsg(res.reason, S.red); return; }
    this.card = res.card; this.rev = new Array(6).fill(false); this.cur = 0; this.setMsg('Scratch the cells', S.paper);
  }

  scratch(i) {
    if (!this.card || this.rev[i]) return;
    this.rev[i] = true;
    if (this.rev.every(Boolean)) this.finishCard();
  }

  revealAll() { if (!this.card) return; this.rev.fill(true); this.finishCard(); }

  finishCard() {
    const c = this.card;
    this.gam.payScratch(c);
    if (c.prize > 0) this.setMsg(`WIN ${fmtKr(c.prize)}!  (Enter for another card)`, S.gold);
    else this.setMsg('No luck. Enter for another card', S.muted);
  }

  doSpin() {
    if (this.spin && !this.spin.done) return;
    const res = this.gam.spinSlot(SLOT.stakes[this.stakeI]);
    if (!res.ok) { this.setMsg(res.reason, S.red); return; }
    this.flash = false;
    this.spin = { ...res.spin, t0: this.time.now, stopped: [false, false, false], done: false, tease: false };
    this.setMsg('Spinning...', S.paper);
  }

  update(time) {
    const sp = this.spin;
    if (!sp || sp.done) return;
    const el = time - sp.t0, n = SLOT.symbols.length;
    const stopAt = [800, 1300, 1800 + (sp.near ? 1100 : 0)];
    this._acc = (this._acc || 0) + 1;
    for (let i = 0; i < 3; i++) {
      if (sp.stopped[i]) continue;
      if (el >= stopAt[i]) {
        sp.stopped[i] = true;
        this.reelShow[i] = sp.reels[i].slice();
      } else if (i === 2 && sp.near && el > stopAt[2] - 450) {
        // tease: the missing symbol slides through the payline, then the reel settles one row away
        this.reelShow[i] = [sp.line[0], el < stopAt[2] - 200 ? sp.line[0] : sp.reels[2][1], sp.reels[2][0] === sp.line[0] || sp.reels[2][2] === sp.line[0] ? sp.reels[2][1] : sp.line[0]];
      } else if (this._acc % 3 === 0) {
        this.reelShow[i] = [Phaser.Math.Between(0, n - 1), Phaser.Math.Between(0, n - 1), Phaser.Math.Between(0, n - 1)];
      }
    }
    if (sp.stopped.every(Boolean)) {
      sp.done = true;
      this.gam.payWin(sp);
      if (sp.prize > 0) { this.flash = true; this.setMsg(`WIN ${fmtKr(sp.prize)}!  (${sp.mult}x)`, S.gold); }
      else this.setMsg(sp.near ? 'So close! Try again?' : 'No win. Try again?', S.muted);
    }
    this.render();
  }

  // ------------------------------------------------------------------ input
  onKey(e) {
    const k = e.code;
    if (k === 'Escape' || k === 'KeyE') return this.close();
    if (this.mode === 'scratch') {
      if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { if (!this.card || this.rev.every(Boolean)) this.tier = Number(k.slice(5)) - 1; }
      else if (k === 'ArrowLeft') { if (!this.card || this.rev.every(Boolean)) this.tier = (this.tier + 2) % 3; else this.cur = (this.cur + 5) % 6; }
      else if (k === 'ArrowRight') { if (!this.card || this.rev.every(Boolean)) this.tier = (this.tier + 1) % 3; else this.cur = (this.cur + 1) % 6; }
      else if (k === 'ArrowUp') this.cur = (this.cur + 3) % 6;
      else if (k === 'ArrowDown') this.cur = (this.cur + 3) % 6;
      else if (k === 'KeyA') this.revealAll();
      else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
        if (!this.card || this.rev.every(Boolean)) this.buy(); else this.scratch(this.cur);
      }
    } else {
      if (k === 'ArrowLeft') this.stakeI = Math.max(0, this.stakeI - 1);
      else if (k === 'ArrowRight') this.stakeI = Math.min(SLOT.stakes.length - 1, this.stakeI + 1);
      else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.doSpin();
    }
    this.render();
  }

  onPointer(p, down) {
    if (this.mode !== 'scratch') return;
    if (!this.card) { if (down) { this.buy(); this.render(); } return; }
    for (let i = 0; i < 6; i++) {
      const r = this.cellRect(i);
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { this.cur = i; this.scratch(i); break; }
    }
    this.render();
  }

  flush() {
    // leaving never dodges a result: pay what is decided
    if (this.card) this.gam?.payScratch(this.card);
    if (this.spin) this.gam?.payWin(this.spin);
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.flush();
    this.scene.resume('Game');
    bus.emit(EV.OVERLAY_CLOSED, {});
    this.scene.stop();
  }
}
