// Presentation only: distance-driven stride, planted shadow and eased heading.
// Never changes entity coordinates, collision shapes or movement speeds.
import { PX } from '../config.js';

export class WalkingVisual {
  constructor(scene, sprite) {
    this.sprite = sprite;
    this.shadow = scene.add.ellipse(0, 0, 1.05 * PX, 0.7 * PX, 0x101820, 0.18).setDepth(sprite.depth - 0.2);
    this.feet = [-1, 1].map(() => scene.add.rectangle(0, 0, 0.42 * PX, 0.23 * PX, 0x252b32).setDepth(sprite.depth - 0.1));
    this.reset(sprite.x, sprite.y, sprite.rotation);
    this.setVisible(false);
  }

  reset(x, y, angle) {
    this.x = x; this.y = y; this.angle = angle;
    this.phase = 0; this.weight = 0;
  }

  update(x, y, angle, dt, moving = true, running = false) {
    const distance = Math.hypot(x - this.x, y - this.y);
    this.x = x; this.y = y;
    // Ignore teleports and stop stepping when pushing against a wall.
    const walking = moving && distance > 0.001 && distance < 4 * PX;
    if (walking) this.phase = (this.phase + distance / ((running ? 2.1 : 1.4) * PX) * Math.PI * 2) % (Math.PI * 2);
    const blend = 1 - Math.exp(-16 * dt);
    this.weight += ((walking ? 1 : 0) - this.weight) * blend;
    const delta = Math.atan2(Math.sin(angle - this.angle), Math.cos(angle - this.angle));
    this.angle += delta * (1 - Math.exp(-14 * dt));
    const stride = Math.sin(this.phase) * this.weight;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const reach = (running ? 0.48 : 0.35) * PX;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const forward = stride * side * reach - 0.12 * PX;
      const lateral = side * 0.27 * PX;
      this.feet[i].setPosition(x + c * forward - s * lateral, y + s * forward + c * lateral).setRotation(this.angle);
    }
    const sway = stride * (running ? 0.035 : 0.025);
    const lift = Math.abs(Math.cos(this.phase)) * this.weight * (running ? 0.65 : 0.3);
    this.sprite.setPosition(x, y - lift).setRotation(this.angle + sway);
    this.shadow.setPosition(x + 1, y + 2);
    this.setVisible(true);
  }

  setVisible(visible) {
    this.shadow.setVisible(visible);
    for (const foot of this.feet) foot.setVisible(visible);
  }

  destroy() {
    this.shadow.destroy();
    for (const foot of this.feet) foot.destroy();
  }
}
