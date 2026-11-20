// Police officers on foot: pooled sprites that chase the walking player.
import { DEPTH, PX } from '../../config.js';

const RADIUS = 5;

export class OfficerPool {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.active = [];
    this.free = [];
  }

  _make() {
    const body = this.scene.add.image(0, 0, 'dot').setTint(0x1d3f8f).setScale(0.8).setDepth(DEPTH.playerFoot);
    const cap = this.scene.add.image(0, 0, 'dot').setTint(0xf2f2f2).setScale(0.38).setDepth(DEPTH.playerFoot + 0.1);
    return { x: 0, y: 0, body, cap, path: null, pi: 0, repathT: 0, leaveT: 0, mode: 'chase', home: null };
  }

  spawn(x, y, home) {
    const o = this.free.pop() || this._make();
    o.x = x; o.y = y; o.path = null; o.pi = 0; o.repathT = 0; o.leaveT = 0; o.mode = 'chase'; o.home = home || null;
    o.body.setVisible(true); o.cap.setVisible(true);
    this.active.push(o);
    return o;
  }

  release(o) {
    const i = this.active.indexOf(o);
    if (i >= 0) this.active.splice(i, 1);
    o.body.setVisible(false); o.cap.setVisible(false);
    this.free.push(o);
  }

  clear() { for (let i = this.active.length - 1; i >= 0; i--) this.release(this.active[i]); }

  /** speed in px/s. Chases (tx, ty) unless mode === 'leave'. */
  update(dt, tx, ty, speed, allowPath) {
    const w = this.world, g = w.walk;
    for (const o of this.active) {
      let gx = tx, gy = ty;
      if (o.mode === 'leave') { o.leaveT += dt; if (o.home && !o.home.v.destroyed) { gx = o.home.v.x; gy = o.home.v.y; } }
      else if (!w.lineOfSight(o.x, o.y, tx, ty, 16)) {
        o.repathT -= dt;
        if (g && allowPath && (o.repathT <= 0 || !o.path)) {
          o.repathT = 1.4 + Math.random() * 0.4;
          const a = g.nearest(o.x, o.y, 400), b = g.nearest(tx, ty, 400);
          o.path = a >= 0 && b >= 0 ? g.path(a, b, 1500) : null;
          o.pi = 0;
        }
        if (o.path) {
          while (o.pi < o.path.length - 1 && Math.hypot(g.x[o.path[o.pi]] - o.x, g.y[o.path[o.pi]] - o.y) < 3 * PX) o.pi++;
          const n = o.path[Math.min(o.pi, o.path.length - 1)];
          gx = g.x[n]; gy = g.y[n];
        }
      } else o.path = null;
      const dx = gx - o.x, dy = gy - o.y, d = Math.hypot(dx, dy);
      if (d > 4) {
        const s = Math.min(speed * dt, d);
        o.x += (dx / d) * s; o.y += (dy / d) * s;
        const r = w.pushOut(o.x, o.y, RADIUS);
        if (r.hit) { o.x = r.x; o.y = r.y; }
        o.body.setRotation(Math.atan2(dy, dx));
      }
      o.body.setPosition(o.x, o.y);
      o.cap.setPosition(o.x, o.y);
    }
  }

  destroy() {
    for (const o of this.active.concat(this.free)) { o.body.destroy(); o.cap.destroy(); }
    this.active = []; this.free = [];
  }
}
