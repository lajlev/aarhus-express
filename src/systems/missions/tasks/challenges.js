// Quick challenges: optional mini-tasks offered now and then (pager + job app). OWNER: JOBS specialist.
// Each template returns a MissionSystem job of kind 'challenge' (fixed pay, persisted). Progress comes from the TaskBoard,
// which listens to JOB_COMPLETED / police:ticket and calls missions.progress() / failJob().
import { PX } from '../../../config.js';

let seq = 0;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const base = (o) => ({
  id: `ch${Date.now().toString(36)}${++seq}`, kind: 'challenge', task: 'challenge', legal: true, level: 1, state: 'offered', stageIndex: 0,
  timeLeft: null, timeLimit: 0, timerFrom: 0, timerTo: 0, metres: 0, cargo: { size: 0, fragile: false, name: 'Challenge' }, damage: 0, loaded: false,
  fixed: true, persist: true, event: null, ...o,
});

const REACH_IDS = ['dokk1', 'aros', 'radhus', 'domkirke', 'aarhush', 'salling', 'train', 'godsbanen', 'streetfood', 'bruuns'];

/** Ringgaden checkpoints (drive nodes on a street called *Ringgade*), computed once per world. */
function ringNodes(world) {
  if (world._ring) return world._ring;
  const g = world.drive, c = world.landmark('radhus') || { x: world.W / 2, y: world.H / 2 };
  const out = [];
  for (let i = 0; i < g.count; i += 3) {
    const s = world.streetAt(g.x[i], g.y[i], 20 * PX);
    if (s && /ringgade/i.test(s)) out.push({ x: g.x[i], y: g.y[i], a: Math.atan2(g.y[i] - c.y, g.x[i] - c.x) });
  }
  out.sort((p, q) => p.a - q.a);
  world._ring = out;
  return out;
}

export const CHALLENGE_TEMPLATES = [
  {
    id: 'reach', weight: 4,
    build(B) {
      const pl = { x: B.px, y: B.py };
      const c = REACH_IDS.map((id) => B.landmark(id)).filter((l) => l && dist(l, pl) / PX > 350 && dist(l, pl) / PX < 850);
      if (!c.length) return null;
      const lm = c[Math.floor(Math.random() * c.length)];
      const m = (dist(lm, pl) / PX) * 1.3;
      const limit = Math.max(60, Math.round((m / 6.4) / 5) * 5);
      return base({
        tpl: 'reach', title: `Get to ${lm.n} in ${limit} s`, short: `${lm.n} in ${limit} s`, blurb: `Race the clock: reach ${lm.n} within ${limit} seconds.`,
        stages: [{ action: 'visit', x: lm.x, y: lm.y, name: lm.n, radius: 100 }], timeLimit: limit, timerFrom: 0, timerTo: 1, reward: 60 + Math.round(m * 0.05), lq: 1, metres: Math.round(m),
      });
    },
  },
  {
    id: 'ring', weight: 2,
    build(B) {
      const pts = ringNodes(B.ctx.world);
      if (pts.length < 20) return null;
      const pl = { x: B.px, y: B.py };
      let si = 0, sd = Infinity;
      pts.forEach((p, i) => { const d = dist(p, pl); if (d < sd) { sd = d; si = i; } });
      if (sd / PX > 1400) return null;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const chain = [pts[si]];
      for (let k = 1; k < pts.length && chain.length < 5; k++) {
        const p = pts[(si + dir * k + pts.length * 4) % pts.length];
        if (dist(p, chain[chain.length - 1]) / PX >= 600) chain.push(p);
      }
      if (chain.length < 5) return null;
      let metres = 0;
      for (let i = 1; i < chain.length; i++) metres += (dist(chain[i - 1], chain[i]) / PX) * 1.25;
      const limit = Math.round(metres / 4.6 + 60);
      return base({
        tpl: 'ring', title: 'Ride the Ringgaden', short: 'Ride the Ringgaden', blurb: 'Ride the Ringgaden: pass all five checkpoints in order before the clock runs out.',
        stages: chain.map((p, i) => ({ action: 'visit', x: p.x, y: p.y, name: `Ringgaden ${i + 1}/5`, radius: 110 })),
        timeLimit: limit, timerFrom: 0, timerTo: 5, reward: 150, lq: 2, metres: Math.round(metres),
      });
    },
  },
  {
    id: 'clean', weight: 3,
    build() {
      return base({
        tpl: 'clean', title: 'No red lights for 10 minutes', short: 'No red lights, 10 min', blurb: 'Stay clean: no red-light fine for ten minutes.',
        stages: [{ action: 'hold', name: 'Stay clean' }], timeLimit: 600, timerFrom: 0, timerTo: 1, survive: true, watch: { fineType: 'redLight' }, reward: 100, lq: 2,
      });
    },
  },
  {
    id: 'five', weight: 3,
    build() {
      return base({
        tpl: 'five', title: '5 deliveries, no fines', short: '5 deliveries, no fines', blurb: 'Complete five orders in a row without getting a fine.',
        stages: [{ action: 'count', name: 'Deliveries', goal: 5, count: 0 }], watch: { event: 'delivery', anyFine: true }, reward: 140, lq: 2,
      });
    },
  },
  {
    id: 'fred', weight: 3,
    build() {
      return base({
        tpl: 'fred', title: 'Deliver 3 orders in Frederiksbjerg', short: '3 orders: Frederiksbjerg', blurb: 'Drop off three orders in Frederiksbjerg.',
        stages: [{ action: 'count', name: 'Drops in Frederiksbjerg', goal: 3, count: 0 }], watch: { event: 'delivery', district: 'Frederiksbjerg' }, reward: 120, lq: 1,
      });
    },
  },
];
