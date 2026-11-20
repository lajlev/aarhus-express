import assert from 'node:assert/strict';
import { WalkingVisual } from '../src/entities/WalkingVisual.js';

function shape() {
  return {
    x: 0, y: 0, rotation: 0, depth: 9,
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setRotation(a) { this.rotation = a; return this; },
    setDepth(d) { this.depth = d; return this; },
    setVisible(v) { this.visible = v; return this; },
    destroy() { this.destroyed = true; },
  };
}
const scene = { add: { ellipse: shape, rectangle: shape } };
const sprite = shape();
const v = new WalkingVisual(scene, sprite);
assert.equal(v.shadow.visible, false);
v.update(1, 0, Math.PI / 2, 1 / 60);
assert.ok(v.phase > 0);
assert.ok(v.angle > 0 && v.angle < Math.PI / 2);
assert.equal(v.shadow.visible, true);
const phase = v.phase;
for (let i = 0; i < 120; i++) v.update(1, 0, Math.PI / 2, 1 / 60);
assert.equal(v.phase, phase, 'blocked or idle feet must not keep stepping');
assert.ok(v.weight < 0.0001);
v.update(1000, 1000, 0, 1 / 60);
assert.equal(v.phase, phase, 'teleports must not advance stride');
v.reset(0, 0, Math.PI - 0.01);
v.update(0, 0, -Math.PI + 0.01, 1 / 60, false);
assert.ok(Math.abs(v.angle - Math.PI) < 0.02, 'turn across wrap takes shortest path');
v.setVisible(false);
assert.ok(v.feet.every(f => !f.visible));
v.destroy();
assert.ok(v.shadow.destroyed && v.feet.every(f => f.destroyed));
// Cadence is based on distance, not frame rate.
const a = new WalkingVisual(scene, shape()), b = new WalkingVisual(scene, shape());
for (let i = 1; i <= 60; i++) a.update(i / 6, 0, 0, 1 / 60);
for (let i = 1; i <= 30; i++) b.update(i / 3, 0, 0, 1 / 30);
assert.ok(Math.abs(a.phase - b.phase) < 1e-10);
console.log('Walking visual checks passed');
