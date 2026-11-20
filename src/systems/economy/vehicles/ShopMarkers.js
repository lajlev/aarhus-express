// World markers for vehicle shops and dealers: a coloured pad with a small glyph (bike / key / car), drawn once into one
// Graphics (cheap). Dealers also get a text label. OWNER: HOME & VEHICLES specialist.
import { DEPTH, FONT, PX } from '../../../config.js';

const COLORS = { blue: 0x4da3ff, gold: 0xf2b134, orange: 0xff6a2b };

export class ShopMarkers {
  constructor(scene, shops) {
    this.g = scene.add.graphics().setDepth(DEPTH.marker);
    this.labels = [];
    const g = this.g;
    for (const s of shops) {
      const c = COLORS[s.color] || COLORS.blue, r = 1.9 * PX;
      g.fillStyle(c, 0.2).fillCircle(s.x, s.y, r);
      g.lineStyle(2, c, 0.85).strokeCircle(s.x, s.y, r);
      g.fillStyle(0x16181d, 1).fillCircle(s.x, s.y, 0.95 * PX);
      g.lineStyle(1.5, c, 1).strokeCircle(s.x, s.y, 0.95 * PX);
      g.fillStyle(c, 1);
      if (s.kind === 'bicycle' || s.kind === 'bikeRental') { // two wheels
        g.fillCircle(s.x - 0.42 * PX, s.y + 0.15 * PX, 0.28 * PX).fillCircle(s.x + 0.42 * PX, s.y + 0.15 * PX, 0.28 * PX);
        g.fillRect(s.x - 0.1 * PX, s.y - 0.4 * PX, 0.2 * PX, 0.5 * PX);
      } else { // car body
        g.fillRoundedRect(s.x - 0.62 * PX, s.y - 0.22 * PX, 1.24 * PX, 0.5 * PX, 3);
        g.fillRoundedRect(s.x - 0.3 * PX, s.y - 0.5 * PX, 0.6 * PX, 0.35 * PX, 2);
      }
      if (s.dealer) {
        this.labels.push(scene.add.text(s.x, s.y - r - 3, s.name.toUpperCase(), {
          fontFamily: FONT, fontSize: '12px', color: '#ffe9dd', stroke: '#16181d', strokeThickness: 4, fontStyle: 'bold',
        }).setOrigin(0.5, 1).setDepth(DEPTH.label).setScale(0.8));
      }
    }
  }

  destroy() {
    this.g.destroy();
    this.labels.forEach((t) => t.destroy());
  }
}
