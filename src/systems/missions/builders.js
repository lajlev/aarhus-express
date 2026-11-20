// Job builders: turn a template + level (or a stolen vehicle) into a job object.
// All positions come from the real map (world.pois / world.landmarks), already snapped to the road graph.
import { PX } from '../../config.js';
import { TUNING, LEVELS, TEMPLATES, ORDER } from '../../data/missions.js';

let nextJobId = 1;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Route length in px along the drive graph (falls back to 1.4x straight line). */
export function routePx(world, a, b) {
  const g = world.drive;
  const na = g.nearest(a.x, a.y, 400), nb = g.nearest(b.x, b.y, 400);
  const p = na >= 0 && nb >= 0 ? g.path(na, nb) : null;
  if (!p) return dist(a, b) * 1.4;
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(g.x[p[i]] - g.x[p[i - 1]], g.y[p[i]] - g.y[p[i - 1]]);
  return d;
}

const lmPoint = (world, id, label) => {
  const l = world.landmark(id);
  return l ? { x: l.x, y: l.y, name: label || l.n, kind: l.k } : null;
};
const poiPoint = (p) => ({ x: p.x, y: p.y, name: p.n, kind: p.k });

/** All named places usable as order endpoints: OSM POIs plus a few landmarks. */
function placePool(world, kinds) {
  const out = world.pois.filter((p) => kinds.includes(p.k) && p.n).map(poiPoint);
  for (const l of Object.values(world.landmarks)) if (['shop', 'food', 'culture'].includes(l.k)) out.push({ x: l.x, y: l.y, name: l.n, kind: l.k });
  return out;
}

const stagePt = (pt, action, extra = {}) => ({
  action, x: pt.x, y: pt.y, name: pt.name,
  radius: action === 'pickup' ? TUNING.pickupRadius : TUNING.dropRadius, ...extra,
});

/** Fill timeLimit / reward from consecutive stage legs between timerFrom..timerTo. */
function finalize(ctx, job, { timerFrom, timerTo, criminal, mul }) {
  const st = job.stages;
  timerTo = Math.min(timerTo ?? st.length, st.length);
  let metres = 0, stops = 0;
  for (let i = timerFrom; i < timerTo; i++) {
    const a = st[i - 1], b = st[i];
    if (a.x == null || b.x == null) continue;
    metres += routePx(ctx.world, a, b) / PX;
    stops++;
  }
  const lv = LEVELS[job.level - 1] || LEVELS[0];
  const nav = ctx.systems?.economy?.getEffects?.().timeLimit ?? 1; // Navigation skill (economy)
  job.timerFrom = timerFrom;
  job.timerTo = timerTo;
  job.metres = Math.round(metres);
  job.timeLimit = Math.round(((metres / TUNING.speedMps) * TUNING.timeSlack + TUNING.timeBase + stops * TUNING.stopSeconds) * lv.timeMul * nav);
  job.timeLeft = null; // starts when stage timerFrom is reached
  let reward = (TUNING.payBase + metres * TUNING.payPerMetre) * lv.payMul * (mul || 1);
  if (criminal) reward *= TUNING.criminalMul;
  job.reward = Math.round(reward);
  return job;
}

const baseJob = (o) => ({
  id: `job${nextJobId++}`, stageIndex: 0, timeLeft: null, timeLimit: null, reward: 0,
  cargo: { size: 1, fragile: false, name: 'Package' }, damage: 0, loaded: false, state: 'offered', level: 1, ...o,
});

// ---------------------------------------------------------------- orders
/** Pickup -> delivery order triggered by stealing `vehicle`. Returns a job or null. */
export function buildOrder(ctx, vehicle) {
  const { world, player } = ctx;
  const pool = placePool(world, ORDER.poiKinds);
  const px = player.px, py = player.py;
  const cap = vehicle?.def?.capacity ?? 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const widen = 1 + attempt * 0.25;
    const pickups = pool.filter((p) => {
      const d = Math.hypot(p.x - px, p.y - py) / PX;
      return d >= ORDER.pickupM[0] / widen && d <= ORDER.pickupM[1] * widen;
    });
    if (!pickups.length) continue;
    const a = pick(pickups);
    const drops = pool.filter((p) => {
      const d = dist(p, a) / PX;
      return p.name !== a.name && d >= ORDER.dropM[0] / widen && d <= ORDER.dropM[1] * widen;
    });
    if (!drops.length) continue;
    const b = pick(drops);
    const items = ORDER.items[a.kind] || ORDER.items.landmark;
    const name = pick(items);
    const big = Math.random() < ORDER.bigChance;
    const size = big ? Math.min(6, cap + 1 + Math.floor(Math.random() * 2)) : 1 + Math.floor(Math.random() * Math.min(cap, 3));
    const fragile = ORDER.fragileItems.includes(name) || Math.random() < ORDER.fragileChance * 0.3;
    const job = baseJob({
      kind: 'order', title: `Order: ${name}`, legal: true,
      cargo: { size, fragile, name },
      stages: [
        stagePt(a, 'pickup', { requires: { capacity: size }, loadTime: TUNING.loadSeconds }),
        stagePt(b, 'dropoff'),
      ],
    });
    return finalize(ctx, job, { timerFrom: 1, mul: (size > 2 ? 1.2 : 1) * (fragile ? 1.15 : 1) });
  }
  return null;
}

