// Driving helpers for police cars: steer toward a point by writing vehicle.input.
import { angleDiff, clamp } from '../../core/math.js';
import { PX } from '../../config.js';

/** Steer vehicle `v` toward (tx, ty). `cap` limits throttle (0..1). Returns the heading error. */
export function steerToward(v, tx, ty, cap = 1) {
  const diff = angleDiff(v.angle, Math.atan2(ty - v.y, tx - v.x));
  const ad = Math.abs(diff);
  const inp = v.input;
  inp.steer = clamp(diff * 2.2, -1, 1);
  const spd = v.speedMps;
  let thr = cap;
  if (ad > 1.1 && spd > 9) thr = -0.4; // too fast for the corner: brake
  else if (ad > 0.7) thr = Math.min(cap, 0.45);
  inp.throttle = thr;
  inp.handbrake = ad > 1.3 && spd > 12;
  return diff;
}

/** Follow a node path; returns the current waypoint target or null when finished. */
export function pathTarget(unit, g) {
  const p = unit.path;
  if (!p || unit.pi >= p.length) return null;
  const v = unit.v;
  while (unit.pi < p.length - 1) {
    const n = p[unit.pi];
    if (Math.hypot(g.x[n] - v.x, g.y[n] - v.y) < 5 * PX) unit.pi++;
    else break;
  }
  const n = p[unit.pi];
  return { x: g.x[n], y: g.y[n] };
}
