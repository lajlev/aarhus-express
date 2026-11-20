// NewGameScene: shown after character select when starting a NEW game (not when continuing a save).
// A toggles-only screen for the opt-in crime options (core/options.js). All options are OFF by default:
// the default game is a realistic courier life with no crime. The choice is stored in state.options and is
// fixed for the life of the save.
// Keys: Up/Down move, Space or Enter toggle (Enter on "Start" begins), Esc goes back. Mouse works too.
import Phaser from 'phaser';
import { CHARACTERS } from '../data/characters.js';
import { getCity } from '../data/cities.js';
import { session, createInitialState } from '../core/state.js';
import { OPTION_INFO, noOptions, isRealistic } from '../core/options.js';
import { C, S, txt, panel, ensureFonts } from '../ui/theme.js';
import { GAME_W, GAME_H } from '../config.js';

const ROW_W = 820, ROW_H = 92, ROW_GAP = 14, TOP = 190;

export class NewGameScene extends Phaser.Scene {
  constructor() { super('NewGame'); }

  init(data) {
    this.cityId = data.cityId || 'aarhus';
    this.characterId = data.characterId || CHARACTERS[0].id;
  }

  create() {
    ensureFonts();
    const city = getCity(this.cityId);
    const ch = CHARACTERS.find((c) => c.id === this.characterId) || CHARACTERS[0];
    this.options = noOptions();
    this.index = 0; // 0..2 toggles, 3 = start
    this.cameras.main.setBackgroundColor('#121722');
    if (this.textures.exists('art:keyart:main')) {
      this.add.image(GAME_W / 2, GAME_H / 2, 'art:keyart:main').setDisplaySize(GAME_W, GAME_H);
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0e16, 0.86);
    }
    txt(this, GAME_W / 2, 52, 'NEW GAME', { head: true, size: 40, color: S.gold, ox: 0.5 });
    txt(this, GAME_W / 2, 104, `${ch.name} in ${city.name}`, { size: 20, color: S.paper, ox: 0.5 });
    txt(this, GAME_W / 2, 136, 'Choose how the game is played. This is fixed for this save.', { size: 15, color: S.muted, ox: 0.5 });

    this.rows = OPTION_INFO.map((o, i) => {
      const x = GAME_W / 2 - ROW_W / 2, y = TOP + i * (ROW_H + ROW_GAP);
      const g = this.add.graphics();
      const hit = this.add.rectangle(x + ROW_W / 2, y + ROW_H / 2, ROW_W, ROW_H, 0xffffff, 0).setInteractive({ useHandCursor: true });
      txt(this, x + 28, y + 14, o.label, { head: true, size: 24 });
      txt(this, x + 28, y + 48, o.desc, { size: 14, color: S.muted, wrap: ROW_W - 180 });
      const state = txt(this, x + ROW_W - 28, y + ROW_H / 2, 'OFF', { head: true, size: 22, ox: 1, oy: 0.5 });
      hit.on('pointerover', () => { this.index = i; this._refresh(); });
      hit.on('pointerdown', () => { this.index = i; this._toggle(i); });
      return { g, x, y, state, o };
    });
    // Start button
    const by = TOP + 3 * (ROW_H + ROW_GAP);
    this.startBox = { x: GAME_W / 2 - ROW_W / 2, y: by, w: ROW_W, h: 62 };
    this.startG = this.add.graphics();
    this.startLabel = txt(this, GAME_W / 2, by + 31, 'START', { head: true, size: 28, ox: 0.5, oy: 0.5 });
    const hit = this.add.rectangle(GAME_W / 2, by + 31, ROW_W, 62, 0xffffff, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => { this.index = 3; this._refresh(); });
    hit.on('pointerdown', () => this._start());

    this.hint = txt(this, GAME_W / 2, by + 90, '', { head: true, size: 22, ox: 0.5 });
    this.sub = txt(this, GAME_W / 2, by + 122, '', { size: 15, color: S.muted, ox: 0.5, align: 'center', wrap: 900 });
    txt(this, GAME_W / 2, GAME_H - 34, 'Up / Down to choose  ·  Space or Enter to toggle  ·  Enter on Start to play  ·  Esc back', { size: 15, color: S.muted, ox: 0.5 });

    const kb = this.input.keyboard;
    kb.on('keydown-UP', () => this._move(-1));
    kb.on('keydown-DOWN', () => this._move(1));
    kb.on('keydown-W', () => this._move(-1));
    kb.on('keydown-S', () => this._move(1));
    kb.on('keydown-SPACE', () => this._activate(false));
    kb.on('keydown-ENTER', () => this._activate(true));
    kb.on('keydown-ESC', () => this.scene.start('CharacterSelect', { cityId: this.cityId }));
    this._refresh();
  }

  _move(d) { this.index = (this.index + d + 4) % 4; this._refresh(); }

  _activate(enter) {
    if (this.index < 3) this._toggle(this.index);
    else if (enter) this._start();
  }

  _toggle(i) {
    const id = OPTION_INFO[i].id;
    this.options[id] = !this.options[id];
    this._refresh();
  }

  _refresh() {
    this.rows.forEach((r, i) => {
      const on = this.options[r.o.id], sel = this.index === i;
      r.g.clear();
      panel(r.g, r.x, r.y, ROW_W, ROW_H, { fill: sel ? C.ink3 : C.ink2, alpha: 0.95, stroke: sel ? C.orange : C.ink3, accent: on ? C.red : C.ink3 });
      // switch
      const sx = r.x + ROW_W - 110, sy = r.y + ROW_H / 2;
      r.g.fillStyle(on ? C.red : C.ink, 1).fillRoundedRect(sx - 62, sy - 14, 44, 28, 14);
      r.g.lineStyle(2, on ? C.red : C.muted, 1).strokeRoundedRect(sx - 62, sy - 14, 44, 28, 14);
      r.g.fillStyle(C.paper, 1).fillCircle(on ? sx - 32 : sx - 48, sy, 10);
      r.state.setText(on ? 'ON' : 'OFF').setColor(on ? S.red : S.muted);
    });
    const sel = this.index === 3, b = this.startBox;
    this.startG.clear();
    panel(this.startG, b.x, b.y, b.w, b.h, { fill: sel ? C.orange : C.ink2, alpha: 1, stroke: sel ? C.paper : C.ink3, accent: false });
    this.startLabel.setColor(sel ? S.ink : S.paper);
    // crimeEnabled() reads the live session (not created yet), so decide from the local options
    const crime = this.options.theft || this.options.criminalMissions;
    if (isRealistic(this.options)) {
      this.hint.setText('Realistic courier: no crime').setColor(S.green);
      this.sub.setText('You rent a cheap basement room and own a city bike. Earn money from honest jobs, then rent or buy better vehicles. Police only enforce traffic rules.');
    } else if (crime) {
      this.hint.setText('Crime is on: police heat and pursuit are active').setColor(S.red);
      this.sub.setText('Heat 1-5, chases, roadblocks and getting busted come with theft or criminal missions.');
    } else {
      this.hint.setText('Mayhem only: no police pursuit').setColor(S.gold);
      this.sub.setText('Pedestrians and cars are fair game, but there is no theft and no criminal work. Police still enforce traffic rules.');
    }
  }

  _start() {
    session.state = createInitialState(this.cityId, this.characterId, { ...this.options });
    this.scene.start('Game', { cityId: this.cityId });
  }
}
