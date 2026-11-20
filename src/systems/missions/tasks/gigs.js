// Street gig templates: short walk-up tasks around the player. OWNER: JOBS specialist.
//
// Every template is `{ id, weight, build(B) -> spec | null }` where B is the build helper (see makeHelper). A spec is
//   { tpl, title, short, blurb, pay, lq?, size?, fragile?, item?, stages: [...], metres, limit?, key }
// and becomes a MissionSystem job of kind 'gig' (fixed pay, countdown from accept, persisted). Places are real Aarhus
// POIs/landmarks from the map, people and dogs are fictional (data/tasks.js NAMES, DOGS).
import { PX } from '../../../config.js';
import { TUNING, CHAIN_RE } from '../../../data/missions.js';
import { TASKS, PARKS, NAMES, DOGS } from '../../../data/tasks.js';

let seq = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.round(rnd(a, b));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const SHOP_RE = /netto|brugsen|meny|kvickly|salling|irma|købmand|kobmand|superkiosk/i;
const SOFA_BAD_RE = /kiosk|bager|blomst|bog|apotek|brød|cooperativet/i;

/** Lazily built list of parks: centroid in world px, size, optional real name. */
function parksOf(world) {
  if (world._parks) return world._parks;
  const m = world.map, out = [];
  const toPx = (lat, lon) => ({
    x: ((lon - m.bbox.west) / (m.bbox.east - m.bbox.west)) * m.width,
    y: ((m.bbox.north - lat) / (m.bbox.north - m.bbox.south)) * m.height,
  });
  const named = PARKS.map((p) => ({ ...p, ...toPx(p.lat, p.lon) }));
  for (const f of m.green || []) {
    if (f[0] !== 0) continue; // parks only (forest and pitches are skipped)
    let sx = 0, sy = 0, n = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 1; i + 1 < f.length; i += 2) { sx += f[i]; sy += f[i + 1]; n++; minx = Math.min(minx, f[i]); maxx = Math.max(maxx, f[i]); miny = Math.min(miny, f[i + 1]); maxy = Math.max(maxy, f[i + 1]); }
    if (n < 3) continue;
    const w = (maxx - minx) / PX, h = (maxy - miny) / PX;
    if (w * h < 12000) continue; // too small for a walk
    const c = { x: sx / n, y: sy / n, r: Math.min(w, h) / 2 };
    const nm = named.find((p) => Math.hypot(p.x - c.x, p.y - c.y) < 420 * PX / 1.0);
    out.push({ ...c, name: nm ? nm.name : null });
  }
  world._parks = out;
  return out;
}

/** Build helper: everything a template needs, bound to the player and the live world. */
export function makeHelper(board, opts = {}) {
  const ctx = board.ctx, w = ctx.world, pl = ctx.player;
  const px = opts.x ?? pl.px, py = opts.y ?? pl.py;
  const used = board.usedKeys();
  const B = {
    ctx, px, py, lo: opts.lo ?? 120, hi: opts.hi ?? 560,
    rnd, rint, pick,
    name: () => pick(NAMES),
    dog: () => pick(DOGS),
    isUsed: (k) => used.has(k),
    /** A drive-graph point `minM..maxM` from (cx,cy) on a named street. */
    street(minM, maxM, cx = px, cy = py) {
      const g = w.drive;
      for (let k = 0; k < 10; k++) {
        const n = g.randomNodeInRing(cx, cy, minM * PX, maxM * PX);
        if (n < 0) continue;
        const x = g.x[n], y = g.y[n];
        const s = w.streetAt(x, y, 40 * PX);
        if (!s) continue;
        const key = `${s}${Math.round(x / 80)}${Math.round(y / 80)}`;
        if (used.has(key)) continue;
        return { x, y, street: s, addr: `${s} ${1 + Math.floor(Math.random() * 79)}`, key };
      }
      return null;
    },
    /** A named POI (not a chain) near the player, or near (cx,cy) when given. */
    poi(test, minM = B.lo, maxM = B.hi, cx = px, cy = py) {
      const c = [];
      for (const p of w.pois) {
        if (!p.n || CHAIN_RE.test(p.n) || used.has(p.n)) continue;
        if (!test(p)) continue;
        const d = Math.hypot(p.x - cx, p.y - cy) / PX;
        if (d < minM || d > maxM) continue;
        c.push(p);
      }
      return c.length ? pick(c) : null;
    },
    landmark: (id) => w.landmark(id),
    district: (x, y) => w.districtAt(x, y),
    walkNear(cx, cy, minM, maxM) {
      const g = w.walk, n = g.randomNodeInRing(cx, cy, minM * PX, maxM * PX);
      return n < 0 ? null : { x: g.x[n], y: g.y[n] };
    },
    parks: () => parksOf(w),
    metres: (a, b) => (dist(a, b) / PX) * 1.3,
    limit: (metres, stops) => Math.round(((metres / TASKS.speedMps) * 1.55) + 45 + 12 * stops),
    pickupStage: (p, name, size = 0) => ({ action: 'pickup', x: p.x, y: p.y, name, radius: TUNING.pickupRadius, loadTime: 1.5, ...(size ? { requires: { capacity: size } } : {}) }),
    dropStage: (p, name) => ({ action: 'dropoff', x: p.x, y: p.y, name, radius: TUNING.dropRadius }),
    visitStage: (p, name, radius = 70) => ({ action: 'visit', x: p.x, y: p.y, name, radius }),
    waitStage: (p, name, sec) => ({ action: 'wait', x: p.x, y: p.y, name, radius: 80, loadTime: sec }),
  };
  return B;
}

