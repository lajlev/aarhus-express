/**
 * OverlayScene: modal screens that pause the Game scene.   OWNER: UI specialist
 *
 * Opened via EV.OPEN_OVERLAY { mode } or keys (GameScene binds Esc/P = pause, B = shop, K = skills, M = map).
 * Keyboard: Up/Down (or W/S) move, Enter/Space activates, Esc (or the mode's own key) closes. Mouse works too.
 *  - pause:  controls help + Resume / Save / Save & quit (Q)
 *  - shop:   economy.getShopItems(), buy via economy.buy(id); shows price, LQ gain, cooldown, reason
 *  - skills: economy.getSkills(), economy.upgradeSkill(id)
 *  - map:    full minimap texture with landmarks, contacts, current target, police, player, vehicle shops, home
 *  - home:   (E at the home door; HOME & VEHICLES specialist) sleep, pay rent, garage (bring to door), housing upgrades
 *  - dealer: (E on a shop pad; eco.activeShop) buy / rent vehicles with DKK prices, repair. Left/Right changes rental days.
 * All economy / mission calls are defensive (fall back to data files when a method is missing).
 */
import Phaser from 'phaser';
import { bus, EV } from '../core/events.js';
import { session, SKILLS, SKILL_MAX, skillLevel } from '../core/state.js';
import { GAME_W, GAME_H, TITLE } from '../config.js';
import { C, S, txt, icon, ensureFonts, fmtKr, fmtTime, lqThreshold } from '../ui/theme.js';
import { drawTaskIcon, taskColor } from '../ui/taskIcons.js';
import { TASK_TYPES } from '../data/tasks.js';
import { PX } from '../config.js';
import { getShop } from '../data/shop.js';
import { getContacts } from '../data/contacts.js';
import { contactEnabled } from '../core/options.js';
import { dayName } from '../systems/economy/HomeService.js';
import { VEHICLES } from '../data/vehicles.js';

export const CONTROLS = [
  ['W / Up', 'Walk / accelerate'],
  ['S / Down', 'Walk / brake, reverse'],
  ['A D / Left Right', 'Walk / steer'],
  ['Space', 'Handbrake (drift)'],
  ['Shift', 'Run (on foot)'],
  ['E', 'Vehicle in/out; at your door or a shop: open it'],
  ['H', 'Horn / bicycle bell'],
  ['R / T', 'Car radio on/off / next station'],
  ['V', 'Mute / unmute all audio'],
  ['Y / N', 'Accept / decline a job offer'],
  ['B', 'Shop (spend money, gain LQ)'],
  ['K', 'Skills (spend skill points)'],
  ['M', 'Full map: select task pins, Enter accepts or tracks'],
  ['Tab', 'Cycle the tracked task'],
  ['J', 'Phone job app: Courier, Taxi, Bus, Tasks'],
  ['Esc / P', 'Pause'],
];

const SKILL_NAMES = { driving: 'Driving', stamina: 'Stamina', charm: 'Charm', streetSmarts: 'Street smarts', navigation: 'Navigation' };
const SKILL_DESC = {
  driving: 'Top speed and handling', stamina: 'Run speed and max health', charm: 'Bigger payouts and tips',
  streetSmarts: 'Heat builds slower and fades faster', navigation: 'More time on delivery deadlines',
};
const MODE_KEY = { shop: 'B', skills: 'K', map: 'M', pause: 'P', home: 'E', dealer: 'E' };
const MODE_TITLE = { shop: 'SHOP', skills: 'SKILLS', map: 'CITY MAP', pause: 'PAUSED', home: 'HOME', dealer: 'VEHICLES' };

export class OverlayScene extends Phaser.Scene {
  constructor() { super('Overlay'); }

  init(data) { this.mode = data.mode || 'pause'; this.sel = 0; this.scroll = 0; this.msg = null; this.rentDays = {}; this.openedAt = Date.now(); }

  create() {
    ensureFonts();
    this.game_ = this.scene.get('Game');
    this.eco = this.game_?.systems?.economy;
    this.st = session.state;
    this.layer = null;
    this.add.rectangle(0, 0, GAME_W, GAME_H, C.ink, 0.9).setOrigin(0).setInteractive();
    this._chrome();
    const kb = this.input.keyboard;
    kb.on('keydown-ESC', () => this.close());
    kb.on('keydown-P', () => { if (this.mode === 'pause') this.close(); });
    const own = MODE_KEY[this.mode];
    if (own === 'E') kb.on('keydown-E', (e) => { if (!e?.repeat && Date.now() - this.openedAt > 250) this.close(); });
    else if (own && own !== 'P') kb.on(`keydown-${own}`, () => this.close());
    kb.on('keydown-LEFT', () => this._lr?.(-1));
    kb.on('keydown-RIGHT', () => this._lr?.(1));
    kb.on('keydown-A', () => this._lr?.(-1));
    kb.on('keydown-D', () => this._lr?.(1));
    kb.on('keydown-UP', () => this._move(-1));
    kb.on('keydown-W', () => this._move(-1));
    kb.on('keydown-DOWN', () => this._move(1));
    kb.on('keydown-S', () => this._move(1));
    kb.on('keydown-ENTER', () => this._activate());
    kb.on('keydown-SPACE', () => this._activate());
    kb.on('keydown-Q', () => { if (this.mode === 'pause') this._quit(); });
    kb.on('keydown-X', () => this._abandon?.());
    // simple mode switching between shop / skills / map from inside an overlay
    for (const [m, k] of [['shop', 'B'], ['skills', 'K'], ['map', 'M']]) {
      if (m !== this.mode) kb.on(`keydown-${k}`, () => this.scene.restart({ mode: m }));
    }
    this.input.on('wheel', (_p, _o, _dx, dy) => this._move(dy > 0 ? 1 : -1));
    this._render();
  }

