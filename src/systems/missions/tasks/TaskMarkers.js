// World pins for available tasks (gigs, courier offers, taxi stands, bus first stops) and glowing event areas.
// One Graphics object + a small pool of labels; everything outside the camera view is culled. OWNER: JOBS specialist.
import { DEPTH, FONT } from '../../../config.js';
import { drawTaskIcon, taskColor } from '../../../ui/taskIcons.js';

const LABELS = 8;

export class TaskMarkers {
  constructor(scene) {
    this.scene = scene;
    this.g = scene.add.graphics().setDepth(DEPTH.marker);
    this.labels = [];
    for (let i = 0; i < LABELS; i++) {
      this.labels.push(scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '14px', color: '#fff', stroke: '#000', strokeThickness: 4, align: 'center' }).setOrigin(0.5, 1).setDepth(DEPTH.label).setVisible(false).setScale(0.8));
    }
  }

  /** entries: board pins ({ type, x, y, label?, hot? }), events: board events, px/py: the player. */
  draw(entries, events, px, py, time) {
    const g = this.g.clear();
    const cam = this.scene.cameras.main.worldView;
    const pulse = 0.5 + 0.5 * Math.sin(time / 300);
    let li = 0;
    for (const ev of events) {
      if (ev.global) continue;
      if (ev.x + ev.r < cam.x || ev.x - ev.r > cam.right || ev.y + ev.r < cam.y || ev.y - ev.r > cam.bottom) continue;
      const col = ev.color;
      g.fillStyle(col, 0.08 + 0.05 * pulse).fillCircle(ev.x, ev.y, ev.r);
      g.lineStyle(6, col, 0.35 + 0.3 * pulse).strokeCircle(ev.x, ev.y, ev.r);
      g.lineStyle(3, col, 0.2).strokeCircle(ev.x, ev.y, ev.r * (0.55 + 0.1 * pulse));
      const t = this.labels[li++];
      if (t) t.setVisible(true).setText(ev.name.toUpperCase()).setPosition(ev.x, ev.y - ev.r * 0.35).setScale(1.2).setColor('#f0b8ff');
    }
    for (const e of entries) {
      if (e.x == null || e.x < cam.x - 60 || e.x > cam.right + 60 || e.y < cam.y - 60 || e.y > cam.bottom + 60) continue;
      const col = taskColor(e.type);
      const r = e.type === 'gig' ? 15 : 12;
      g.lineStyle(3, col, 0.35 + 0.35 * pulse).strokeCircle(e.x, e.y, r + 10 + 4 * pulse);
      g.fillStyle(col, 0.14).fillCircle(e.x, e.y, r + 10);
      drawTaskIcon(g, e.type, e.x, e.y, r);
      if (e.label && li < LABELS && Math.hypot(e.x - px, e.y - py) < 520) {
        const t = this.labels[li++];
        t.setVisible(true).setText(e.label).setPosition(e.x, e.y - r - 14).setScale(0.8).setColor('#ffffff');
      }
    }
    for (; li < LABELS; li++) this.labels[li].setVisible(false);
  }

  destroy() {
    this.g.destroy();
    this.labels.forEach((t) => t.destroy());
  }
}
