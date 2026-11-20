import Phaser from 'phaser';
import { CHARACTERS } from '../data/characters.js';
import { getCity } from '../data/cities.js';
import { session, loadSave, deleteSave } from '../core/state.js';
import { optionTags } from '../core/options.js';
import { FONT, GAME_W, GAME_H } from '../config.js';

const PORTRAIT = { freja: 'barista', kasper: 'superfan', noor: 'art_student', henning: 'dock_worker', ingrid: 'tram_driver' };
const SKILL_NAMES = { driving: 'Driving', stamina: 'Stamina', charm: 'Charm', streetSmarts: 'Street smarts', navigation: 'Navigation' };

export class CharacterSelectScene extends Phaser.Scene {
  constructor() { super('CharacterSelect'); }

  init(data) { this.cityId = data.cityId || 'aarhus'; }

  create() {
    const city = getCity(this.cityId);
    this.cameras.main.setBackgroundColor('#121722');
    if (this.textures.exists('art:keyart:main')) {
      this.add.image(GAME_W / 2, GAME_H / 2, 'art:keyart:main').setDisplaySize(GAME_W, GAME_H);
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0e16, 0.82);
    }
    this.add.text(GAME_W / 2, 50, `${city.name}: who is riding today?`, { fontFamily: FONT, fontSize: '34px', color: '#f2b134', fontStyle: 'bold' }).setOrigin(0.5);
    this.index = 0;
    const cw = 222, gap = 18, total = CHARACTERS.length * cw + (CHARACTERS.length - 1) * gap;
    this.cards = CHARACTERS.map((ch, i) => {
      const x = GAME_W / 2 - total / 2 + cw / 2 + i * (cw + gap), y = 330;
      const box = this.add.rectangle(x, y, cw, 400, 0x1c2433).setStrokeStyle(3, 0x2c3648).setInteractive({ useHandCursor: true });
      this.add.circle(x, y - 130, 62, 0x2a3446);
      const pk = `art:portraits:${PORTRAIT[ch.id]}`;
      if (this.textures.exists(pk)) {
        const mg = this.make.graphics({ x: 0, y: 0 }, false).fillCircle(x, y - 130, 58);
        this.add.image(x, y - 130, pk).setDisplaySize(116, 116).setMask(mg.createGeometryMask());
        this.add.circle(x, y - 130, 59).setStrokeStyle(3, 0x2c3648);
      } else {
        this.add.image(x, y - 130, `char-${ch.id}`).setScale(4.2).setRotation(-Math.PI / 2);
      }
      this.add.text(x, y - 52, ch.name, { fontFamily: FONT, fontSize: '19px', color: '#ffffff', fontStyle: 'bold', align: 'center', wordWrap: { width: cw - 20 } }).setOrigin(0.5, 0);
      this.add.text(x, y - 4, ch.title, { fontFamily: FONT, fontSize: '15px', color: '#f2b134', align: 'center', wordWrap: { width: cw - 20 } }).setOrigin(0.5, 0);
      this.add.text(x, y + 30, ch.bio, { fontFamily: FONT, fontSize: '13px', color: '#c9d1dc', align: 'center', wordWrap: { width: cw - 26 } }).setOrigin(0.5, 0);
      const bonus = Object.entries(ch.bonus).map(([k, v]) => `+${v} ${SKILL_NAMES[k] || k}`).join(', ');
      this.add.text(x, y + 150, `Bonus: ${bonus}\nStart: kr ${ch.startMoney}`, { fontFamily: FONT, fontSize: '14px', color: '#8fd18a', align: 'center' }).setOrigin(0.5, 0);
      const saveText = this.add.text(x, y + 215, '', { fontFamily: FONT, fontSize: '13px', color: '#9aa3b2', align: 'center' }).setOrigin(0.5);
      box.on('pointerover', () => { this.index = i; this._refresh(); });
      box.on('pointerdown', () => { this.index = i; this._choose(); });
      const tagText = this.add.text(x, y + 238, '', { fontFamily: FONT, fontSize: '12px', color: '#f2b134', align: 'center', wordWrap: { width: cw - 20 } }).setOrigin(0.5, 0);
      return { box, ch, saveText, tagText };
    });
    this.add.text(GAME_W / 2, GAME_H - 62, 'Left / Right to choose  ·  Enter to play  ·  N to start over (wipes that save)  ·  Esc back', { fontFamily: FONT, fontSize: '17px', color: '#7d8799' }).setOrigin(0.5);
    const kb = this.input.keyboard;
    kb.on('keydown-LEFT', () => this._move(-1));
    kb.on('keydown-RIGHT', () => this._move(1));
    kb.on('keydown-A', () => this._move(-1));
    kb.on('keydown-D', () => this._move(1));
    kb.on('keydown-ENTER', () => this._choose());
    kb.on('keydown-SPACE', () => this._choose());
    kb.on('keydown-N', () => { deleteSave(this.cityId, CHARACTERS[this.index].id); this._refresh(); });
    kb.on('keydown-ESC', () => this.scene.start('CitySelect'));
    this._refresh();
  }

  _move(d) { this.index = (this.index + d + CHARACTERS.length) % CHARACTERS.length; this._refresh(); }

  _refresh() {
    this.cards.forEach((c, i) => {
      c.box.setStrokeStyle(3, i === this.index ? 0xf2b134 : 0x2c3648).setFillStyle(i === this.index ? 0x243049 : 0x1c2433);
      const s = loadSave(this.cityId, c.ch.id);
      c.saveText.setText(s ? `Continue: kr ${s.money} · LQ ${s.lq}` : 'New game');
      c.tagText.setText(s ? optionTags(s).join(' · ') : '').setColor(s?.optionsLegacy ? '#ff9a5a' : '#f2b134');
    });
  }

  _choose() {
    const ch = CHARACTERS[this.index];
    const save = loadSave(this.cityId, ch.id);
    if (!save) { // new game: pick the game options first
      this.scene.start('NewGame', { cityId: this.cityId, characterId: ch.id });
      return;
    }
    session.state = save;
    this.scene.start('Game', { cityId: this.cityId });
  }
}