  // ------------------------------------------------------------ shared chrome
  _chrome() {
    const g = this.add.graphics();
    g.fillStyle(C.ink2, 1).fillRect(0, 0, GAME_W, 84);
    g.fillStyle(C.orange, 1).fillRect(0, 84, GAME_W, 4);
    g.fillStyle(C.orange, 1).fillRect(0, 0, 12, 84);
    txt(this, 36, 14, (this.mode === 'dealer' && this.eco?.activeShop ? this.eco.activeShop.name : MODE_TITLE[this.mode] || this.mode).toUpperCase(), { head: true, size: this.mode === 'dealer' ? 38 : 46, color: S.paper });
    txt(this, 38, 62, TITLE.toUpperCase(), { head: true, size: 12, color: S.muted });
    this.topRight = txt(this, GAME_W - 36, 18, '', { head: true, size: 26, ox: 1 });
    this.topRight2 = txt(this, GAME_W - 36, 52, '', { size: 14, ox: 1, color: S.muted });
    this.footer = txt(this, GAME_W / 2, GAME_H - 22, '', { size: 14, ox: 0.5, oy: 0.5, color: S.muted });
  }

  _top() {
    const st = this.st;
    this.topRight.setText(fmtKr(st.money));
    const sp = this.eco?.getSkillPoints?.() ?? st.skillPoints ?? 0;
    this.topRight2.setText(`LQ ${Math.round(st.lq)}   ·   ${sp} skill point${sp === 1 ? '' : 's'}`);
  }

  _render() {
    this.layer?.destroy(true);
    this.layer = this.add.container(0, 0);
    this._top();
    const hint = { pause: 'Up/Down choose   Enter select   Esc resume', shop: 'Up/Down choose   Enter buy   Esc or B close   K skills   M map', skills: 'Up/Down choose   Enter upgrade   Esc or K close   B shop   M map', map: 'Up/Down select a pin   Enter accept or track   X abandon   click a pin   Esc or M close', home: 'Up/Down choose   Enter select   Esc or E leave', dealer: 'Up/Down choose   Left/Right rental days   Enter buy or rent   Esc or E leave' }[this.mode];
    this.footer.setText(hint);
    this._lr = null;
    this._abandon = null;
    this[`_${this.mode}`]?.();
  }

  _add(...o) { this.layer.add(o); return o[0]; }
  _g() { const g = this.add.graphics(); this.layer.add(g); return g; }
  _t(x, y, s, o) { const t = txt(this, x, y, s, o); this.layer.add(t); return t; }

  _button(g, x, y, w, h, label, { enabled = true, selected = false } = {}) {
    g.fillStyle(enabled ? (selected ? C.orange : C.ink3) : C.ink2, 1).fillRoundedRect(x, y, w, h, 8);
    if (enabled && !selected) g.lineStyle(2, C.orange, 1).strokeRoundedRect(x, y, w, h, 8);
    this._t(x + w / 2, y + h / 2, label, { head: true, size: 16, ox: 0.5, oy: 0.5, color: enabled ? (selected ? S.ink : S.paper) : S.muted });
  }

  _move(d) {
    const n = this._count?.() || 0;
    if (!n) return;
    this.sel = Phaser.Math.Wrap(this.sel + d, 0, n);
    this._render();
  }

  _activate() { this._do?.(this.sel); }

  _flash(res, okText) {
    this.msg = res?.ok ? { t: okText, c: S.green } : { t: res?.reason || 'Not possible', c: S.red };
  }

