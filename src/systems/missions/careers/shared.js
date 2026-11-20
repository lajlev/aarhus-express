// Shared helpers for the three careers (courier, taxi, bus). OWNER: JOBS specialist.
import { PX } from '../../../config.js';
import { bus, EV, pager } from '../../../core/events.js';
import { CAREER_XP, CAREER_NAMES, careerLevel } from '../../../data/missions.js';
import { JOBS_EV } from '../events.js';

export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const DEFAULTS = () => ({
  courier: { xp: 0, rating: 4.0, scores: [], decisions: [], done: 0, failed: 0, declined: 0, earned: 0 },
  taxi: { signed: false, xp: 0, shifts: 0, fares: 0, earned: 0, best: 0 },
  bus: { signed: false, xp: 0, shifts: 0, stops: 0, earned: 0, punctual: 0 },
});

/** state.jobs = { courier, taxi, bus } (saved with the game). Fills missing fields of old saves. */
export function ensureJobsState(state) {
  const d = DEFAULTS();
  state.jobs = state.jobs || {};
  for (const k of Object.keys(d)) state.jobs[k] = { ...d[k], ...(state.jobs[k] || {}) };
  return state.jobs;
}

/** { level, xp, base, next, frac } for a career (next = null at max level). */
export function levelInfo(state, career) {
  const xp = state.jobs[career].xp;
  const level = careerLevel(xp);
  const base = CAREER_XP[level - 1];
  const next = level < CAREER_XP.length ? CAREER_XP[level] : null;
  return { level, xp, base, next, frac: next == null ? 1 : (xp - base) / (next - base) };
}

export function addXp(ctx, career, amount) {
  amount = Math.round(amount);
  if (amount <= 0) return;
  const st = ctx.state;
  const before = careerLevel(st.jobs[career].xp);
  st.jobs[career].xp += amount;
  const after = careerLevel(st.jobs[career].xp);
  if (after > before) {
    pager(`${CAREER_NAMES[career]} level ${after}: better pay and longer jobs unlocked`, 'job', 'Jobs');
    bus.emit(EV.BANNER, { text: `${CAREER_NAMES[career].toUpperCase()} LEVEL ${after}`, color: '#F2B134', ms: 2600 });
    bus.emit(JOBS_EV.LEVEL_UP, { career, level: after });
  }
}

/** Street label of a world point ("Strandvejen 14" style addresses are invented numbers on a real street). */
export function streetName(world, x, y) {
  return world.streetAt(x, y, 40 * PX) || null;
}

/** Heading (radians) along the first road edge leaving drive node `node`, or `toward` {x,y} when given. */
export function roadAngle(world, node, x, y, toward) {
  if (toward) return Math.atan2(toward.y - y, toward.x - x);
  const g = world.drive;
  const e = node != null && node >= 0 ? g.out[node]?.[0] : null;
  return e ? Math.atan2(g.y[e.to] - y, g.x[e.to] - x) : 0;
}

/** Spawn a company vehicle (jobVehicle) at a road point, released from traffic recycling. */
export function spawnJobVehicle(ctx, type, x, y, angle, color) {
  const v = ctx.spawnVehicle(type, x, y, { angle, jobVehicle: true, color, tag: 'job' });
  v.jobVehicle = true;
  const traffic = ctx.systems.traffic;
  if (traffic && typeof traffic.releaseVehicle === 'function') traffic.releaseVehicle(v);
  return v;
}

/** Route length in metres along the drive graph (falls back to 1.4x straight line). */
export function routeMetres(world, a, b) {
  const g = world.drive;
  const na = g.nearest(a.x, a.y, 400), nb = g.nearest(b.x, b.y, 400);
  const p = na >= 0 && nb >= 0 ? g.path(na, nb) : null;
  if (!p) return (dist(a, b) * 1.4) / PX;
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(g.x[p[i]] - g.x[p[i - 1]], g.y[p[i]] - g.y[p[i - 1]]);
  return d / PX;
}

export const fmtMetres = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
