// On-world markers (pickup, dropoff, contact) + the direction arrow near the player.
// Uses textures 'marker-pickup' / 'marker-dropoff' / 'marker-contact' when they exist, else draws shapes.
import { DEPTH, FONT } from '../../config.js';

const COLORS = { pickup: 0x3aa0ff, dropoff: 0x35d07f, contact: 0xffc83a, target: 0xff5a4a };

export class MarkerLayer {
  constructor(scene) {
    this.scene = scene;
    this.g = scene.add.graphics().setDepth(DEPTH.marker + 1);
    this.labels = [];
    this.images = [];
    this.arrow = scene.add.image(0, 0, 'arrow').setDepth(DEPTH.label).setVisible(false).setScale(0.9);
    this._li = 0;
    this._ii = 0;
  }

  begin() {
    this.g.clear();
    this._li = 0;
    this._ii = 0;
  }

  /** m: { kind: 'pickup'|'dropoff'|'contact'|'target', x, y, r, label?, progress?, style?: 'phone'|'pager' } */
  draw(m, time) {
    const cam = this.scene.cameras.main.worldView;
    const R = m.r || 80;
    if (m.x < cam.x - 300 || m.x > cam.right + 300 || m.y < cam.y - 300 || m.y > cam.bottom + 300) return;
    const col = COLORS[m.kind] ?? 0xffffff;
    const pulse = 0.5 + 0.5 * Math.sin(time / 260);
    const key = `marker-${m.kind}`;
    const hasIcon = this.scene.textures.exists(key) && m.kind !== 'target';
    if (hasIcon) { // art textures are 64 px native (~8 m): display at ~40 px (5 m)
      let img = this.images[this._ii++];
      if (!img) { img = this.scene.add.image(0, 0, key).setDepth(DEPTH.marker + 2); this.images.push(img); }
      img.setVisible(true).setPosition(m.x, m.y).setScale(0.62 + 0.04 * pulse).setAlpha(m.dim ? 0.6 : 1);
    }
    const g = this.g;
    const dim = m.dim ? 0.55 : 1;
    if (m.kind === 'contact') {
      if (hasIcon) {
        g.lineStyle(3, col, 0.4 + 0.5 * pulse).strokeCircle(m.x, m.y, 32 + 6 * pulse);
      } else {
        if (m.style === 'phone') {
          g.fillStyle(0xc0392b, 1).fillRect(m.x - 7, m.y - 14, 14, 24);
          g.fillStyle(0xffffff, 0.9).fillRect(m.x - 5, m.y - 11, 10, 8);
        } else {
          g.fillStyle(0x222222, 1).fillRoundedRect(m.x - 10, m.y - 7, 20, 14, 3);
          g.fillStyle(0x6cf08a, 1).fillRect(m.x - 7, m.y - 4, 14, 5);
        }
        g.lineStyle(3, col, 0.4 + 0.5 * pulse).strokeCircle(m.x, m.y, 26 + 6 * pulse);
      }
    } else {
      g.fillStyle(col, (0.12 + 0.1 * pulse) * dim).fillCircle(m.x, m.y, R);
      g.lineStyle(m.dim ? 3 : 4, col, 0.85 * dim).strokeCircle(m.x, m.y, R * (0.9 + 0.1 * pulse));
      if (m.progress > 0) {
        g.lineStyle(8, 0xffffff, 0.95).beginPath().arc(m.x, m.y, R * 0.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.progress).strokePath();
      }
      if (!hasIcon) g.fillStyle(col, 1).fillCircle(m.x, m.y, 9);
    }
    if (m.label) {
      let t = this.labels[this._li++];
      if (!t) {
        t = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '14px', color: '#fff', stroke: '#000', strokeThickness: 4, align: 'center' }).setOrigin(0.5, 1).setDepth(DEPTH.label);
        this.labels.push(t);
      }
      t.setVisible(true).setText(m.label).setPosition(m.x, m.y - (m.kind === 'contact' ? 34 : R + 6)).setScale(0.8);
    }
  }

  end() {
    for (let i = this._li; i < this.labels.length; i++) this.labels[i].setVisible(false);
    for (let i = this._ii; i < this.images.length; i++) this.images[i].setVisible(false);
  }

  /** Arrow orbiting the player towards (tx,ty); pass null to hide. */
  pointArrow(px, py, tx, ty) {
    if (tx == null) { this.arrow.setVisible(false); return; }
    const d = Math.hypot(tx - px, ty - py);
    if (d < 260) { this.arrow.setVisible(false); return; }
    const a = Math.atan2(ty - py, tx - px);
    this.arrow.setVisible(true).setPosition(px + Math.cos(a) * 110, py + Math.sin(a) * 110).setRotation(a);
  }

  destroy() {
    this.g.destroy();
    this.labels.forEach((t) => t.destroy());
    this.images.forEach((t) => t.destroy());
    this.arrow.destroy();
  }
}