export const GIG_TEMPLATES = [
  {
    id: 'groceries', weight: 10,
    build(B) {
      const shop = B.poi((p) => p.k === 'shop' && SHOP_RE.test(p.n));
      if (!shop) return null;
      const who = B.name();
      const to = B.street(150, 450, shop.x, shop.y);
      if (!to) return null;
      const metres = B.metres(shop, to);
      return {
        tpl: 'groceries', title: `Groceries for ${who}`, short: `Groceries: ${shop.n}`, key: shop.n, size: 1, item: 'Shopping bags', pay: B.rint(45, 75),
        blurb: `${who} on ${to.street} cannot carry the shopping up the stairs. Fetch it at ${shop.n}, deliver to ${to.addr}.`,
        stages: [B.pickupStage(shop, shop.n, 1), B.dropStage(to, to.addr)], metres: metres + 40,
      };
    },
  },
  {
    id: 'laptop', weight: 5,
    build(B) {
      const univ = B.poi((p) => p.k === 'culture' && /universitet/i.test(p.n), 0, 2600, B.px, B.py);
      const cafe = B.poi((p) => p.k === 'cafe');
      if (!univ || !cafe) return null;
      const m = B.metres(cafe, univ);
      if (m < 350 || m > 2400) return null;
      const who = B.name();
      return {
        tpl: 'laptop', title: 'Forgotten laptop', short: 'Laptop to Universitet', key: cafe.n, size: 1, fragile: true, item: 'Laptop', pay: B.rint(85, 125), lq: 1,
        blurb: `${who} left a laptop at ${cafe.n} and has an exam at Aarhus Universitet. Get it there in time.`,
        stages: [B.pickupStage(cafe, cafe.n, 1), B.dropStage(univ, 'Aarhus Universitet')], metres: m,
      };
    },
  },
  {
    id: 'jumpstart', weight: 8,
    build(B) {
      const at = B.street(B.lo, B.hi);
      if (!at) return null;
      const who = B.name();
      return {
        tpl: 'jumpstart', title: `Jump-start for ${who}`, short: `Jump-start: ${at.street}`, key: at.key, pay: B.rint(40, 62),
        blurb: `${who}'s old Fiat will not start on ${at.street}. Stay by the car for a few seconds with the jump leads.`,
        stages: [B.waitStage(at, `${at.addr} (car)`, 7)], metres: B.metres({ x: B.px, y: B.py }, at),
      };
    },
  },
  {
    id: 'dogwalk', weight: 6,
    build(B) {
      const owner = B.street(B.lo, B.hi);
      if (!owner) return null;
      const parks = B.parks().filter((p) => Math.hypot(p.x - owner.x, p.y - owner.y) / PX < 1000).sort((a, b) => Math.hypot(a.x - owner.x, a.y - owner.y) - Math.hypot(b.x - owner.x, b.y - owner.y));
      const park = parks[0];
      if (!park) return null;
      const dog = B.dog(), who = B.name();
      const pname = park.name || `the park in ${B.district(park.x, park.y) || 'Aarhus'}`;
      const pts = [];
      for (let k = 0; k < 14 && pts.length < 3; k++) {
        const p = B.walkNear(park.x, park.y, 0, Math.max(60, park.r * 0.9));
        if (p && pts.every((q) => dist(p, q) > 55 * PX)) pts.push(p);
      }
      if (pts.length < 3) return null;
      pts.sort((a, b) => dist(a, owner) - dist(b, owner));
      let metres = B.metres(owner, pts[0]);
      for (let i = 1; i < pts.length; i++) metres += B.metres(pts[i - 1], pts[i]);
      metres += B.metres(pts[pts.length - 1], owner);
      return {
        tpl: 'dogwalk', title: `Walk ${dog} in ${pname}`, short: `Dog walk: ${dog}`, key: owner.key, pay: B.rint(70, 110), lq: 1,
        blurb: `${who} needs ${dog} walked through ${pname}: three stops on the route, then bring ${dog} home to ${owner.addr}.`,
        stages: [B.pickupStage(owner, `${dog} at ${owner.addr}`), ...pts.map((p, i) => B.visitStage(p, `${pname} ${i + 1}/3`, 60)), B.dropStage(owner, `${dog} home`)],
        metres, limit: Math.round(metres / 3.4 + 120),
      };
    },
  },
  {
    id: 'flyers', weight: 7,
    build(B) {
      const cafe = B.poi((p) => p.k === 'cafe' || p.k === 'bar');
      if (!cafe) return null;
      const pts = [];
      for (let k = 0; k < 16 && pts.length < 4; k++) {
        const p = B.walkNear(cafe.x, cafe.y, 70, 280);
        if (p && pts.every((q) => dist(p, q) > 50 * PX)) pts.push(p);
      }
      if (pts.length < 4) return null;
      let cur = cafe, metres = 0;
      const route = [];
      const left = pts.slice();
      while (left.length) { left.sort((a, b) => dist(a, cur) - dist(b, cur)); const n = left.shift(); metres += B.metres(cur, n); route.push(n); cur = n; }
      const dname = B.district(cafe.x, cafe.y) || 'town';
      return {
        tpl: 'flyers', title: `Flyer run for ${cafe.n}`, short: `Flyers: ${cafe.n}`, key: cafe.n, pay: B.rint(60, 95),
        blurb: `${cafe.n} wants flyers handed out at four corners around ${dname}. Collect the stack, then visit all four.`,
        stages: [B.pickupStage(cafe, cafe.n), ...route.map((p, i) => B.visitStage(p, `Flyer corner ${i + 1}/4`, 55))],
        metres, limit: Math.round(metres / 3.4 + 120),
      };
    },
  },
  {
    id: 'sofa', weight: 3,
    build(B) {
      const shop = B.poi((p) => p.k === 'shop' && !SOFA_BAD_RE.test(p.n));
      if (!shop) return null;
      const to = B.street(300, 800, shop.x, shop.y);
      if (!to) return null;
      const who = B.name();
      return {
        tpl: 'sofa', title: `Carry a sofa for ${who}`, short: `Sofa: ${shop.n}`, key: shop.n, size: 2, item: 'Sofa', pay: B.rint(130, 200),
        blurb: `${who} bought a sofa at ${shop.n}. It needs a van or cargo bike (capacity 2) to ${to.addr}.`,
        stages: [B.pickupStage(shop, shop.n, 2), B.dropStage(to, to.addr)], metres: B.metres(shop, to) + 40,
      };
    },
  },
  {
    id: 'prescription', weight: 6,
    build(B) {
      const ph = B.poi((p) => /apotek/i.test(p.n), B.lo, 1500);
      if (!ph) return null;
      const to = B.street(150, 600, ph.x, ph.y);
      if (!to) return null;
      const who = B.name();
      return {
        tpl: 'prescription', title: `Prescription for ${who}`, short: `Prescription: ${ph.n}`, key: ph.n, size: 1, item: 'Prescription', pay: B.rint(55, 85), lq: 1,
        blurb: `${who} is stuck at home with a cold. Collect the prescription at ${ph.n} and bring it to ${to.addr}.`,
        stages: [B.pickupStage(ph, ph.n, 1), B.dropStage(to, to.addr)], metres: B.metres(ph, to) + 30,
      };
    },
  },
  {
    id: 'library', weight: 5,
    build(B) {
      const dokk1 = B.landmark('dokk1');
      const from = B.street(B.lo, B.hi);
      if (!dokk1 || !from) return null;
      const m = B.metres(from, dokk1);
      if (m < 250 || m > 1900) return null;
      const who = B.name();
      return {
        tpl: 'library', title: 'Return library books', short: 'Books to Dokk1', key: from.key, size: 1, item: 'Library books', pay: B.rint(60, 92), lq: 1,
        blurb: `${who} on ${from.street} has overdue library books. Pick them up at ${from.addr} and drop them at Dokk1.`,
        stages: [B.pickupStage(from, from.addr, 1), B.dropStage(dokk1, 'Dokk1')], metres: m,
      };
    },
  },
  {
    id: 'cake', weight: 6,
    build(B) {
      const bk = B.poi((p) => /bager|bageri|brød/i.test(p.n));
      if (!bk) return null;
      const to = B.street(150, 550, bk.x, bk.y);
      if (!to) return null;
      const who = B.name();
      return {
        tpl: 'cake', title: `Birthday cake for ${who}`, short: `Cake: ${bk.n}`, key: bk.n, size: 1, fragile: true, item: 'Birthday cake', pay: B.rint(65, 105),
        blurb: `${who} turns 70 today. Fetch the cake at ${bk.n} and carry it carefully to ${to.addr}.`,
        stages: [B.pickupStage(bk, bk.n, 1), B.dropStage(to, to.addr)], metres: B.metres(bk, to) + 30,
      };
    },
  },
  {
    id: 'puncture', weight: 7,
    build(B) {
      const at = B.street(B.lo, B.hi);
      if (!at) return null;
      const who = B.name();
      return {
        tpl: 'puncture', title: `Flat tyre: ${who}`, short: `Flat tyre: ${at.street}`, key: at.key, pay: B.rint(40, 58),
        blurb: `${who} has a puncture on ${at.street}. Help patch the inner tube, it takes a few seconds.`,
        stages: [B.waitStage(at, `${at.addr} (bike)`, 9)], metres: B.metres({ x: B.px, y: B.py }, at),
      };
    },
  },
  {
    id: 'flowers', weight: 5,
    build(B) {
      const fl = B.poi((p) => /blomst/i.test(p.n));
      if (!fl) return null;
      const to = B.street(150, 600, fl.x, fl.y);
      if (!to) return null;
      const who = B.name();
      return {
        tpl: 'flowers', title: `Flowers for ${who}`, short: `Flowers: ${fl.n}`, key: fl.n, size: 1, fragile: true, item: 'Flower bouquet', pay: B.rint(60, 95), lq: 1,
        blurb: `A bouquet waits at ${fl.n} for ${who} at ${to.addr}. Do not crush it.`,
        stages: [B.pickupStage(fl, fl.n, 1), B.dropStage(to, to.addr)], metres: B.metres(fl, to) + 30,
      };
    },
  },
  {
    id: 'tourist', weight: 3,
    build(B) {
      const h = B.landmark('aarhush');
      if (!h || Math.hypot(h.x - B.px, h.y - B.py) / PX > 1100) return null;
      const dest = pick(['aros', 'domkirke', 'gamleby', 'dokk1'].map((id) => B.landmark(id)).filter(Boolean));
      if (!dest) return null;
      const m = B.metres(h, dest);
      if (m < 400 || m > 2600) return null;
      const who = B.name();
      return {
        tpl: 'tourist', title: `Show ${who} to ${dest.n}`, short: `Tourist: ${dest.n}`, key: `tourist${dest.n}`, pay: B.rint(90, 135),
        blurb: `${who} just arrived at Aarhus H and wants to see ${dest.n}. Meet them at the station and lead the way.`,
        stages: [B.pickupStage(h, 'Aarhus H'), B.dropStage(dest, dest.n)], metres: m,
      };
    },
  },
  {
    id: 'kiosk', weight: 5,
    build(B) {
      const k = B.poi((p) => p.k === 'shop' && /kiosk/i.test(p.n));
      if (!k) return null;
      const to = B.street(150, 600, k.x, k.y);
      if (!to) return null;
      const who = B.name();
      return {
        tpl: 'kiosk', title: `Parcel from ${k.n}`, short: `Parcel: ${k.n}`, key: k.n, size: 1, item: 'Parcel', pay: B.rint(45, 72),
        blurb: `${who} had a parcel sent to ${k.n}. Bring it to ${to.addr}.`,
        stages: [B.pickupStage(k, k.n, 1), B.dropStage(to, to.addr)], metres: B.metres(k, to) + 30,
      };
    },
  },
];

/** Turn a spec into a MissionSystem job (state 'offered', not yet in the active list). */
export function jobFromSpec(spec) {
  const stages = spec.stages;
  return {
    id: `gig${Date.now().toString(36)}${++seq}`, kind: 'gig', task: 'gig', tpl: spec.tpl, title: spec.title, short: spec.short, blurb: spec.blurb,
    legal: true, level: 1, state: 'offered', stages, stageIndex: 0,
    timeLeft: null, timeLimit: spec.limit ?? Math.round((spec.metres / TASKS.speedMps) * 1.55 + 45 + 12 * stages.length), timerFrom: 0, timerTo: stages.length,
    reward: spec.pay, lq: spec.lq || 0, metres: Math.round(spec.metres),
    cargo: { size: spec.size || 0, fragile: !!spec.fragile, name: spec.item || spec.short }, damage: 0, loaded: false,
    fixed: true, persist: true, event: null,
  };
}
