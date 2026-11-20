/**
 * HUDScene: heads-up display, runs in parallel on top of GameScene.   OWNER: UI specialist
 *
 * Layout (1280x720, scales with the window through Phaser FIT):
 *   top-left   money (+ animated delta), LQ bar + skill-point badge, player health
 *   top-right  heat sirens (1-5; flashing in pursuit, slow pulse when searching), bust meter, order card
 *   bottom-left  pager feed (src/ui/Pager.js)
 *   bottom-centre  prompt + vehicle panel (speed, health, capacity)
 *   bottom-right  north-up minimap (player, target, contacts, police)
 *   centre     big state banners: BUSTED, KNOCKED OUT, DELIVERED, ORDER FAILED, plus EV.BANNER text
 *   screen edge  waypoint arrow towards the current target when it is off screen
 *
 * Traffic rules: speed-limit sign (bottom-centre, left of the vehicle panel; speed turns orange/red when over), licence-clip pips
 * (right of the panel), ticket popup under the audio panel (POLICE_EV.TICKET), minimap shop/dealer squares (economy.getMapPOIs).
 *
 * Read-only: reads session.state and the Game scene (player, systems, world, minimap). Everything
 * from other systems is read defensively (missing methods fall back gracefully).
 * Listens: PAGER, PROMPT, BANNER, MONEY_CHANGED, LQ_CHANGED, SKILL_POINT, HEAT_CHANGED, BUST_PROGRESS,
 *          JOB_*, BUSTED, PLAYER_DIED, PURCHASED, SKILL_UPGRADED.
 * Job offers: shows an offer card with [Y]/[N] hint; the MissionSystem handles the keys.
 */
import Phaser from 'phaser';
import { listen, EV, POLICE_EV } from '../core/events.js';
import { session } from '../core/state.js';
import { GAME_W, GAME_H, PX } from '../config.js';
import { C, S, F, txt, panel, icon, ensureFonts, fmtKr, fmtTime, lqThreshold } from '../ui/theme.js';
import { Pager } from '../ui/Pager.js';
import { getContacts } from '../data/contacts.js';
import { contactEnabled, pursuitEnabled } from '../core/options.js';

const MM = 212; // minimap size
const STAGE_LABEL = { pickup: 'PICK UP', dropoff: 'DELIVER', enter: 'GET IN', busstop: 'STOP AT' };

export class HUDScene extends Phaser.Scene {
  constructor() { super('HUD'); }

