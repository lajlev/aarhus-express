import Phaser from 'phaser';
import { CITIES } from '../data/cities.js';
import { FONT, GAME_W, GAME_H, TITLE } from '../config.js';

const CREDIT_URL = 'https://lillefar.dk/side-quests/aarhus-express';

export class CitySelectScene extends Phaser.Scene {
  constructor() { super('CitySelect'); }

  create() {
    this.cameras.main.setBackgroundColor('#121722');
    this._backdrop();
    const [brand, sub] = TITLE.split(': ');
    this.add.text(GAME_W / 2, 110, brand.toUpperCase(), { fontFamily: FONT, fontSize: '28px', color: '#9aa3b2', letterSpacing: 8 }).setOrigin(0.5);
    this.add.text(GAME_W / 2, 165, sub, { fontFamily: FONT, fontSize: '64px', color: '#f2b134', fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(GAME_W / 2, 225, 'Choose your city', { fontFamily: FONT, fontSize: '22px', color: '#c9d1dc' }).setOrigin(0.5);

    this.index = Math.max(0, CITIES.findIndex((c) => c.available));
    const cw = 300, gap = 40, total = CITIES.length * cw + (CITIES.length - 1) * gap;
    this.cards = CITIES.map((city, i) => {
      const x = GAME_W / 2 - total / 2 + cw / 2 + i * (cw + gap), y = 400;
      const box = this.add.rectangle(x, y, cw, 220, 0x1c2433).setStrokeStyle(3, 0x2c3648).setInteractive({ useHandCursor: city.available });
      const name = this.add.text(x, y - 60, city.name, { fontFamily: FONT, fontSize: '40px', color: city.available ? '#ffffff' : '#5b6474', fontStyle: 'bold' }).setOrigin(0.5);
      this.add.text(x, y - 18, city.country, { fontFamily: FONT, fontSize: '16px', color: '#7d8799' }).setOrigin(0.5);
      this.add.text(x, y + 40, city.tagline, { fontFamily: FONT, fontSize: '16px', color: city.available ? '#c9d1dc' : '#5b6474', align: 'center', wordWrap: { width: cw - 40 } }).setOrigin(0.5);
      box.on('pointerover', () => { if (city.available) { this.index = i; this._refresh(); } });
      box.on('pointerdown', () => { if (city.available) this._choose(); });
      return { box, name, city };
    });
    this.add.text(GAME_W / 2, GAME_H - 60, 'Left / Right to choose  ·  Enter to start', { fontFamily: FONT, fontSize: '18px', color: '#7d8799' }).setOrigin(0.5);
    this.add.text(GAME_W - 12, GAME_H - 10, 'Map data © OpenStreetMap contributors', { fontFamily: FONT, fontSize: '12px', color: '#5b6474' }).setOrigin(1, 1);

    this._credit();

    const kb = this.input.keyboard;
    kb.on('keydown-LEFT', () => this._move(-1));
    kb.on('keydown-RIGHT', () => this._move(1));
    kb.on('keydown-A', () => this._move(-1));
    kb.on('keydown-D', () => this._move(1));
    kb.on('keydown-ENTER', () => this._choose());
    kb.on('keydown-SPACE', () => this._choose());
    this._refresh();
  }

  // Clickable credit, bottom-left (mouse only, no keyboard focus, so it never affects key navigation).
  _credit() {
    const base = '#7d8799', hover = '#f2b134';
    const t = this.add.text(12, GAME_H - 10, 'Made by lillefar.dk', { fontFamily: FONT, fontSize: '14px', color: base }).setOrigin(0, 1);
    t.setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor(hover).setStyle({ fontStyle: 'bold' }));
    t.on('pointerout', () => t.setColor(base).setStyle({ fontStyle: 'normal' }));
    t.on('pointerdown', () => {
      try { window.open(CREDIT_URL, '_blank', 'noopener'); } catch (e) { /* ignore */ }
    });
  }

  _backdrop() {
    if (this.textures.exists('art:keyart:main')) {
      this.add.image(GAME_W / 2, GAME_H / 2, 'art:keyart:main').setDisplaySize(GAME_W, GAME_H);
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0e16, 0.55);
      return;
    }
    // abstract street grid
    const g = this.add.graphics();
    g.lineStyle(10, 0x1a2130, 1);
    for (let i = -2; i < 14; i++) g.lineBetween(i * 120, 0, i * 120 + 260, GAME_H);
    for (let j = 0; j < 8; j++) g.lineBetween(0, j * 110, GAME_W, j * 110 - 140);
  }

  _move(d) {
    let i = this.index;
    for (let k = 0; k < CITIES.length; k++) {
      i = (i + d + CITIES.length) % CITIES.length;
      if (CITIES[i].available) break;
    }
    this.index = i;
    this._refresh();
  }

  _refresh() {
    this.cards.forEach((c, i) => c.box.setStrokeStyle(3, i === this.index ? 0xf2b134 : 0x2c3648).setFillStyle(i === this.index ? 0x243049 : 0x1c2433));
  }

  _choose() {
    const city = CITIES[this.index];
    if (!city?.available) return;
    this.scene.start('CharacterSelect', { cityId: city.id });
  }
}
