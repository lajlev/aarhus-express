// Effects: smoke for damaged vehicles, fire while burning, explosions.
// Listens to VEHICLE_DESTROYED; call update() each frame with the vehicle list.
import { DEPTH, PX } from '../config.js';
import { listen, EV } from '../core/events.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const base = { emitting: false, blendMode: 'NORMAL' };
    this.smoke = scene.add.particles(0, 0, 'soft', { ...base, lifespan: 1400, speed: { min: 4, max: 18 }, scale: { start: 1.2, end: 3.2 }, alpha: { start: 0.7, end: 0 }, tint: 0x555555 }).setDepth(DEPTH.effects);
    this.fire = scene.add.particles(0, 0, 'soft', { ...base, lifespan: 600, speed: { min: 10, max: 40 }, scale: { start: 1.4, end: 0.2 }, alpha: { start: 1, end: 0 }, tint: [0xffd24a, 0xff8a1f, 0xe8421c], blendMode: 'ADD' }).setDepth(DEPTH.effects + 1);
    this.blast = scene.add.particles(0, 0, 'soft', { ...base, lifespan: 900, speed: { min: 60, max: 260 }, scale: { start: 2.5, end: 0.4 }, alpha: { start: 1, end: 0 }, tint: [0xfff1a8, 0xff9a2e, 0xd93a1a], blendMode: 'ADD' }).setDepth(DEPTH.effects + 2);
    this.splash = scene.add.particles(0, 0, 'dot', { ...base, lifespan: 700, speed: { min: 30, max: 120 }, scale: { start: 0.6, end: 0.1 }, alpha: { start: 0.9, end: 0 }, tint: 0xcfe8ff }).setDepth(DEPTH.effects);
    this.acc = 0;
    listen(scene, EV.VEHICLE_DESTROYED, ({ x, y, cause }) => {
      if (cause === 'sunk') { this.splash.emitParticleAt(x, y, 30); return; }
      this.blast.emitParticleAt(x, y, 40);
      this.smoke.emitParticleAt(x, y, 14);
      scene.cameras.main.shake(350, 0.012);
    });
  }

  update(dt, vehicles, view) {
    this.acc += dt;
    if (this.acc < 0.05) return;
    this.acc = 0;
    for (const v of vehicles) {
      if (v.x < view.x - 100 || v.x > view.right + 100 || v.y < view.y - 100 || v.y > view.bottom + 100) continue;
      if (v.state === 'burning') this.fire.emitParticleAt(v.x, v.y, 3);
      else if (v.state === 'broken' && Math.random() < 0.6) this.smoke.emitParticleAt(v.x + Math.cos(v.angle) * v.len * 0.35, v.y + Math.sin(v.angle) * v.len * 0.35, 1);
      else if (v.state === 'wreck' && Math.random() < 0.3) this.smoke.emitParticleAt(v.x, v.y, 1);
      else if (v.state === 'ok' && v.health < v.maxHealth * 0.35 && Math.random() < 0.5) {
        const c = Math.cos(v.angle), s = Math.sin(v.angle);
        this.smoke.emitParticleAt(v.x + c * v.len * 0.35, v.y + s * v.len * 0.35, 1);
      }
    }
  }

  /** Generic explosion at a point (missions/police may use it). */
  explosion(x, y) { this.blast.emitParticleAt(x, y, 40); }
}

export const EXPLOSION_RADIUS = 7 * PX;