  // ------------------------------------------------------------ pause
  _pause() {
    this._count = () => 3;
    const items = ['Resume', 'Save game', 'Save and quit to title'];
    this._do = (i) => {
      if (i === 0) this.close();
      else if (i === 1) { bus.emit(EV.REQUEST_SAVE, {}); this.msg = { t: 'Saved.', c: S.green }; this._render(); }
      else this._quit();
    };
    const g = this._g();
    g.fillStyle(C.ink2, 1).fillRoundedRect(60, 120, 640, 520, 14).lineStyle(2, C.ink3, 1).strokeRoundedRect(60, 120, 640, 520, 14);
    this._t(90, 138, 'CONTROLS', { head: true, size: 20, color: S.orange });
    CONTROLS.forEach(([k, d], i) => {
      const y = 174 + i * 32;
      g.fillStyle(C.ink3, 1).fillRoundedRect(90, y, 190, 28, 6);
      this._t(185, y + 14, k, { head: true, size: 15, ox: 0.5, oy: 0.5 });
      this._t(300, y + 14, d, { size: 16, oy: 0.5 });
    });
    items.forEach((label, i) => {
      const y = 190 + i * 74;
      const sel = i === this.sel;
      g.fillStyle(sel ? C.orange : C.ink2, 1).fillRoundedRect(760, y, 450, 58, 12);
      g.lineStyle(2, sel ? C.paper : C.ink3, 1).strokeRoundedRect(760, y, 450, 58, 12);
      this._t(790, y + 29, label.toUpperCase(), { head: true, size: 24, oy: 0.5, color: sel ? S.ink : S.paper });
      const z = this.add.zone(760, y, 450, 58).setOrigin(0).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => { if (this.sel !== i) { this.sel = i; this._render(); } });
      z.on('pointerdown', () => this._do(i));
      this.layer.add(z);
    });
    if (this.msg) this._t(760, 430, this.msg.t, { head: true, size: 18, color: this.msg.c });
    this._weekBlock(760, 536);
    const st = this.st.stats || {};
    this._t(760, 470, `Deliveries ${st.deliveries || 0}   ·   Missions ${st.missions || 0}\nBusted ${st.busted || 0}   ·   Knockouts ${st.knockouts || 0}\nEarned ${fmtKr(st.earned || 0)}   ·   Played ${Math.floor((st.playSeconds || 0) / 60)} min`, { size: 15, color: S.muted });
  }

  _quit() {
    bus.emit(EV.REQUEST_SAVE, {});
    this.scene.stop('HUD');
    this.scene.stop('Game');
    this.scene.start('CitySelect');
  }

  // ------------------------------------------------------------ shop
  _shopItems() {
    let items = this.eco?.getShopItems?.();
    if (!items) items = getShop(this.st.cityId).map((i) => ({ ...i, venueName: i.at, lqGain: i.lq, cooldownLeft: 0, affordable: this.st.money >= i.price, available: this.st.money >= i.price, reason: '', count: this.st.purchases?.[i.id] || 0 }));
    return items;
  }

  _shop() {
    const items = this._shopItems();
    this._count = () => items.length;
    this._do = (i) => {
      const it = items[i];
      if (!it) return;
      const res = this.eco?.buy ? this.eco.buy(it.id) : { ok: false, reason: 'Shop unavailable' };
      this._flash(res, `Bought ${it.name}${res.lqGained != null ? `  +${res.lqGained} LQ` : ''}`);
      this._render();
    };
    const ROWS = 8, RH = 60, y0 = 106;
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + ROWS) this.scroll = this.sel - ROWS + 1;
    const g = this._g();
    this._t(40, y0 - 2, 'ITEM', { head: true, size: 12, color: S.muted });
    this._t(640, y0 - 2, 'PRICE', { head: true, size: 12, color: S.muted, ox: 1 });
    this._t(740, y0 - 2, 'LQ', { head: true, size: 12, color: S.muted, ox: 1 });
    this._t(780, y0 - 2, 'STATUS', { head: true, size: 12, color: S.muted });
    const list = items.slice(this.scroll, this.scroll + ROWS);
    list.forEach((it, k) => {
      const i = this.scroll + k, y = y0 + 20 + k * RH, sel = i === this.sel;
      g.fillStyle(sel ? C.ink3 : C.ink2, 1).fillRoundedRect(30, y, GAME_W - 60, RH - 6, 10);
      if (sel) g.lineStyle(3, C.orange, 1).strokeRoundedRect(30, y, GAME_W - 60, RH - 6, 10);
      const ok = it.available;
      this._t(48, y + 7, it.name, { head: true, size: 20, color: ok ? S.paper : S.muted });
      this._t(48, y + 31, `${it.venueName || ''}${it.nearVenue ? '  ·  YOU ARE HERE: x1.5 LQ' : it.distanceM != null ? `  ·  ${it.distanceM >= 1000 ? (it.distanceM / 1000).toFixed(1) + ' km' : it.distanceM + ' m'} away` : ''}`, { size: 12, color: it.nearVenue ? S.green : S.muted });
      this._t(640, y + 14, fmtKr(it.price), { head: true, size: 22, ox: 1, color: it.affordable ? S.paper : S.red });
      this._t(740, y + 14, `+${it.lqGain}`, { head: true, size: 22, ox: 1, color: S.orange });
      let status = 'Ready', col = S.green;
      if (it.reason) { status = it.reason; col = S.red; }
      if (it.cooldownLeft > 0) col = S.gold;
      this._t(780, y + 8, status, { size: 14, color: col, wrap: 250 });
      if (it.count) this._t(780, y + 28, `bought ${it.count}x`, { size: 12, color: S.muted });
      this._button(g, GAME_W - 190, y + 8, 130, 38, 'BUY', { enabled: ok, selected: sel && ok });
      const z = this.add.zone(30, y, GAME_W - 60, RH - 6).setOrigin(0).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => { if (this.sel !== i) { this.sel = i; this._render(); } });
      z.on('pointerdown', () => { this.sel = i; this._do(i); });
      this.layer.add(z);
    });
    if (items.length > ROWS) {
      const h = (GAME_H - 190) * ROWS / items.length, ty = y0 + 20 + (GAME_H - 190 - h) * (this.scroll / (items.length - ROWS));
      g.fillStyle(C.ink3, 1).fillRoundedRect(GAME_W - 24, y0 + 20, 6, GAME_H - 190, 3);
      g.fillStyle(C.orange, 1).fillRoundedRect(GAME_W - 24, ty, 6, h, 3);
    }
    const it = items[this.sel];
    if (it?.desc) this._t(40, GAME_H - 82, it.desc, { size: 15, color: S.paper });
    if (this.msg) this._t(40, GAME_H - 56, this.msg.t, { head: true, size: 18, color: this.msg.c });
  }

  // ------------------------------------------------------------ skills
  _skillList() {
    let list = this.eco?.getSkills?.();
    if (!list) list = SKILLS.map((id) => { const level = this.st.skills[id] || 0; const eff = skillLevel(this.st, id); return { id, name: SKILL_NAMES[id], desc: SKILL_DESC[id], level, bonus: eff - level, effective: eff, max: SKILL_MAX, cost: level >= SKILL_MAX ? null : 1, canUpgrade: level < SKILL_MAX && this.st.skillPoints >= 1, effects: null }; });
    return list;
  }

  _skills() {
    const list = this._skillList();
    this._count = () => list.length;
    this._do = (i) => {
      const s = list[i];
      const res = this.eco?.upgradeSkill ? this.eco.upgradeSkill(s.id) : { ok: false, reason: 'Skills unavailable' };
      this._flash(res, `${s.name} upgraded to level ${res.level ?? s.level + 1}`);
      this._render();
    };
    const g = this._g();
    // LQ progress
    const pr = this.eco?.getLQProgress?.() || (() => { const n = this.st.milestonesReached || 0; const prev = n ? lqThreshold(n) : 0, next = lqThreshold(n + 1); return { prev, next, t: (this.st.lq - prev) / (next - prev) }; })();
    g.fillStyle(C.ink2, 1).fillRoundedRect(40, 108, GAME_W - 80, 70, 12);
    this._t(60, 118, 'LIFE QUALITY', { head: true, size: 14, color: S.orange });
    this._t(60, 138, `${Math.round(this.st.lq)}`, { head: true, size: 32 });
    this._t(GAME_W - 60, 118, `NEXT SKILL POINT AT LQ ${pr.next}`, { head: true, size: 14, color: S.muted, ox: 1 });
    g.fillStyle(C.ink3, 1).fillRoundedRect(200, 146, GAME_W - 280, 14, 7);
    g.fillStyle(C.orange, 1).fillRoundedRect(200, 146, Math.max(4, (GAME_W - 280) * Phaser.Math.Clamp(pr.t, 0, 1)), 14, 7);
    list.forEach((s, i) => {
      const y = 196 + i * 86, sel = i === this.sel;
      g.fillStyle(sel ? C.ink3 : C.ink2, 1).fillRoundedRect(40, y, GAME_W - 80, 76, 12);
      if (sel) g.lineStyle(3, C.orange, 1).strokeRoundedRect(40, y, GAME_W - 80, 76, 12);
      this._t(64, y + 10, s.name.toUpperCase(), { head: true, size: 26 });
      this._t(64, y + 44, s.desc, { size: 15, color: S.muted });
      // pips
      for (let k = 0; k < s.max; k++) {
        const px = 420 + k * 44;
        const have = k < s.level, bonus = !have && k < s.level + s.bonus;
        g.fillStyle(have ? C.orange : bonus ? C.gold : C.ink3, bonus ? 0.55 : 1).fillRoundedRect(px, y + 20, 36, 22, 6);
        if (!have && !bonus) g.lineStyle(2, C.muted, 0.5).strokeRoundedRect(px, y + 20, 36, 22, 6);
      }
      this._t(420, y + 48, `LEVEL ${s.level}/${s.max}${s.bonus ? `  +${s.bonus} from your character` : ''}`, { head: true, size: 13, color: S.muted });
      const ef = s.effects && Object.entries(s.effects).map(([k, v]) => `${k} x${typeof v === 'number' ? v.toFixed(2) : v}`).join('  ');
      if (ef) this._t(GAME_W - 270, y + 8, ef, { size: 11, color: S.muted, ox: 1 });
      const label = s.cost == null ? 'MAXED' : `UPGRADE (${s.cost})`;
      this._button(g, GAME_W - 250, y + 20, 190, 38, label, { enabled: s.canUpgrade, selected: sel && s.canUpgrade });
      const z = this.add.zone(40, y, GAME_W - 80, 76).setOrigin(0).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => { if (this.sel !== i) { this.sel = i; this._render(); } });
      z.on('pointerdown', () => { this.sel = i; this._do(i); });
      this.layer.add(z);
    });
    if (this.msg) this._t(40, GAME_H - 56, this.msg.t, { head: true, size: 18, color: this.msg.c });
  }

  // ------------------------------------------------------------ map
  _map() {
    this._count = () => 0;
    const g0 = this.game_, mm = g0?.minimap;
    if (!mm) return;
    const aw = GAME_W - 80, ah = GAME_H - 150;
    const k = Math.min(aw / mm.width, ah / mm.height);
    const w = mm.width * k, h = mm.height * k, x0 = (GAME_W - w) / 2, y0 = 100 + (ah - h) / 2;
    const img = this.add.image(x0, y0, mm.key).setOrigin(0).setScale(k);
    this.layer.add(img);
    const g = this._g();
    g.lineStyle(3, C.orange, 1).strokeRect(x0 - 2, y0 - 2, w + 4, h + 4);
    const P = (wx, wy) => ({ x: x0 + wx * mm.scale * k, y: y0 + wy * mm.scale * k });
    // landmarks
    const lms = g0.world?.landmarks || {};
    const placed = [];
    for (const lm of Object.values(lms)) {
      const q = P(lm.lx ?? lm.x, lm.ly ?? lm.y);
      if (q.x < x0 || q.x > x0 + w || q.y < y0 || q.y > y0 + h) continue;
      g.fillStyle(C.ink, 1).fillCircle(q.x, q.y, 4.5).fillStyle(C.paper, 1).fillCircle(q.x, q.y, 2.5);
      if (placed.some((p) => Math.abs(p.x - q.x) < 70 && Math.abs(p.y - q.y) < 11)) continue;
      placed.push(q);
      this._t(q.x + 7, q.y, lm.n, { size: 11, oy: 0.5, color: S.ink, stroke: '#F3EEE4', strokeThickness: 3 });
    }
    // shop venues
    for (const it of this.eco?.getShopItems?.() || []) {
      const lm = lms[it.at]; if (!lm) continue;
      const q = P(lm.lx ?? lm.x, lm.ly ?? lm.y);
      g.fillStyle(C.green, 1).fillTriangle(q.x, q.y - 8, q.x - 6, q.y + 4, q.x + 6, q.y + 4);
    }
    // vehicle shops, dealers (HOME & VEHICLES)
    const POI = { bicycle: C.blue, bikeRental: C.gold, rental: C.gold, dealer: C.orange };
    for (const poi of this.eco?.getMapPOIs?.() || []) {
      if (!POI[poi.kind]) continue;
      const q = P(poi.x, poi.y);
      g.fillStyle(C.ink, 1).fillRect(q.x - 4.5, q.y - 4.5, 9, 9).fillStyle(POI[poi.kind], 1).fillRect(q.x - 3, q.y - 3, 6, 6);
      if (poi.kind === 'dealer') this._t(q.x + 8, q.y, poi.name, { size: 11, oy: 0.5, color: S.ink, stroke: '#F3EEE4', strokeThickness: 3 });
    }
    // contacts
    for (const c of getContacts(this.st.cityId).filter(contactEnabled)) {
      const lm = lms[c.at]; if (!lm) continue;
      const q = P(lm.lx ?? lm.x, lm.ly ?? lm.y);
      g.fillStyle(c.legal === false ? C.red : C.gold, 1).fillCircle(q.x + 8, q.y - 8, 5).lineStyle(2, C.ink, 1).strokeCircle(q.x + 8, q.y - 8, 5);
    }
    // home
    const hm = g0.world?.home;
    if (hm) {
      const q = P(hm.x, hm.y);
      g.fillStyle(C.green, 1).fillTriangle(q.x - 8, q.y, q.x + 8, q.y, q.x, q.y - 9).fillRect(q.x - 6, q.y, 12, 9).lineStyle(2, C.ink, 1).strokeRect(q.x - 6, q.y, 12, 9);
      this._t(q.x + 11, q.y, 'Home', { size: 11, oy: 0.5, color: S.ink, stroke: '#F3EEE4', strokeThickness: 3 });
    }
    // police
    for (const un of g0.systems?.police?.units || []) {
      const u = un?.v || un;
      if (!u || u.destroyed || u.x == null) continue;
      const q = P(u.x, u.y);
      g.fillStyle(C.blue, 1).fillCircle(q.x, q.y, 4).lineStyle(1.5, C.paper, 1).strokeCircle(q.x, q.y, 4);
    }
    // target
    const tp = g0.systems?.missions?.targetPoint?.();
    if (tp) {
      const q = P(tp.x, tp.y);
      g.lineStyle(3, C.orange, 1).strokeCircle(q.x, q.y, 11).fillStyle(C.orange, 1).fillCircle(q.x, q.y, 6).lineStyle(2, C.ink, 1).strokeCircle(q.x, q.y, 6);
      this._t(q.x + 14, q.y - 14, tp.name || 'Target', { head: true, size: 15, color: S.orange, stroke: S.ink, strokeThickness: 4 });
    }
    // player
    const p = g0.player;
    const q = P(p.px, p.py), rot = p.vehicle ? p.vehicle.angle : (p.sprite?.rotation || 0);
    const pt = (a, r) => ({ x: q.x + Math.cos(a) * r, y: q.y + Math.sin(a) * r });
    const pts = [pt(rot, 10), pt(rot + 2.5, 8), pt(rot + Math.PI, 3), pt(rot - 2.5, 8)];
    g.fillStyle(C.paper, 1).fillPoints(pts, true).lineStyle(2.5, C.orange, 1).strokePoints(pts, true);
    this._t(q.x + 12, q.y + 6, 'YOU', { head: true, size: 13, stroke: S.ink, strokeThickness: 4 });
    // task layer: event areas, available task pins, active tasks (selectable with Up/Down, Enter accepts or tracks)
    const msys = g0.systems?.missions, board = msys?.board;
    const pins = [];
    if (board) {
      for (const t of msys.taskList()) if (t.x != null) pins.push({ active: true, type: t.type, x: t.x, y: t.y, title: t.title, sub: `${t.stageName}${t.progress ? ` · ${t.progress}` : ''}`, timeLeft: t.timeLeft, task: t, tracked: t.tracked, act: t.tracked ? 'Tracked' : 'Track' });
      for (const e of board.entries(true)) if (e.x != null) pins.push({ active: false, type: e.type, x: e.x, y: e.y, title: e.title, sub: e.sub, pay: e.pay, lq: e.lq, ttl: e.ttl, limit: e.limit, entry: e, act: e.act, boost: e.boost });
      for (const ev of board.activeEvents()) {
        if (ev.global) continue;
        const c = P(ev.x, ev.y), r = Math.max(10, ev.r * mm.scale * k);
        g.fillStyle(ev.color, 0.22).fillCircle(c.x, c.y, r).lineStyle(3, ev.color, 0.9).strokeCircle(c.x, c.y, r);
        this._t(c.x, c.y - r - 4, ev.name, { head: true, size: 14, ox: 0.5, oy: 1, color: '#F0B8FF', stroke: S.ink, strokeThickness: 4 });
      }
    }
    this._pins = pins;
    this._count = () => pins.length;
    this._lr = (d) => this._move(d);
    this.sel = Math.max(0, Math.min(this.sel, pins.length - 1));
    pins.forEach((pn, i) => {
      const q = P(pn.x, pn.y), on = i === this.sel;
      const r = pn.type === 'gig' ? 7 : 8;
      if (pn.active) g.lineStyle(3, C.paper, 1).strokeCircle(q.x, q.y, r + 5);
      if (pn.tracked) g.lineStyle(3, C.orange, 1).strokeCircle(q.x, q.y, r + 9);
      drawTaskIcon(g, pn.type, q.x, q.y, r);
      if (on) { g.lineStyle(3, C.paper, 1).strokeCircle(q.x, q.y, r + 12); g.lineStyle(2, taskColor(pn.type), 1).strokeCircle(q.x, q.y, r + 16); }
      const z = this.add.zone(q.x - 14, q.y - 14, 28, 28).setOrigin(0).setInteractive({ useHandCursor: true });
      z.on('pointerdown', () => { if (this.sel === i) this._activate(); else { this.sel = i; this._render(); } });
      this.layer.add(z);
    });
    this._do = (i) => {
      const pn = pins[i];
      if (!pn) return;
      if (pn.active) { const ok = msys.track(pn.task.id); this._flash({ ok, reason: 'Cannot track this' }, `Tracking: ${pn.task.short}`); }
      else { const res = board.acceptEntry(pn.entry); this._flash(res, `Accepted: ${pn.title}`); if (res.ok) this.sel = 0; }
      this._render();
    };
    this._abandon = () => { const pn = pins[this.sel]; if (pn?.active && pn.task.job) { msys.abandon(pn.task.job); this._flash({ ok: true }, `Abandoned: ${msys.abandonPenalty(pn.task.job)}`); this.sel = 0; this._render(); } };
    // details of the selected pin
    const sp = pins[this.sel];
    const px0 = GAME_W - 360, py0 = 110;
    const pg = this._g(); // created after the map labels so the panel covers them
    pg.fillStyle(C.ink2, 0.98).fillRoundedRect(px0, py0, 330, 232, 12).lineStyle(2, sp ? taskColor(sp.type) : C.ink3, 1).strokeRoundedRect(px0, py0, 330, 232, 12);
    if (sp) {
      drawTaskIcon(pg, sp.type, px0 + 28, py0 + 28, 11);
      this._t(px0 + 50, py0 + 10, TASK_TYPES[sp.type]?.label.toUpperCase() || '', { head: true, size: 12, color: S.muted });
      this._t(px0 + 50, py0 + 26, sp.title, { head: true, size: 17, wrap: 268 });
      const dm = Math.round(Math.hypot(sp.x - p.px, sp.y - p.py) / PX);
      const bits = [`${dm >= 1000 ? `${(dm / 1000).toFixed(1)} km` : `${Math.round(dm / 10) * 10} m`} away`];
      if (sp.pay) bits.push(fmtKr(sp.pay));
      if (sp.lq) bits.push(`+${sp.lq} LQ`);
      if (sp.timeLeft != null) bits.push(`${fmtTime(sp.timeLeft)} left`); else if (sp.limit) bits.push(`${fmtTime(sp.limit)} to do it`);
      if (sp.ttl) bits.push(`gone in ${fmtTime(sp.ttl)}`);
      this._t(px0 + 16, py0 + 78, sp.sub, { size: 13, color: S.muted, wrap: 298 });
      this._t(px0 + 16, py0 + 150, bits.join(' · '), { size: 13, color: S.green, wrap: 298 });
      if (sp.boost) this._t(px0 + 16, py0 + 172, `Boost: ${sp.boost}`, { size: 13, bold: true, color: S.gold });
      this._button(pg, px0 + 16, py0 + 190, 298, 32, sp.active ? (sp.tracked ? 'TRACKED (X abandon)' : 'TRACK  (X abandon)') : sp.act.toUpperCase(), { selected: true });
      const bz = this.add.zone(px0 + 16, py0 + 190, 298, 32).setOrigin(0).setInteractive({ useHandCursor: true });
      bz.on('pointerdown', () => this._activate());
      this.layer.add(bz);
    } else this._t(px0 + 16, py0 + 16, 'No task pins yet.\nGigs appear around you.', { size: 14, color: S.muted });
    if (this.msg) this._t(px0 + 16, py0 + 240, this.msg.t, { head: true, size: 16, color: this.msg.c, wrap: 298 });
    // legend
    const items = [[C.paper, 'Landmark'], [C.green, 'Shop venue'], [C.blue, 'Bike shop'], [C.gold, 'Rental'], [C.orange, 'Dealer'], [C.gold, 'Contact'], [C.red, 'Criminal contact'], [C.blue, 'Police'], [C.orange, 'Target']];
    items.forEach(([c, l], i) => { // vertical list at the left: the map is narrow and tall
      const ly = 120 + i * 26;
      g.fillStyle(c, 1).fillCircle(48, ly, 5);
      this._t(62, ly, l, { size: 14, oy: 0.5, color: S.muted });
    });
    const tl = [['gig', 'Street gig'], ['courier', 'Courier order'], ['taxi', 'Taxi stand / hail'], ['bus', 'Bus line start'], ['event', 'Event area']];
    this._t(40, 120 + items.length * 26 + 6, 'TASKS', { head: true, size: 13, color: S.orange });
    tl.forEach(([t, l], i) => {
      const ly = 120 + items.length * 26 + 36 + i * 26;
      drawTaskIcon(g, t, 48, ly, 7);
      this._t(62, ly, l, { size: 14, oy: 0.5, color: S.muted });
    });
    this._t(40, 120 + items.length * 26 + 36 + tl.length * 26 + 4, 'White ring: on your list\nOrange ring: tracked', { size: 12, color: S.muted });
  }

  // ------------------------------------------------------------ weekly economy block (pause)
  _weekBlock(x, y) {
    const w = this.eco?.getWeeklySummary?.();
    if (!w) return;
    const g = this._g();
    g.fillStyle(C.ink2, 1).fillRoundedRect(x, y, 450, 120, 12).lineStyle(2, C.ink3, 1).strokeRoundedRect(x, y, 450, 120, 12);
    this._t(x + 16, y + 8, 'THIS WEEK', { head: true, size: 14, color: S.orange });
    const sp = w.spent;
    this._t(x + 16, y + 30, `Income ${fmtKr(w.income)}\nRent ${fmtKr(sp.rent)}   Insurance ${fmtKr(sp.insurance)}\nVehicles ${fmtKr(sp.vehicles)}   Fun ${fmtKr(sp.fun)}   Other ${fmtKr(sp.other)}`, { size: 14, color: S.paper });
    this._t(x + 434, y + 10, `${w.net >= 0 ? '+' : '-'}${fmtKr(Math.abs(w.net))}`, { head: true, size: 22, ox: 1, color: w.net >= 0 ? S.green : S.red });
    this._t(x + 16, y + 94, `Next rent ${fmtKr(w.upcoming.rent)} on ${w.upcoming.rentLabel} (day ${w.upcoming.rentDay + 1}), insurance ${fmtKr(w.upcoming.insurance)}`, { size: 12, color: S.muted });
  }

  // ------------------------------------------------------------ generic row list (home, dealer)
  /** rows: [{ title, sub, subColor, tag, price, priceColor, status, statusColor, btn: { label, enabled } }] */
  _rowList(rows, y0, ROWS = 7, RH = 58) {
    this._count = () => rows.length;
    if (this.sel >= rows.length) this.sel = Math.max(0, rows.length - 1);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + ROWS) this.scroll = this.sel - ROWS + 1;
    const g = this._g();
    rows.slice(this.scroll, this.scroll + ROWS).forEach((r, k) => {
      const i = this.scroll + k, y = y0 + k * RH, sel = i === this.sel;
      g.fillStyle(sel ? C.ink3 : C.ink2, 1).fillRoundedRect(30, y, GAME_W - 60, RH - 6, 10);
      if (sel) g.lineStyle(3, C.orange, 1).strokeRoundedRect(30, y, GAME_W - 60, RH - 6, 10);
      const ok = r.btn?.enabled !== false;
      this._t(48, y + 6, r.title, { head: true, size: 20, color: ok ? S.paper : S.muted });
      if (r.sub) this._t(48, y + 30, r.sub, { size: 13, color: r.subColor || S.muted, wrap: 640 });
      if (r.tag) this._t(700, y + 5, r.tag, { head: true, size: 11, color: S.muted });
      if (r.price != null) this._t(900, y + 14, r.price, { head: true, size: 21, ox: 1, color: r.priceColor || S.paper });
      if (r.status) this._t(920, y + 8, r.status, { size: 13, color: r.statusColor || S.muted, wrap: 190 });
      if (r.btn) this._button(g, GAME_W - 190, y + 8, 130, 38, r.btn.label, { enabled: ok, selected: sel && ok });
      const z = this.add.zone(30, y, GAME_W - 60, RH - 6).setOrigin(0).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => { if (this.sel !== i) { this.sel = i; this._render(); } });
      z.on('pointerdown', () => { this.sel = i; this._do(i); });
      this.layer.add(z);
    });
    if (rows.length > ROWS) {
      const th = ROWS * RH, h = th * ROWS / rows.length, ty = y0 + (th - h) * (this.scroll / (rows.length - ROWS));
      g.fillStyle(C.ink3, 1).fillRoundedRect(GAME_W - 20, y0, 6, th, 3);
      g.fillStyle(C.orange, 1).fillRoundedRect(GAME_W - 20, ty, 6, h, 3);
    }
    if (this.msg) this._t(40, GAME_H - 56, this.msg.t, { head: true, size: 18, color: this.msg.c });
  }

  // ------------------------------------------------------------ home
  _home() {
    const home = this.eco?.home;
    if (!home) { this._count = () => 0; this._t(40, 120, 'Home is not available.', { size: 20 }); return; }
    const info = home.getInfo();
    const g = this._g();
    const stageCol = { ok: C.green, late: C.gold, warning: C.orange, evicted: C.red }[info.stage];
    const stageTxt = { ok: 'RENT PAID', late: 'RENT LATE', warning: 'FINAL NOTICE', evicted: 'LOCKED OUT' }[info.stage];
    g.fillStyle(C.ink2, 1).fillRoundedRect(30, 100, GAME_W - 60, 92, 12).lineStyle(2, C.ink3, 1).strokeRoundedRect(30, 100, GAME_W - 60, 92, 12);
    g.fillStyle(stageCol, 1).fillRoundedRect(30, 108, 5, 76, 2);
    this._t(52, 106, info.name.toUpperCase(), { head: true, size: 26 });
    this._t(52, 138, `${info.street ? `${info.street}, ` : ''}${info.area}`, { size: 14, color: S.muted });
    this._t(52, 160, info.blurb, { size: 12, color: S.muted, wrap: 560 });
    this._t(GAME_W - 52, 106, `${fmtKr(info.rent)} / week`, { head: true, size: 24, ox: 1 });
    const due = info.stage === 'ok' ? `Paid until ${dayName(info.paidUntilDay)}, day ${info.paidUntilDay + 1} (${info.daysToDue} day${info.daysToDue === 1 ? '' : 's'})` : info.stage === 'evicted' ? 'Pay the rent to move back in' : 'Pay now, no extra fees';
    this._t(GAME_W - 52, 138, due, { size: 14, ox: 1, color: info.stage === 'ok' ? S.muted : S.paper });
    this._t(GAME_W - 52, 158, `${stageTxt}${info.lqPerWeek ? `   ·   +${info.lqPerWeek} LQ per paid week` : ''}${info.parking ? `   ·   ${info.parking} parking spot${info.parking > 1 ? 's' : ''}` : ''}`, { head: true, size: 13, ox: 1, color: S[{ ok: 'green', late: 'gold', warning: 'orange', evicted: 'red' }[info.stage]] });
    const c = this.eco.getClock();
    const rows = [], acts = [];
    const sl = info.canSleep;
    rows.push({ title: 'Sleep until morning', sub: sl.ok ? `It is ${dayName(c.day)} ${String(c.hour).padStart(2, '0')}:00. Skips to 07:00, restores health, saves the game. +2 LQ when you sleep regularly.` : sl.reason, subColor: sl.ok ? S.muted : S.red, tag: 'REST', btn: { label: 'SLEEP', enabled: sl.ok } });
    acts.push(() => home.sleep());
    const canPay = info.canPay && this.st.money >= info.rent;
    rows.push({ title: 'Pay rent', sub: info.canPay ? (this.st.money >= info.rent ? `Pay one week (${fmtKr(info.rent)}) now. It is also debited automatically when it falls due.` : `You need ${fmtKr(info.rent)}`) : 'Nothing to pay yet', subColor: info.canPay && this.st.money < info.rent ? S.red : S.muted, tag: 'RENT', price: fmtKr(info.rent), priceColor: this.st.money >= info.rent ? S.paper : S.red, btn: { label: 'PAY', enabled: canPay } });
    acts.push(() => home.payRent());
    for (const e of this.eco.fleet.getGarage()) {
      const where = !e.vehicle ? 'Not parked: it will be fetched for you' : e.driving ? 'You are riding it' : e.distanceM <= 12 ? 'At your door' : `${e.distanceM} m from your door`;
      rows.push({ title: e.name, sub: `${e.kind === 'rented' ? `Rented, ${Math.ceil(e.minutesLeft / 60)} h left. ` : ''}${where}`, tag: e.kind === 'rented' ? 'RENTED' : 'GARAGE', btn: { label: 'BRING', enabled: !e.driving } });
      acts.push(() => this.eco.fleet.bringToDoor(e.key));
    }
    for (const u of info.upgrades) {
      rows.push({ title: `Move to: ${u.name}`, sub: `${u.area}. Rent ${fmtKr(u.rent)}/week, +${u.lqPerWeek} LQ per paid week${u.parking ? ', parking included' : ''}. Move-in ${fmtKr(u.moveCost)}.`, subColor: u.available ? S.muted : S.muted, tag: 'HOUSING', price: fmtKr(u.moveCost), priceColor: this.st.money >= u.moveCost ? S.paper : S.red, status: u.reason, statusColor: S.red, btn: { label: 'MOVE', enabled: u.available } });
      acts.push(() => home.moveTo(u.tier));
    }
    this._do = (i) => {
      const res = acts[i]?.();
      if (!res) return;
      this._flash(res, rows[i].title === 'Sleep until morning' ? 'Good morning!' : rows[i].title === 'Pay rent' ? 'Rent paid.' : i >= 2 && rows[i].tag !== 'HOUSING' ? 'Parked at your door.' : 'Welcome home.');
      this._render();
    };
    this._rowList(rows, 208, 8, 56);
  }

  // ------------------------------------------------------------ dealer
  _dealer() {
    const shop = this.eco?.activeShop, fleet = this.eco?.fleet;
    if (!shop || !fleet) { this._count = () => 0; this._t(40, 120, 'No shop here.', { size: 20 }); return; }
    const g = this._g();
    g.fillStyle(C.ink2, 1).fillRoundedRect(30, 100, GAME_W - 60, 84, 12).lineStyle(2, C.ink3, 1).strokeRoundedRect(30, 100, GAME_W - 60, 84, 12);
    const col = { blue: C.blue, gold: C.gold, orange: C.orange }[shop.color] || C.orange;
    g.fillStyle(col, 1).fillRoundedRect(30, 108, 5, 68, 2);
    this._t(52, 106, shop.label.toUpperCase(), { head: true, size: 14, color: S.muted });
    this._t(52, 126, `${shop.street || ''}${shop.district ? `${shop.street ? ' · ' : ''}${shop.district}` : ''}`, { size: 16 });
    this._t(52, 152, shop.blurb || (shop.buy.length ? 'Buy a vehicle of your own, or get yours repaired.' : 'Rent by the day. Vehicles go back by themselves when the rental ends.'), { size: 13, color: S.muted, wrap: 700 });
    const lic = fleet.licence();
    if (lic.banned) this._t(GAME_W - 52, 112, 'LICENCE SUSPENDED: no cars or vans', { head: true, size: 16, ox: 1, color: S.red });
    const offers = fleet.getOffers(shop);
    const rows = offers.map((o) => {
      if (o.kind === 'buy') return { title: o.name, sub: o.owned ? 'In your garage' : `Yours for keeps. It waits at your door every day.${o.insurance ? ` Insurance kr ${o.insurance}/week.` : ''}`, tag: 'BUY', price: fmtKr(o.price), priceColor: o.affordable ? S.paper : S.red, status: o.reason, statusColor: S.red, btn: { label: o.owned ? 'OWNED' : 'BUY', enabled: o.available } };
      if (o.kind === 'rent') {
        const d = this.rentDays[o.type] || 1;
        return { title: `Rent: ${o.name}`, sub: `kr ${o.perDay}/day.  < ${d} day${d > 1 ? 's' : ''} >  Goes back by itself when time is up.${o.rentedUntil ? '  (already rented: this extends it)' : ''}`, tag: 'RENT', price: fmtKr(o.perDay * d), priceColor: this.st.money >= o.perDay * d ? S.paper : S.red, status: o.reason, statusColor: S.red, btn: { label: o.rentedUntil ? 'EXTEND' : 'RENT', enabled: o.available } };
      }
      const q = o.quote;
      return { title: 'Repair my vehicle', sub: q ? `${q.name}: ${q.missing} damage points${q.insured ? ', insured: half price' : ''}. kr 12 per point.` : 'Stand next to your vehicle first', tag: 'WORKSHOP', price: q ? fmtKr(q.cost) : null, priceColor: o.affordable ? S.paper : S.red, status: o.reason, statusColor: S.muted, btn: { label: 'REPAIR', enabled: o.available } };
    });
    this._do = (i) => {
      const o = offers[i];
      if (!o) return;
      let res;
      if (o.kind === 'buy') res = fleet.buy(shop.id, o.type);
      else if (o.kind === 'rent') res = fleet.rent(shop.id, o.type, this.rentDays[o.type] || 1);
      else res = fleet.repair();
      this._flash(res, o.kind === 'buy' ? `Bought ${o.name}. It is parked outside.` : o.kind === 'rent' ? `${o.name} rented. It is waiting outside.` : 'Repaired.');
      this._render();
    };
    this._lr = (d) => {
      const o = offers[this.sel];
      if (o?.kind !== 'rent') return;
      this.rentDays[o.type] = Phaser.Math.Clamp((this.rentDays[o.type] || 1) + d, 1, 3);
      this._render();
    };
    this._rowList(rows, 200, 8, 56);
  }

  close() {
    this.scene.resume('Game');
    bus.emit(EV.OVERLAY_CLOSED, {});
    this.scene.stop();
  }
}
