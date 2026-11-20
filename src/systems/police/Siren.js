// Pooled flashing light-bar glows for police cars (red/blue, additive).
import Phaser from 'phaser';
import { DEPTH } from '../../config.js';

export class SirenPool {
  constructor(scene) {
    this.scene = scene;
    this.free = [];
    this.all = [];
  }

  _make() {
    const s = this.scene.add.image(0, 0, 'soft').setDepth(DEPTH.effects).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.all.push(s);
    return s;
  }

  acquire() {
    const s = this.free.pop() || this._make();
    return s.setVisible(true);
  }

  release(s) { if (s) { s.setVisible(false); this.free.push(s); } }

  /** Attach a pair of lights to a unit (unit.lights = [a, b]). */
  attach(unit) { if (!unit.lights) unit.lights = [this.acquire(), this.acquire()]; }

  detach(unit) {
    if (!unit.lights) return;
    unit.lights.forEach((s) => this.release(s));
    unit.lights = null;
  }

  /** Place and flash; `on` false hides them. */
  update(unit, time, on, inView) {
    if (!unit.lights) return;
    const [a, b] = unit.lights;
    if (!on || !inView) { a.setVisible(false); b.setVisible(false); return; }
    const v = unit.v;
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const side = v.wid * 0.28, fwd = v.len * 0.02;
    const phase = Math.floor(time / 140 + unit.v.id) % 2 === 0;
    a.setVisible(true).setPosition(v.x + c * fwd + s * side, v.y + s * fwd - c * side).setTint(0xff2a2a).setAlpha(phase ? 1 : 0.15).setScale(phase ? 1.1 : 0.6);
    b.setVisible(true).setPosition(v.x + c * fwd - s * side, v.y + s * fwd + c * side).setTint(0x2a5bff).setAlpha(phase ? 0.15 : 1).setScale(phase ? 0.6 : 1.1);
  }

  destroy() { this.all.forEach((s) => s.destroy()); this.all = []; this.free = []; }
}
