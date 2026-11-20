// Shared task icons (HUD, minimap, full map, job app, world pins). Drawn with Phaser Graphics so they are crisp at any size.
// One shape + colour per task type: courier = parcel square, gig = round badge with "!", taxi = rounded diamond,
// bus = wide rounded bar, event = four-point star, challenge = flag, mission = ring.
import { TASK_TYPES } from '../data/tasks.js';

const INK = 0x16181d;
const PAPER = 0xf3eee4;

export function taskColor(type) { return TASK_TYPES[type]?.color ?? 0xffffff; }

/** Draw an icon of `type` centred at (x, y) with radius r. */
export function drawTaskIcon(g, type, x, y, r, opts = {}) {
  const col = opts.color ?? taskColor(type);
  const a = opts.alpha ?? 1;
  const lw = Math.max(1.2, r * 0.22);
  g.lineStyle(lw, INK, a);
  g.fillStyle(col, a);
  switch (type) {
    case 'courier': {
      g.fillRect(x - r, y - r * 0.85, r * 2, r * 1.7).strokeRect(x - r, y - r * 0.85, r * 2, r * 1.7);
      g.lineStyle(Math.max(1, r * 0.2), PAPER, a).lineBetween(x, y - r * 0.85, x, y + r * 0.85).lineBetween(x - r, y, x + r, y);
      break;
    }
    case 'taxi': {
      const pts = [{ x, y: y - r * 1.15 }, { x: x + r * 1.1, y }, { x, y: y + r * 1.15 }, { x: x - r * 1.1, y }];
      g.fillPoints(pts, true).strokePoints(pts, true);
      g.fillStyle(INK, a).fillRect(x - r * 0.4, y - r * 0.18, r * 0.8, r * 0.36);
      break;
    }
    case 'bus': {
      g.fillRoundedRect(x - r * 1.2, y - r * 0.7, r * 2.4, r * 1.4, r * 0.35).strokeRoundedRect(x - r * 1.2, y - r * 0.7, r * 2.4, r * 1.4, r * 0.35);
      g.fillStyle(INK, a).fillRect(x - r * 0.85, y - r * 0.35, r * 1.7, r * 0.4);
      break;
    }
    case 'event': {
      const pts = [];
      for (let i = 0; i < 8; i++) { const ang = (Math.PI / 4) * i - Math.PI / 2, rr = i % 2 ? r * 0.5 : r * 1.25; pts.push({ x: x + Math.cos(ang) * rr, y: y + Math.sin(ang) * rr }); }
      g.fillPoints(pts, true).strokePoints(pts, true);
      break;
    }
    case 'challenge': {
      g.lineStyle(Math.max(1.5, r * 0.25), INK, a).lineBetween(x - r * 0.6, y - r, x - r * 0.6, y + r);
      const pts = [{ x: x - r * 0.6, y: y - r }, { x: x + r, y: y - r * 0.4 }, { x: x - r * 0.6, y: y + r * 0.2 }];
      g.fillStyle(col, a).fillPoints(pts, true);
      g.lineStyle(lw, INK, a).strokePoints(pts, true);
      break;
    }
    case 'mission': {
      g.fillCircle(x, y, r).strokeCircle(x, y, r);
      g.fillStyle(INK, a).fillCircle(x, y, r * 0.4);
      break;
    }
    default: { // gig
      g.fillCircle(x, y, r).strokeCircle(x, y, r);
      g.fillStyle(INK, a).fillRect(x - r * 0.12, y - r * 0.62, r * 0.24, r * 0.78).fillCircle(x, y + r * 0.5, r * 0.15);
    }
  }
}
