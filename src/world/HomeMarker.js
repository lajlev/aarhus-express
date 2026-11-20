// World marker for the player's home (basement room door): green door pad, small house glyph and a label.
// Static graphics drawn once, so it costs nothing per frame. Owner: foundation (HOME specialist may restyle).
import { DEPTH, FONT, PX } from '../config.js';

export class HomeMarker {
  constructor(scene, home) {
    this.g = scene.add.graphics().setDepth(DEPTH.marker + 1);
    const { x, y } = home;
    const g = this.g;
    g.fillStyle(0x4cc38a, 0.22).fillCircle(x, y, 2.4 * PX);
    g.lineStyle(3, 0x4cc38a, 0.9).strokeCircle(x, y, 2.4 * PX);
    // house glyph
    g.fillStyle(0x4cc38a, 1).fillTriangle(x - 11, y - 1, x + 11, y - 1, x, y - 13);
    g.fillRect(x - 8, y - 1, 16, 12);
    g.fillStyle(0x16181d, 1).fillRect(x - 2.5, y + 3, 5, 8);
    g.lineStyle(2, 0x16181d, 1).strokeRect(x - 8, y - 1, 16, 12);
    this.label = scene.add.text(x, y - 2.4 * PX - 4, 'HOME', {
      fontFamily: FONT, fontSize: '14px', color: '#e8fff3', stroke: '#16181d', strokeThickness: 4, fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(DEPTH.label).setScale(0.8);
  }

  destroy() {
    this.g.destroy();
    this.label.destroy();
  }
}
