// Pager feed: phone-style message cards stacked bottom-left, with slide-in and ping animation.
// OWNER: UI specialist
import { C, S, txt, icon } from './theme.js';

const KIND_COLOR = { info: C.muted, job: C.orange, warn: C.gold, crime: C.red };
const MAX_VISIBLE = 4;
const W = 360;

export class Pager {
  constructor(scene, x, bottom) {
    this.scene = scene;
    this.x = x;
    this.bottom = bottom;
    this.items = []; // visible, newest last
    this.queue = [];
    this.nextAt = 0;
    this.lastText = '';
    this.lastTextAt = 0;
  }

  push({ text, from, kind = 'info' }) {
    if (!text) return;
    const now = this.scene.time.now;
    if (text === this.lastText && now - this.lastTextAt < 1500) return; // dedupe identical bursts
    this.lastText = text; this.lastTextAt = now;
    this.queue.push({ text: String(text), from, kind });
  }

  _spawn(m) {
    const sc = this.scene;
    const col = KIND_COLOR[m.kind] ?? C.muted;
    const c = sc.add.container(this.x - W - 20, this.bottom);
    const body = txt(sc, 50, m.from ? 24 : 11, m.text, { size: 15, wrap: W - 66 });
    const from = m.from ? txt(sc, 50, 8, m.from.toUpperCase(), { head: true, size: 13, color: S.orange }) : null;
    const h = Math.max(46, Math.ceil(body.height) + (m.from ? 36 : 22));
    const g = sc.add.graphics();
    g.fillStyle(C.ink, 0.92).fillRoundedRect(0, 0, W, h, 12);
    g.lineStyle(2, C.ink3, 1).strokeRoundedRect(0, 0, W, h, 12);
    g.fillStyle(col, 1).fillRoundedRect(0, 8, 4, h - 16, 2);
    g.fillStyle(C.ink3, 1).fillCircle(26, h / 2, 15);
    const ic = icon(sc, 'phone', 26, h / 2, 20);
    const ping = sc.add.circle(26, h / 2, 15, col, 0.7);
    c.add([g, ping, ic, body]);
    if (from) c.add(from);
    c.setAlpha(0);
    const it = { c, h, born: sc.time.now, life: 5200 + m.text.length * 40, y: this.bottom, ty: this.bottom, dying: false, kind: m.kind };
    sc.tweens.add({ targets: c, x: this.x, alpha: 1, duration: 320, ease: 'Back.easeOut' });
    sc.tweens.add({ targets: ping, scale: 2.4, alpha: 0, duration: 650, ease: 'Sine.easeOut' });
    this.items.push(it);
  }

  update(time) {
    const sc = this.scene;
    // spawn from queue
    if (this.queue.length && this.items.filter((i) => !i.dying).length < MAX_VISIBLE && time >= this.nextAt) {
      this._spawn(this.queue.shift());
      this.nextAt = time + 380;
    }
    // expire (faster when the queue is backing up)
    for (const it of this.items) {
      const life = this.queue.length ? it.life * 0.45 : it.life;
      if (!it.dying && time - it.born > life) {
        it.dying = true;
        sc.tweens.add({ targets: it.c, x: this.x - W - 20, alpha: 0, duration: 260, ease: 'Sine.easeIn', onComplete: () => it.c.destroy() });
      }
    }
    this.items = this.items.filter((i) => !(i.dying && !i.c.active));
    // stack newest at the bottom, older ones above
    let y = this.bottom;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      y -= it.h;
      it.ty = y;
      y -= 8;
      it.y += (it.ty - it.y) * 0.25;
      it.c.y = it.y;
    }
  }

  destroy() {
    for (const it of this.items) it.c.destroy();
    this.items = []; this.queue = [];
  }
}