// ---------------------------------------------------------------- contact missions
const nearestChain = (start, pts) => {
  const left = pts.slice(), out = [];
  let cur = start;
  while (left.length) {
    left.sort((p, q) => dist(cur, p) - dist(cur, q));
    cur = left.shift();
    out.push(cur);
  }
  return out;
};

/** Pick a landmark id from `ids` roughly minM..maxM from `from` ({x,y}); falls back to the farthest. */
function pickLandmark(world, ids, from, minM, maxM, exclude = []) {
  const c = ids.filter((id) => world.landmark(id) && !exclude.includes(id)).map((id) => ({ id, d: dist(world.landmark(id), from) / PX }));
  const ok = c.filter((o) => o.d >= minM && o.d <= maxM);
  if (ok.length) return pick(ok).id;
  c.sort((p, q) => q.d - p.d);
  return c[0]?.id;
}

export function buildMission(ctx, contact, templateId, level) {
  const T = TEMPLATES[templateId];
  const world = ctx.world;
  const L = Math.max(1, Math.min(TUNING.maxLevel, level));
  const home = world.landmark(contact.at);
  if (!T || !home) return null;
  const base = { kind: 'mission', template: templateId, level: L, legal: T.legal, contactId: contact.id, contactName: contact.name };
  const lvName = ` (L${L})`;

  if (templateId === 'foodRush') {
    const hub = world.landmark(T.hub);
    const pool = world.pois.filter((p) => ['food', 'cafe', 'bar'].includes(p.k) && p.n && dist(p, hub) < T.hubRadius);
    const names = new Set();
    const picks = shuffle(pool.slice()).filter((p) => (names.has(p.n) ? false : names.add(p.n))).slice(0, T.drops[L - 1]);
    if (picks.length < 2) return null;
    const start = lmPoint(world, contact.at, 'Aarhus Street Food kitchen');
    const drops = nearestChain(start, picks.map(poiPoint));
    const job = baseJob({
      ...base, title: `${T.title}${lvName}`, cargo: { size: 2, fragile: false, name: pick(T.cargoNames) },
      stages: [stagePt(start, 'pickup', { loadTime: TUNING.loadSeconds, requires: { capacity: 2 } }), ...drops.map((d) => stagePt(d, 'dropoff'))],
    });
    return finalize(ctx, job, { timerFrom: 1 });
  }

  if (templateId === 'movingHelp') {
    const hub = world.landmark(T.hub);
    const pool = placePool(world, ['shop', 'cafe', 'food']).filter((p) => dist(p, hub) < T.hubRadius);
    const n = T.moves[L - 1];
    if (pool.length < n * 2) return null;
    shuffle(pool);
    const size = T.sizes[L - 1];
    const stages = [{ action: 'enter', x: home.x, y: home.y, name: 'Bjørn\'s moving van', vehicleType: 'van' }];
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const a = pool.find((p) => !used.has(p.name));
      used.add(a.name);
      const b = pool.find((p) => !used.has(p.name) && dist(p, a) >= 1800 && dist(p, a) <= 6000) || pool.find((p) => !used.has(p.name) && dist(p, a) >= 900);
      if (!b) return null;
      used.add(b.name);
      stages.push(stagePt(a, 'pickup', { requires: { capacity: size }, loadTime: TUNING.loadSeconds * 1.5 }));
      stages.push(stagePt(b, 'dropoff'));
    }
    const job = baseJob({ ...base, title: `${T.title}${lvName}`, cargo: { size, fragile: L === 3, name: T.cargoNames[L - 1] }, stages, spawnVan: true });
    return finalize(ctx, job, { timerFrom: 2, mul: 1.1 });
  }

  if (templateId === 'taxiFare') {
    const from = lmPoint(world, T.from, 'Aarhus H taxi rank');
    const pool = placePool(world, ['culture', 'shop', 'food']).concat(['dokk1', 'aros', 'radhus', 'domkirke', 'gamleby'].map((id) => lmPoint(world, id)).filter(Boolean))
      .filter((p) => { const d = dist(p, from) / PX; return d >= T.minM && d <= T.maxM; });
    const n = T.fares[L - 1];
    if (pool.length < n) return null;
    shuffle(pool);
    const picks = nearestChain(from, pool.slice(0, n));
    const job = baseJob({
      ...base, title: `${T.title}${lvName}`, cargo: { size: 1, fragile: true, name: n > 1 ? `${n} passengers` : 'Passenger' }, passenger: true,
      stages: [stagePt(from, 'pickup', { loadTime: TUNING.loadSeconds, requires: { capacity: 1 } }), ...picks.map((p) => stagePt(p, 'dropoff'))],
    });
    return finalize(ctx, job, { timerFrom: 1 });
  }

  if (templateId === 'smuggle') {
    const g = world.drive;
    const n = g.randomNodeInRing(home.x, home.y, 300, 900);
    const pu = n >= 0 ? { x: g.x[n], y: g.y[n], name: 'Quay 7, container yard' } : { x: home.x, y: home.y, name: 'Quay 7, container yard' };
    const did = pickLandmark(world, T.drops, pu, T.minM, T.maxM);
    const drop = lmPoint(world, did, `Handover: ${world.landmark(did).n}`);
    const job = baseJob({
      ...base, title: `${T.title}${lvName}`, cargo: { size: 1, fragile: false, name: 'Sealed package' }, heatLimit: T.heatLimit[L - 1],
      stages: [stagePt(pu, 'pickup', { loadTime: TUNING.loadSeconds * 1.3, crime: { type: 'mission', severity: 0.25 + 0.15 * L } }), stagePt(drop, 'dropoff', { crime: { type: 'mission', severity: 0.2 } })],
    });
    return finalize(ctx, job, { timerFrom: 1, criminal: true });
  }

  if (templateId === 'hotCar') {
    const type = T.cars[L - 1];
    const did = pickLandmark(world, T.drops, home, T.minM, T.maxM);
    const drop = lmPoint(world, did, `Safehouse: ${world.landmark(did).n}`);
    const job = baseJob({
      ...base, title: `${T.title}${lvName}`, cargo: { size: 1, fragile: false, name: 'Hot car' }, heatAmount: T.heat[L - 1], spawnCar: type,
      stages: [
        { action: 'enter', x: home.x, y: home.y, name: 'The hot car', vehicleType: type },
        stagePt(drop, 'dropoff', { crime: { type: 'mission', severity: 0.4 } }),
        { action: 'lose', x: null, y: null, name: 'Lose the police' },
      ],
    });
    finalize(ctx, job, { timerFrom: 1, timerTo: 2, criminal: true });
    job.timeLimit = Math.round(job.timeLimit * 1.15 + 15); // leave room to shake the heat
    job.reward = Math.round(job.reward * (1 + 0.15 * L));
    return job;
  }

  if (templateId === 'stealModel') {
    const model = T.models[L - 1];
    const gid = pickLandmark(world, T.garages, home, 0, 1e9, [contact.at]) || T.garages[0];
    const garage = lmPoint(world, gid, `Sille's garage, ${world.landmark(gid).n}`);
    const g = world.drive;
    const n = g.randomNodeInRing(home.x, home.y, T.spawnRing[0], T.spawnRing[1]);
    const spot = n >= 0 ? { x: g.x[n], y: g.y[n] } : { x: home.x, y: home.y };
    const job = baseJob({
      ...base, title: `${T.title}${lvName}`, cargo: { size: 1, fragile: false, name: 'Ordered car' }, spawnCar: model, spawnAt: spot, minHealth: T.minHealth[L - 1],
      stages: [
        { action: 'steal', x: spot.x, y: spot.y, name: `Steal a ${model === 'coupe' ? 'sports coupé' : model === 'van' ? 'delivery van' : model}`, vehicleType: model },
        stagePt(garage, 'dropoff', { crime: { type: 'mission', severity: 0.35 + 0.1 * L } }),
      ],
    });
    finalize(ctx, job, { timerFrom: 1, criminal: true });
    job.timeLimit = Math.round(job.timeLimit * 1.1 + 20);
    return job;
  }
  return null;
}