  create() {
    ensureFonts();
    this.gameScene = this.scene.get('Game');
    this.shownMoney = session.state?.money ?? 0;
    this.offer = null;
    this.bust = 0;
    this.bannerTween = null;
    this.lastBanner = { kind: '', at: -9999 };
    this.pagerStamp = -9999;
    this.contactPts = null;

    this._buildStatic();
    this._buildAudio();
    this._buildRules();
    this.pager = new Pager(this, 16, GAME_H - 16);
    this._buildBanner();
    this._bind();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.pager?.destroy());
  }

  // ------------------------------------------------------------------ build
  _buildStatic() {
    const sc = this;
    // --- top-left status panel
    const g = this.add.graphics();
    panel(g, 16, 16, 262, 118);
    this.icMoney = icon(sc, 'money', 40, 40, 26);
    this.moneyText = txt(sc, 62, 22, '', { head: true, size: 30 });
    // LQ
    txt(sc, 32, 62, 'LQ', { head: true, size: 15, color: S.orange });
    this.lqText = txt(sc, 56, 61, '', { size: 14, color: S.paper });
    this.lqNext = txt(sc, 262, 61, '', { size: 12, color: S.muted, ox: 1 });
    this.spBadge = this.add.container(0, 0);
    const spG = this.add.graphics().fillStyle(C.orange, 1).fillRoundedRect(0, 0, 92, 20, 10);
    this.spText = txt(sc, 46, 10, '', { head: true, size: 13, color: S.ink, ox: 0.5, oy: 0.5 });
    this.spBadge.add([spG, this.spText]).setPosition(170, 56).setVisible(false);
    // health
    this.icHeart = icon(sc, 'heart', 40, 112, 20);
    this.hpText = txt(sc, 262, 98, '', { size: 12, color: S.muted, ox: 1 });
    this.barsGfx = this.add.graphics();

    // --- top-right heat panel + order card
    this.heatG = this.add.graphics();
    this.heatLabel = txt(sc, GAME_W - 254, 24, '', { head: true, size: 16 });
    this.heatSub = txt(sc, GAME_W - 30, 24, '', { head: true, size: 14, ox: 1 });
    this.cardG = this.add.graphics();
    this.cardHead = txt(sc, GAME_W - 292, 96, '', { head: true, size: 13, color: S.orange });
    this.cardTitle = txt(sc, GAME_W - 292, 112, '', { size: 14, color: S.muted, wrap: 190 });
    this.cardDest = txt(sc, GAME_W - 292, 134, '', { head: true, size: 22, wrap: 190 });
    this.cardTimer = txt(sc, GAME_W - 30, 112, '', { head: true, size: 36, ox: 1 });
    this.cardSteps = txt(sc, GAME_W - 292, 0, '', { head: true, size: 13, color: S.muted });
    this.cardPay = txt(sc, GAME_W - 30, 0, '', { head: true, size: 20, color: S.green, ox: 1 });
    this.cardDist = txt(sc, GAME_W - 292, 0, '', { size: 12, color: S.muted });
    this.cardOffer = txt(sc, GAME_W - 292, 0, '', { head: true, size: 15, color: S.gold });
    this.cardText = [this.cardHead, this.cardTitle, this.cardDest, this.cardTimer, this.cardSteps, this.cardPay, this.cardDist, this.cardOffer];

    // --- bottom-centre: prompt + vehicle panel
    this.promptG = this.add.graphics();
    this.promptText = txt(sc, GAME_W / 2, GAME_H - 108, '', { head: true, size: 20, ox: 0.5, oy: 0.5 });
    this.vehG = this.add.graphics();
    this.speedText = txt(sc, GAME_W / 2 - 112, GAME_H - 80, '', { head: true, size: 40, ox: 0 });
    this.kmhText = txt(sc, GAME_W / 2 - 112 + 2, GAME_H - 38, 'KM/H', { head: true, size: 12, color: S.muted });
    this.vehName = txt(sc, GAME_W / 2 + 130, GAME_H - 76, '', { head: true, size: 15, ox: 1 });
    this.vehCap = txt(sc, GAME_W / 2 + 130, GAME_H - 28, '', { size: 12, color: S.muted, ox: 1 });
    this.vehGroup = [this.vehG, this.speedText, this.kmhText, this.vehName, this.vehCap];

    // --- minimap
    const x0 = GAME_W - 16 - MM, y0 = GAME_H - 16 - MM;
    this.mmX = x0; this.mmY = y0;
    const mm = this.gameScene.minimap;
    this.mmImg = mm ? this.add.image(0, 0, mm.key).setOrigin(0, 0) : null;
    this.mmDots = this.add.graphics();
    this.mmFrame = this.add.graphics();
    this.mmFrame.lineStyle(3, C.ink, 1).strokeRoundedRect(x0 - 1, y0 - 1, MM + 2, MM + 2, 8);
    this.mmFrame.lineStyle(2, C.orange, 1).strokeRoundedRect(x0 - 4, y0 - 4, MM + 8, MM + 8, 10);
    txt(sc, x0 + MM - 8, y0 + 4, 'N', { head: true, size: 14, ox: 1, stroke: S.ink, strokeThickness: 3 });
    // mask the image to the minimap box
    if (this.mmImg) {
      const mg = this.make.graphics({}, false).fillStyle(0xffffff).fillRoundedRect(x0, y0, MM, MM, 6);
      this.mmImg.setMask(mg.createGeometryMask());
    }

    // --- location label above the minimap: "Street · District" + optional "Near <landmark>"
    this.locX = x0; this.locW = MM;
    this.locBox = this.add.container(0, 0);
    this.locG = this.add.graphics();
    this.locStreet = txt(sc, x0 + 16, y0 - 66, '', { head: true, size: 17 });
    this.locNear = txt(sc, x0 + 16, y0 - 44, '', { head: true, size: 12, color: S.gold });
    this.locBox.add([this.locG, this.locStreet, this.locNear]);
    this.locShown = ''; this.locCand = ''; this.locSince = 0; this.locNext = 0; this.locFade = false;
    this.locY = y0;
    this.locBox.setAlpha(0);

    // --- waypoint arrow at screen edge
    this.wpG = this.add.graphics();
    this.wpText = txt(sc, 0, 0, '', { head: true, size: 14, ox: 0.5, oy: 0.5, stroke: S.ink, strokeThickness: 4 });

    // --- money delta popup pool
    this.deltaPool = [];
  }

  // Traffic rules: speed-limit sign (left of the vehicle panel), licence clips (right of it), ticket popup (top centre under the audio panel).
  _buildRules() {
    const cx = GAME_W / 2 - 132 - 14 - 32, cy = GAME_H - 56;
    this.signBox = this.add.container(cx, cy).setVisible(false);
    const g = this.add.graphics();
    g.fillStyle(C.ink, 0.35).fillCircle(2, 3, 32);
    g.fillStyle(0xd7262d, 1).fillCircle(0, 0, 31);
    g.fillStyle(0xffffff, 1).fillCircle(0, 0, 23);
    this.signText = txt(this, 0, 1, '50', { head: true, size: 29, ox: 0.5, oy: 0.5, color: '#111111' });
    this.signBox.add([g, this.signText]);
    this.signShown = -1;
    this.licG = this.add.graphics();
    this.licLabel = txt(this, 0, 0, 'LICENCE', { head: true, size: 11, color: S.muted });
    this.licSub = txt(this, 0, 0, '', { head: true, size: 12, color: S.red });
    this.ticketG = this.add.graphics();
    this.ticketHead = txt(this, 0, 0, '', { head: true, size: 28, color: S.gold });
    this.ticketSub = txt(this, 0, 0, '', { size: 15, color: S.paper, wrap: 330 });
    this.ticketTag = txt(this, 0, 0, '', { head: true, size: 12, color: S.blue, ox: 1 });
    this.ticketClip = txt(this, 0, 0, '', { head: true, size: 13, color: S.red, ox: 1 });
    this.ticket = null;
    this.ticketGroup = [this.ticketG, this.ticketHead, this.ticketSub, this.ticketTag, this.ticketClip];
    for (const o of this.ticketGroup) o.setVisible(false);
  }

  _buildAudio() {
    const g = this.add.graphics();
    panel(g, 420, 16, 530, 84, { r: 6 });
    const button = (x, w, label, action, y = 24, h = 28) => {
      g.fillStyle(C.ink3, 1).fillRoundedRect(x, y, w, h, 3);
      const text = txt(this, x + w / 2, y + h / 2, label, { head: true, size: 13, ox: 0.5, oy: 0.5 });
      const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => text.setColor(S.orange));
      zone.on('pointerout', () => text.setColor(S.paper));
      zone.on('pointerdown', () => {
        const audio = this.gameScene?.audio;
        if (!audio || !this.gameScene.scene.isActive()) return;
        audio.unlock();
        action(audio);
        this.audioNext = 0;
      });
      return text;
    };
    this.audioMute = button(432, 100, '[V] MUTE', audio => audio.toggleMute());
    button(538, 34, '−', audio => audio.changeVolume(-0.1));
    this.audioVolume = txt(this, 597, 38, '', { head: true, size: 13, ox: 0.5, oy: 0.5 });
    button(622, 34, '+', audio => audio.changeVolume(0.1));
    this.audioRadio = button(662, 118, '[R] RADIO OFF', audio => audio.toggleRadio());
    button(786, 152, '[T] NEXT STATION', audio => audio.nextStation());
    this.audioStation = txt(this, 434, 57, 'Radio available while riding', { size: 12, color: S.paper });
    txt(this, 434, 78, 'Live internet radio · Master volume', { size: 10, color: S.muted });
    button(810, 128, 'OFFICIAL PLAYER ↗', audio => {
      const page = audio.getStatus().stationPage;
      if (typeof page === 'string' && page.startsWith('https://')) window.open(page, '_blank', 'noopener,noreferrer');
    }, 74, 20);
    this.audioNext = 0;
    this.audioShown = '';
  }

  _audio(time) {
    if (time < this.audioNext) return;
    this.audioNext = time + 150;
    const status = this.gameScene.audio?.getStatus();
    if (!status) return;
    const volume = Math.round(status.volume * 100);
    const station = status.inCar ? `${status.stationName || 'Radio'} · ${status.radioStatus || (status.radioEnabled ? 'Connecting…' : 'Off')}` : 'Radio available while riding';
    const key = `${status.muted}|${volume}|${status.radioEnabled}|${station}`;
    if (key === this.audioShown) return;
    this.audioShown = key;
    this.audioMute.setText(status.muted ? '[V] UNMUTE' : '[V] MUTE');
    this.audioVolume.setText(`${volume}%`);
    this.audioRadio.setText(status.radioEnabled ? '[R] RADIO ON' : '[R] RADIO OFF');
    this.audioStation.setText(station.length > 70 ? `${station.slice(0, 67)}…` : station);
  }

  _buildBanner() {
    this.banner = this.add.container(GAME_W / 2, GAME_H / 2 - 70).setVisible(false).setDepth(50);
    this.bannerBg = this.add.graphics();
    this.bannerTitle = txt(this, 0, -14, '', { head: true, size: 76, ox: 0.5, oy: 0.5 });
    this.bannerSub = txt(this, 0, 50, '', { head: true, size: 24, ox: 0.5, oy: 0.5 });
    this.banner.add([this.bannerBg, this.bannerTitle, this.bannerSub]);
  }

  // ------------------------------------------------------------------ events
  _bind() {
    const stampSoon = (fn) => {
      const t0 = this.time.now;
      this.time.delayedCall(450, () => { if (this.pagerStamp < t0 - 100) fn(); });
    };
    listen(this, EV.PAGER, (m) => { this.pagerStamp = this.time.now; this.pager.push(m || {}); });
    listen(this, EV.PROMPT, ({ text }) => { this.promptValue = text || ''; });
    listen(this, EV.BANNER, ({ text, color, ms = 2000 }) => {
      const t = String(text || '').toUpperCase();
      if (/CAUGHT|BUSTED/.test(t)) return this._state('busted', 'BUSTED', '', ms);
      if (/KNOCKED/.test(t)) return this._state('ko', 'KNOCKED OUT', '', ms);
      this._state('custom', text, '', ms, color);
    });
    listen(this, EV.MONEY_CHANGED, ({ delta }) => { if (delta) this._moneyDelta(delta); });
    listen(this, EV.HEAT_CHANGED, ({ level, prevLevel }) => {
      this.heatFlash = this.time.now + 700;
      if (level > prevLevel) this.cameras.main.shake(120, 0.0015);
    });
    listen(this, POLICE_EV.TICKET, (t) => {
      this.ticket = { ...t, at: this.time.now, until: this.time.now + 5200 };
    });
    listen(this, POLICE_EV.LICENCE, ({ reason, banLeft }) => {
      if (reason === 'ban') this._state('fail', 'LICENCE SUSPENDED', `No driving cars for ${fmtTime(banLeft)}`, 2800);
    });
    listen(this, EV.BUST_PROGRESS, ({ t }) => { this.bust = t || 0; this.bustAt = this.time.now; });
    listen(this, EV.BUSTED, ({ fine } = {}) => {
      this.bust = 0;
      this._state('busted', 'BUSTED', fine ? `Fine ${fmtKr(fine)}` : '', 2600);
      stampSoon(() => this.pager.push({ text: fine ? `Busted. Fine: ${fmtKr(fine)}.` : 'Busted.', kind: 'crime' }));
    });
    listen(this, EV.PLAYER_DIED, () => {
      this._state('ko', 'KNOCKED OUT', 'Hospital bill incoming', 2600);
      stampSoon(() => this.pager.push({ text: 'You were knocked out and woke up at the hospital.', kind: 'warn' }));
    });
    listen(this, EV.JOB_OFFERED, ({ job, contact }) => {
      this.offer = { job, contact, until: this.time.now + 20000 };
      stampSoon(() => this.pager.push({ text: `New offer: ${job?.title || 'job'}. [Y] accept, [N] decline.`, kind: 'job', from: contact?.name }));
    });
    listen(this, EV.JOB_STARTED, ({ job }) => {
      this.offer = null;
      this.cardPulse = this.time.now + 600;
      stampSoon(() => this.pager.push({ text: `Order started: ${job?.title || ''}`, kind: 'job' }));
    });
    listen(this, EV.JOB_STAGE, () => { this.cardPulse = this.time.now + 600; });
    listen(this, EV.JOB_COMPLETED, ({ job, payout }) => {
      this.offer = null;
      const amt = payout ?? job?.reward ?? 0;
      const word = job?.kind === 'mission' ? 'MISSION DONE' : 'DELIVERED';
      this._state('ok', `${word}${amt ? ` +${fmtKr(amt)}` : ''}`, job?.title || '', 2600);
    });
    listen(this, EV.JOB_FAILED, ({ job, reason }) => {
      this.offer = null;
      this._state('fail', 'ORDER FAILED', reason ? String(reason) : (job?.title || ''), 2600);
      stampSoon(() => this.pager.push({ text: `Order failed${reason ? `: ${reason}` : '.'}`, kind: 'warn' }));
    });
    // hide the HUD while a modal overlay is open (it would bleed through the dim backdrop)
    listen(this, EV.OVERLAY_CLOSED, () => this.scene.setVisible(true));
    listen(this, EV.PURCHASED, ({ item }) => stampSoon(() => this.pager.push({ text: `Purchased: ${item?.name || item?.id || item}`, kind: 'info' })));
    listen(this, EV.SKILL_UPGRADED, ({ skill, level }) => stampSoon(() => this.pager.push({ text: `Skill upgraded: ${skill} level ${level}`, kind: 'info' })));
    listen(this, EV.SKILL_POINT, ({ skillPoints }) => stampSoon(() => this.pager.push({ text: `Skill point earned (${skillPoints}). Press K.`, kind: 'info' })));
  }

  _state(kind, title, sub, ms, color) {
    const now = this.time.now;
    if (kind === 'custom' && this.lastBanner.kind !== 'custom' && now - this.lastBanner.at < 1200) return; // a typed banner just showed
    if (this.lastBanner.kind === kind && now - this.lastBanner.at < 900 && kind !== 'custom') {
      if (sub) this.bannerSub.setText(sub);
      return;
    }
    this.lastBanner = { kind, at: now };
    const col = { busted: [C.blue, S.paper], ko: [C.red, S.paper], ok: [C.green, S.ink], fail: [C.red, S.paper], custom: [C.orange, S.ink] }[kind];
    let fill = col[0];
    if (kind === 'custom') {
      if (typeof color === 'number') fill = color;
      else if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) fill = parseInt(color.slice(1), 16);
    }
    this.bannerTitle.setFontSize(kind === 'custom' ? 40 : 76);
    this.bannerTitle.setText(String(title)).setColor(col[1]);
    this.bannerSub.setText(sub || '').setColor(col[1]);
    this.bannerTitle.setScale(1);
    if (this.bannerTitle.width > 860) this.bannerTitle.setScale(860 / this.bannerTitle.width);
    const tw = this.bannerTitle.width * this.bannerTitle.scaleX;
    const w = Math.max(420, tw + 120), h = sub ? 164 : 112;
    const top = -h / 2 - (sub ? 0 : 0);
    this.bannerTitle.y = sub ? -28 : 0;
    this.bannerSub.y = 46;
    this.bannerBg.clear();
    // slanted band with ink shadow and paper rule: courier "label" feel
    const sk = 26;
    const pts = (ox, oy, ww) => [{ x: -ww / 2 + sk + ox, y: top + oy }, { x: ww / 2 + ox, y: top + oy }, { x: ww / 2 - sk + ox, y: top + h + oy }, { x: -ww / 2 + ox, y: top + h + oy }];
    this.bannerBg.fillStyle(C.ink, 0.55).fillPoints(pts(8, 8, w), true);
    this.bannerBg.fillStyle(fill, 1).fillPoints(pts(0, 0, w), true);
    this.bannerBg.lineStyle(4, C.ink, 1).strokePoints(pts(0, 0, w), true);
    this.bannerBg.fillStyle(C.ink, 0.28).fillRect(-w / 2 + 10, top + h - 10, w - 20, 4);
    this.bannerTween?.stop();
    this.banner.setVisible(true).setAlpha(1).setScale(0.6, 0.6).setAngle(-3);
    this.bannerTween = this.tweens.chain({
      targets: this.banner,
      tweens: [
        { scaleX: 1.08, scaleY: 1.08, angle: -2, duration: 170, ease: 'Back.easeOut' },
        { scaleX: 1, scaleY: 1, duration: 120 },
        { alpha: 1, duration: Math.max(200, ms - 600) },
        { alpha: 0, y: GAME_H / 2 - 110, duration: 300, onComplete: () => { this.banner.setVisible(false).setY(GAME_H / 2 - 70); } },
      ],
    });
  }

  _moneyDelta(delta) {
    const pos = delta > 0;
    const t = txt(this, 290, 26, `${pos ? '+' : '-'}${fmtKr(Math.abs(delta))}`, { head: true, size: 22, color: pos ? S.green : S.red, stroke: S.ink, strokeThickness: 4 });
    t.setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 40, duration: 150 });
    this.tweens.add({ targets: t, alpha: 0, y: 62, delay: 1100, duration: 500, onComplete: () => t.destroy() });
    this.moneyPulse = this.time.now + 350;
  }

  // ------------------------------------------------------------------ frame
  update(time) {
    const g = this.gameScene, st = session.state;
    if (!g || !g.player || !st) return;
    const p = g.player, sys = g.systems || {};
    this.pager.update(time);
    this._audio(time);

    this._status(st, p, time);
    const police = sys.police;
    this._heat(st, police, time);
    this._card(st, sys, p, time);
    this._vehicle(p);
    this._rules(p, sys, time);
    this._prompt(p, time);
    this._minimap(g, p, sys, time);
    this._location(g, p, time);
    this._waypoint(g, sys, p, time);
  }

  // Street + district label. Sampled ~7x/s; a new location must be stable for 0.6 s before it cross-fades in.
  _location(g, p, time) {
    const w = g.world;
    if (!w?.streetAt || time < this.locNext) return;
    this.locNext = time + 140;
    const x = p.px ?? p.x, y = p.py ?? p.y;
    if (x === undefined) return;
    const street = w.streetAt(x, y) || '';
    const dist = w.districtAt(x, y) || '';
    const lm = w.nearestLandmark(x, y, 60 * 8);
    const l1 = street ? (dist ? `${street} \u00b7 ${dist}` : street) : dist;
    const l2 = lm ? `Near ${lm.name}` : '';
    const cand = `${l1}|${l2}`;
    if (cand !== this.locCand) { this.locCand = cand; this.locSince = time; }
    if (cand === this.locShown || time - this.locSince < 600 || this.locFade) return;
    this.locFade = true;
    this.tweens.add({
      targets: this.locBox, alpha: 0, duration: this.locShown ? 140 : 0,
      onComplete: () => {
        this.locShown = cand;
        this._locDraw(l1, l2);
        this.tweens.add({ targets: this.locBox, alpha: l1 ? 1 : 0, duration: 220, onComplete: () => { this.locFade = false; } });
      },
    });
  }

  _locDraw(l1, l2) {
    const h = l2 ? 48 : 30, x0 = this.locX, y = this.locY - 12 - h;
    this.locG.clear();
    panel(this.locG, x0, y, this.locW, h, { r: 9, alpha: 0.82 });
    this.locStreet.setText(l1).setPosition(x0 + 16, y + 5);
    this.locStreet.setScale(Math.min(1, (this.locW - 28) / Math.max(1, this.locStreet.width)));
    this.locNear.setText(l2).setPosition(x0 + 16, y + 27).setVisible(!!l2);
  }

  _status(st, p, time) {
    this.shownMoney += (st.money - this.shownMoney) * 0.2;
    if (Math.abs(st.money - this.shownMoney) < 1) this.shownMoney = st.money;
    this.moneyText.setText(fmtKr(this.shownMoney));
    this.moneyText.setScale(time < (this.moneyPulse || 0) ? 1.08 : 1);
    // LQ
    const eco = this.gameScene.systems?.economy;
    const pr = eco?.getLQProgress?.();
    const n = st.milestonesReached || 0;
    const prev = pr?.prev ?? (n > 0 ? lqThreshold(n) : 0), next = pr?.next ?? lqThreshold(n + 1);
    const f = pr?.t != null ? Phaser.Math.Clamp(pr.t, 0, 1) : Phaser.Math.Clamp((st.lq - prev) / Math.max(1, next - prev), 0, 1);
    this.lqText.setText(String(Math.round(st.lq)));
    this.lqNext.setText(`next ${next}`);
    const sp = st.skillPoints || 0;
    this.spBadge.setVisible(sp > 0);
    if (sp > 0) {
      this.spText.setText(`+${sp} SKILL [K]`);
      this.spBadge.setScale(1 + 0.04 * Math.sin(time / 180));
      this.lqNext.setVisible(false);
    } else this.lqNext.setVisible(true);
    const hf = Phaser.Math.Clamp(p.health / (p.maxHealth || 100), 0, 1);
    this.hpText.setText(`${Math.ceil(p.health)} / ${p.maxHealth}`);
    const b = this.barsGfx.clear();
    b.fillStyle(C.ink3, 1).fillRoundedRect(32, 82, 230, 8, 4);
    b.fillStyle(C.orange, 1).fillRoundedRect(32, 82, Math.max(2, 230 * f), 8, 4);
    b.fillStyle(C.ink3, 1).fillRoundedRect(56, 106, 206, 10, 5);
    const low = hf < 0.3;
    b.fillStyle(low && Math.floor(time / 200) % 2 ? C.paper : C.red, 1).fillRoundedRect(56, 106, Math.max(2, 206 * hf), 10, 5);
  }

  _policeInfo(police, p) {
    const units = [];
    for (const u of police?.units || []) {
      const v = u?.v || u; // police units are { v: Vehicle, ... }
      if (v && !v.destroyed && v.state !== 'wreck' && v.x != null) units.push(v);
    }
    let pursuit;
    if (typeof police?.isPursuit === 'function') pursuit = police.isPursuit();
    else if (typeof police?.inPursuit === 'boolean') pursuit = police.inPursuit;
    else pursuit = units.some((u) => Math.hypot(u.x - p.px, u.y - p.py) < 60 * PX);
    const searching = typeof police?.isSearching === 'function' ? police.isSearching() : !pursuit;
    return { units, pursuit, searching };
  }

  _heat(st, police, time) {
    if (!pursuitEnabled()) {
      // Realistic game: no heat, no pursuit, no bust meter. (A traffic-rules module may draw fines here later.)
      this.heatG.clear();
      this.heatLabel.setVisible(false);
      this.heatSub.setVisible(false);
      this.bustLabel?.setVisible(false);
      return;
    }
    this.heatLabel.setVisible(true);
    const lvl = Math.floor(st.heat || 0);
    const { pursuit } = this._policeInfo(police, this.gameScene.player);
    const g = this.heatG.clear();
    const x0 = GAME_W - 16 - 262, w = 262;
    const flashing = lvl > 0 && pursuit;
    const edge = flashing && Math.floor(time / 220) % 2 ? C.red : C.ink3;
    panel(g, x0, 16, w, 54, { stroke: edge, accent: lvl > 0 ? (flashing ? C.red : C.orange) : C.ink3 });
    for (let i = 0; i < 5; i++) {
      const cx = x0 + 150 + i * 22 - 20, cy = 44 + 4;
      const on = i < lvl;
      let col = C.ink3, a = 1;
      if (on) {
        if (flashing) col = (Math.floor(time / 180) + i) % 2 ? C.red : C.blue;
        else { col = C.orange; a = 0.55 + 0.45 * Math.sin(time / 380 + i); }
      }
      const r = 9;
      g.fillStyle(col, a).beginPath().arc(cx, cy, r, Math.PI, 0).closePath().fillPath();
      g.fillRect(cx - r - 2, cy, 2 * r + 4, 4);
      g.fillStyle(on ? C.paper : C.ink3, on ? 0.7 : 0.4).fillRect(cx - 3, cy - r + 2, 3, 4);
    }
    this.heatLabel.setText(lvl > 0 ? 'HEAT' : 'CLEAR').setColor(lvl > 0 ? S.orange : S.muted);
    this.heatSub.setVisible(false);
    if (lvl > 0) {
      this.heatSub.setVisible(true);
      this.heatSub.setText(flashing ? 'PURSUIT' : 'SEARCHING').setColor(flashing ? S.red : S.gold);
      this.heatSub.y = 55;
      this.heatSub.setFontSize(12).setX(x0 + 16).setOrigin(0, 0.5);
      this.heatSub.y = 60;
      this.heatLabel.setX(x0 + 16);
    } else this.heatLabel.setX(x0 + 16);
    this.heatLabel.y = lvl > 0 ? 26 : 34;
    // bust meter
    if (this.bust > 0 && time - (this.bustAt || 0) > 600) this.bust = 0;
    if (this.bust > 0) {
      const by = 76;
      panel(g, x0, by, w, 26, { accent: C.blue, r: 8 });
      g.fillStyle(C.ink3, 1).fillRoundedRect(x0 + 14, by + 9, w - 28, 8, 4);
      g.fillStyle(C.blue, 1).fillRoundedRect(x0 + 14, by + 9, Math.max(2, (w - 28) * this.bust), 8, 4);
      this.bustLabel ??= txt(this, x0 + 16, by + 2, '', { head: true, size: 10, color: S.blue });
      this.bustLabel.setText('BUSTING').setVisible(true).setY(by - 11 + 4);
    } else this.bustLabel?.setVisible(false);
    this.cardTop = this.bust > 0 ? 112 : 82;
  }

  _card(st, sys, p, time) {
    const g = this.cardG.clear();
    const job = st.job;
    const mo = sys.missions?.offer;
    let offer = null;
    if (mo?.job) offer = { job: mo.job, contact: mo.contact, auto: mo.auto, expiresIn: mo.expiresIn };
    else if (job?.state === 'offered') offer = { job, contact: null };
    else if (this.offer && time < this.offer.until && !job && !sys.missions) offer = this.offer;
    const show = (job && job.state !== 'offered') || offer;
    for (const t of this.cardText) t.setVisible(false);
    if (!show) return;
    const x0 = GAME_W - 16 - 300, y0 = this.cardTop ?? 82, w = 300;
    const pulse = time < (this.cardPulse || 0);
    if (offer) {
      const j = offer.job || {};
      panel(g, x0, y0, w, 112, { stroke: C.gold, accent: C.gold });
      this.cardHead.setText(`NEW OFFER${offer.contact?.name ? ` · ${offer.contact.name.toUpperCase()}` : ''}`).setColor(S.gold).setVisible(true);
      this.cardTitle.setText(j.title || '').setVisible(true);
      this.cardDest.setText(j.reward ? fmtKr(j.reward) : '').setColor(S.green).setVisible(true);
      this.cardOffer.setText(offer.auto ? '[Y] ACCEPT NOW     [N] DECLINE' : '[Y] ACCEPT     [N] DECLINE').setVisible(true);
      this._layoutCard(x0, y0, { head: 12, title: 30, dest: 56, offer: 86 });
      this.cardDest.setWordWrapWidth(280);
      return;
    }
    const stage = job.stages?.[job.stageIndex ?? 0] || null;
    const hasTimer = job.timeLeft != null;
    const shift = job.kind === 'shift';
    const behind = shift && hasTimer && job.timeLeft <= 0; // bus shift: 0 means behind schedule, not expired
    const urgent = hasTimer && !shift && job.timeLeft < 15;
    const flash = urgent && Math.floor(time / 250) % 2;
    const edge = urgent ? (flash ? C.red : C.ink3) : (pulse ? C.paper : C.ink3);
    panel(g, x0, y0, w, 138, { stroke: edge, accent: urgent ? C.red : C.orange });
    this.cardHead.setText(`${job.kind === 'mission' ? 'MISSION' : shift ? 'SHIFT' : 'ORDER'} · ${STAGE_LABEL[stage?.action] || 'GO'}`).setColor(S.orange).setVisible(true);
    const ttl = job.title || ''; // one line only: a wrapped title would overlap the destination
    this.cardTitle.setText(ttl.length > 25 ? `${ttl.slice(0, 24)}…` : ttl).setVisible(true);
    this.cardDest.setText(stage?.name || '...').setColor(S.paper).setVisible(true).setWordWrapWidth(186);
    if (hasTimer) {
      if (behind) this.cardTimer.setText('LATE').setColor(S.gold).setVisible(true);
      else this.cardTimer.setText(fmtTime(job.timeLeft)).setColor(urgent ? (flash ? S.paper : S.red) : S.paper).setVisible(true);
    } else this.cardTimer.setText('--').setColor(S.muted).setVisible(true);
    // step dots
    const n = job.stages?.length || 0;
    for (let i = 0; i < n; i++) {
      const done = i < (job.stageIndex ?? 0), cur = i === (job.stageIndex ?? 0);
      g.fillStyle(done ? C.green : cur ? C.orange : C.ink3, 1).fillRoundedRect(x0 + 16 + i * 26, y0 + 108, 20, 6, 3);
    }
    this.cardPay.setText(job.reward ? fmtKr(job.reward) : '').setVisible(true);
    const tp = sys.missions?.targetPoint?.();
    if (tp) {
      const d = Math.hypot(tp.x - p.px, tp.y - p.py) / PX;
      this.cardDist.setText(d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`).setVisible(true);
    }
    const req = stage?.requires?.capacity;
    if (req) this.cardSteps.setText(`NEEDS CAPACITY ${req}`).setColor(p.capacity >= req ? S.muted : S.red).setVisible(true);
    this._layoutCard(x0, y0, { head: 12, title: 30, dest: 54, timer: 26, pay: 106, dist: 108, steps: 88 });
  }

  _layoutCard(x0, y0, o) {
    const r = x0 + 300;
    this.cardHead.setPosition(x0 + 16, y0 + o.head);
    this.cardTitle.setPosition(x0 + 16, y0 + o.title).setWordWrapWidth(180);
    this.cardDest.setPosition(x0 + 16, y0 + o.dest);
    if (o.timer != null) this.cardTimer.setPosition(r - 16, y0 + o.timer);
    if (o.pay != null) this.cardPay.setPosition(r - 16, y0 + o.pay);
    if (o.dist != null) this.cardDist.setPosition(x0 + 16 + 90, y0 + o.dist + 1);
    if (o.steps != null) this.cardSteps.setPosition(x0 + 16, y0 + o.steps);
    if (o.offer != null) this.cardOffer.setPosition(x0 + 16, y0 + o.offer);
  }

  _vehicle(p) {
    const v = p.vehicle;
    for (const o of this.vehGroup) o.setVisible(!!v);
    const g = this.vehG.clear();
    if (!v) return;
    const x0 = GAME_W / 2 - 132, y0 = GAME_H - 96, w = 264, h = 80;
    panel(g, x0, y0, w, h);
    const hp = Phaser.Math.Clamp(v.health / (v.def.health || 100), 0, 1);
    g.fillStyle(C.ink3, 1).fillRoundedRect(x0 + 124, y0 + 44, 124, 9, 4);
    g.fillStyle(hp < 0.3 ? C.red : hp < 0.6 ? C.gold : C.green, 1).fillRoundedRect(x0 + 124, y0 + 44, Math.max(2, 124 * hp), 9, 4);
    const kmh = Math.round((v.speedMps || 0) * 3.6);
    const lim = Math.round(this.gameScene.world?.speedLimitAt?.(v.x, v.y) ?? 50);
    this.speedText.setText(String(kmh)).setPosition(x0 + 20, y0 + 10).setColor(kmh > lim + 5 ? S.red : kmh > lim + 1 ? S.orange : S.paper);
    this.curLimit = lim;
    this.kmhText.setPosition(x0 + 22, y0 + 56);
    this.vehName.setText(v.def.name.toUpperCase()).setPosition(x0 + w - 16, y0 + 12 + 2);
    this.vehCap.setText(v.state === 'burning' ? 'ON FIRE! GET OUT' : `HULL ${Math.ceil(v.health)}  ·  CARGO ${v.def.capacity}`).setColor(v.state === 'burning' ? S.red : S.muted).setPosition(x0 + w - 16, y0 + 60);
  }

  _rules(p, sys, time) {
    // speed-limit sign
    const v = p.vehicle;
    this.signBox.setVisible(!!v);
    if (v && this.curLimit !== this.signShown) { this.signShown = this.curLimit; this.signText.setText(String(this.curLimit)); this.signText.setScale(String(this.curLimit).length > 2 ? 0.85 : 1); }
    // licence clips: right of the vehicle panel
    const lic = sys.police?.getLicence?.();
    const g = this.licG.clear();
    const show = !!lic && (lic.clips > 0 || lic.banned);
    this.licLabel.setVisible(show); this.licSub.setVisible(show && lic.banned);
    if (show) {
      const x0 = GAME_W / 2 + 132 + 14, y0 = GAME_H - 96, w = 118, h = 52;
      panel(g, x0, y0, w, h, { r: 8, accent: lic.banned ? C.red : C.gold, stroke: lic.banned ? C.red : C.ink3 });
      this.licLabel.setPosition(x0 + 16, y0 + 6).setText(lic.banned ? 'DRIVING BAN' : 'LICENCE CLIPS').setColor(lic.banned ? S.red : S.muted);
      for (let i = 0; i < lic.maxClips; i++) {
        const cx = x0 + 28 + i * 26, cy = y0 + 34, on = i < lic.clips || lic.banned;
        g.fillStyle(on ? C.red : C.ink3, 1).fillCircle(cx, cy, 8);
        g.lineStyle(2, on ? 0xffb3b6 : C.muted, 1).strokeCircle(cx, cy, 8);
        if (on) g.lineStyle(2, C.paper, 1).lineBetween(cx - 4, cy - 4, cx + 4, cy + 4).lineBetween(cx - 4, cy + 4, cx + 4, cy - 4);
      }
      this.licSub.setPosition(x0 + w - 8, y0 + 6).setOrigin(1, 0).setText(lic.banned ? fmtTime(lic.banLeft) : '');
    }
    // ticket popup
    const t = this.ticket, tg = this.ticketG.clear();
    if (!t || time > t.until) { if (t) this.ticket = null; for (const o of this.ticketGroup) o.setVisible(false); return; }
    for (const o of this.ticketGroup) o.setVisible(true);
    const age = time - t.at, left = t.until - time;
    const a = Math.min(1, age / 160, left / 450), slide = (1 - Math.min(1, age / 160)) * -18;
    const w = 460, h = 78, x0 = GAME_W / 2 - w / 2, y0 = 112 + slide;
    panel(tg, x0, y0, w, h, { r: 10, accent: C.blue, stroke: C.blue, alpha: 0.94 });
    tg.fillStyle(C.blue, 1).fillRoundedRect(x0 + w - 74, y0 + 8, 64, 18, 5);
    this.ticketHead.setText(`FINE ${fmtKr(t.fine)}`).setPosition(x0 + 18, y0 + 6);
    this.ticketSub.setText(t.label).setPosition(x0 + 18, y0 + 44);
    this.ticketTag.setText(t.source === 'camera' ? 'CAMERA' : t.source === 'patrol' ? 'PATROL' : 'POLICE').setColor(S.ink).setPosition(x0 + w - 18, y0 + 11);
    this.ticketClip.setText(t.clips ? `+${t.clips} CLIP${t.clips > 1 ? 'S' : ''}` : '').setPosition(x0 + w - 14, y0 + 52);
    for (const o of this.ticketGroup) o.setAlpha(a);
  }

  _prompt(p, time) {
    const t = this.promptValue || '';
    const g = this.promptG.clear();
    this.promptText.setText(t);
    if (!t) return;
    const w = this.promptText.width + 36, h = 36;
    const y = p.vehicle ? GAME_H - 118 : GAME_H - 70;
    this.promptText.setPosition(GAME_W / 2, y);
    g.fillStyle(C.ink, 0.9).fillRoundedRect(GAME_W / 2 - w / 2, y - h / 2, w, h, 18);
    g.lineStyle(2, C.orange, 1).strokeRoundedRect(GAME_W / 2 - w / 2, y - h / 2, w, h, 18);
  }

  _contacts(g) {
    if (this.contactPts) return this.contactPts;
    const pts = [];
    try {
      const mk = g.systems?.missions?.contactMarkers?.();
      const list = Array.isArray(mk) && mk.length ? mk : getContacts(g.cityId || session.state.cityId).filter(contactEnabled);
      for (const c of list) {
        let x = c.x, y = c.y;
        if (x == null) { const lm = g.world?.landmark(c.at); if (lm) { x = lm.lx ?? lm.x; y = lm.ly ?? lm.y; } }
        if (x != null) pts.push({ x, y, name: c.name, legal: c.legal });
      }
    } catch (e) { /* ignore */ }
    this.contactPts = pts;
    return pts;
  }

  _minimap(g, p, sys, time) {
    const mm = g.minimap;
    if (!mm || !this.mmImg) return;
    const S_ = MM, x0 = this.mmX, y0 = this.mmY;
    const cx = p.px * mm.scale, cy = p.py * mm.scale;
    const sx = Phaser.Math.Clamp(cx - S_ / 2, 0, Math.max(0, mm.width - S_)), sy = Phaser.Math.Clamp(cy - S_ / 2, 0, Math.max(0, mm.height - S_));
    this.mmImg.setCrop(sx, sy, S_, S_).setPosition(x0 - sx, y0 - sy);
    const d = this.mmDots.clear();
    const px = (wx) => x0 + wx * mm.scale - sx, py = (wy) => y0 + wy * mm.scale - sy;
    const inside = (x, y, m = 4) => x >= x0 + m && x <= x0 + S_ - m && y >= y0 + m && y <= y0 + S_ - m;
    // contacts
    for (const c of this._contacts(g)) {
      const x = px(c.x), y = py(c.y);
      if (!inside(x, y, 2)) continue;
      d.fillStyle(c.legal === false ? C.red : C.gold, 1).fillCircle(x, y, 3.5).lineStyle(1.5, C.ink, 1).strokeCircle(x, y, 3.5);
    }
    // home (basement room): small house icon
    const hm = g.world?.home;
    if (hm) {
      const x = px(hm.x), y = py(hm.y);
      if (inside(x, y, 6)) {
        d.fillStyle(C.green, 1).fillTriangle(x - 6, y - 0.5, x + 6, y - 0.5, x, y - 6.5).fillRect(x - 4.5, y - 0.5, 9, 6.5);
        d.fillStyle(C.ink, 1).fillRect(x - 1.2, y + 2, 2.4, 4).lineStyle(1.5, C.ink, 1).strokeRect(x - 4.5, y - 0.5, 9, 6.5);
      }
    }
    // shops and dealers (economy POIs): small squares, blue bicycle, gold rental, orange dealer
    if (this._pois === undefined || time > (this._poiAt || 0)) { this._poiAt = time + 5000; try { this._pois = sys.economy?.getMapPOIs?.() || []; } catch (e) { this._pois = []; } }
    for (const o of this._pois) {
      if (o.kind === 'home') continue;
      const x = px(o.x), y = py(o.y);
      if (!inside(x, y, 3)) continue;
      const col = o.kind === 'bicycle' ? C.blue : o.kind === 'dealer' ? C.orange : C.gold;
      d.fillStyle(col, 1).fillRect(x - 3, y - 3, 6, 6).lineStyle(1.2, C.ink, 1).strokeRect(x - 3, y - 3, 6, 6);
    }
    // police
    const { units } = this._policeInfo(sys.police, p);
    const blink = Math.floor(time / 200) % 2;
    for (const u of units) {
      const x = px(u.x), y = py(u.y);
      if (!inside(x, y, 2)) continue;
      d.fillStyle(blink ? C.red : C.blue, 1).fillCircle(x, y, 3.5).lineStyle(1.5, C.paper, 1).strokeCircle(x, y, 3.5);
    }
    // target
    const tp = sys.missions?.targetPoint?.();
    if (tp) {
      let x = px(tp.x), y = py(tp.y);
      const pulse = 5 + 1.5 * Math.sin(time / 220);
      if (inside(x, y, 8)) {
        d.lineStyle(2, C.orange, 1).strokeCircle(x, y, pulse + 3);
        d.fillStyle(C.orange, 1).fillCircle(x, y, 5).lineStyle(2, C.ink, 1).strokeCircle(x, y, 5);
      } else {
        const ox = x0 + S_ / 2, oy = y0 + S_ / 2, ang = Math.atan2(y - oy, x - ox);
        x = Phaser.Math.Clamp(x, x0 + 10, x0 + S_ - 10); y = Phaser.Math.Clamp(y, y0 + 10, y0 + S_ - 10);
        this._tri(d, x, y, ang, 9, C.orange);
      }
    }
    // player: heading arrow
    const rot = p.vehicle ? (p.vehicle.angle ?? 0) : (p.sprite?.rotation ?? p.angle ?? 0);
    this._tri(d, px(p.px), py(p.py), rot, 7, C.paper, true);
  }

  _tri(d, x, y, a, r, col, outline) {
    const pt = (aa, rr) => ({ x: x + Math.cos(aa) * rr, y: y + Math.sin(aa) * rr });
    const pts = [pt(a, r), pt(a + 2.5, r * 0.8), pt(a + Math.PI, r * 0.3), pt(a - 2.5, r * 0.8)];
    d.fillStyle(col, 1).fillPoints(pts, true);
    d.lineStyle(2, outline ? C.orange : C.ink, 1).strokePoints(pts, true);
  }

  _waypoint(g, sys, p, time) {
    const gfx = this.wpG.clear();
    const tp = sys.missions?.targetPoint?.();
    this.wpText.setVisible(false);
    if (!tp || p.dead) return;
    const cam = g.cameras.main, wv = cam.worldView;
    const sx = (tp.x - wv.x) * cam.zoom, sy = (tp.y - wv.y) * cam.zoom;
    const m = 54;
    if (sx > m && sx < GAME_W - m && sy > m && sy < GAME_H - m) return; // on screen: the world marker does the job
    const cx = GAME_W / 2, cy = GAME_H / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    // intersect ray with the inset rectangle
    const hw = GAME_W / 2 - m - 20, hh = GAME_H / 2 - m - 20;
    const kmax = Math.min(Math.abs(hw / Math.cos(ang || 1e-6)), Math.abs(hh / Math.sin(ang || 1e-6)));
    // keep the arrow clear of the HUD panels: pull it inwards along the ray until it is outside them
    const zones = [[420, 16, 530, 84], [0, 0, 310, 160], [GAME_W - 340, 0, 340, 250], [GAME_W - 260, GAME_H - 260, 260, 260], [GAME_W / 2 - 170, GAME_H - 150, 340, 150], [0, GAME_H - 320, 400, 320]];
    let k = kmax, x = 0, y = 0;
    for (; k > kmax * 0.35; k -= 8) {
      x = cx + Math.cos(ang) * k; y = cy + Math.sin(ang) * k;
      if (!zones.some(([zx, zy, zw, zh]) => x > zx - 24 && x < zx + zw + 24 && y > zy - 24 && y < zy + zh + 24)) break;
    }
    const sc = 1 + 0.08 * Math.sin(time / 200);
    const r = 22 * sc;
    const pt = (a, rr) => ({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    const pts = [pt(ang, r), pt(ang + 2.4, r * 0.95), pt(ang + Math.PI, r * 0.35), pt(ang - 2.4, r * 0.95)];
    gfx.fillStyle(C.ink, 0.35).fillCircle(x, y, r + 6);
    gfx.fillStyle(C.orange, 1).fillPoints(pts, true).lineStyle(3, C.ink, 1).strokePoints(pts, true);
    const d = Math.hypot(tp.x - p.px, tp.y - p.py) / PX;
    this.wpText.setText(d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`).setVisible(true)
      .setPosition(x - Math.cos(ang) * 38, y - Math.sin(ang) * 38);
  }
}
