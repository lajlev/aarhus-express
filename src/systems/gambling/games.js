// Gambling maths: pure functions with documented return-to-player (RTP). OWNER: economy specialist.
// Nothing here touches the game; every function takes an `rng` (default Math.random) so tests can seed it.
// All games are original: invented symbols, names and pay tables. The house always wins on average (money only, no LQ effect).
import { EVENT_RULES } from '../../data/tasks.js';

export const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const roll = (table, rng) => {
  let r = rng();
  for (const [mult, p] of table) { r -= p; if (r < 0) return mult; }
  return 0; // lose
};
const ri = (n, rng) => Math.min(n - 1, Math.floor(rng() * n));
const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1, rng); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const analyticRtp = (table) => table.reduce((s, [m, p]) => s + m * p, 0);

// ------------------------------------------------------------------ scratch cards ("Skrab & Vind")
// Win table (multiple of the price, probability). RTP = 0.50 exactly: sum(mult * p) = 0.14+0.10+0.09+0.08+0.04+0.03+0.02.
export const SCRATCH = {
  tiers: [{ id: 'small', name: 'Lille Skrab', price: 20 }, { id: 'mid', name: 'Dobbelt Skrab', price: 50 }, { id: 'big', name: 'Guld Skrab', price: 100 }],
  table: [[1, 0.14], [2, 0.05], [3, 0.03], [5, 0.016], [10, 0.004], [20, 0.0015], [50, 0.0004]],
  symbols: ['Æble', 'Bølge', 'Cykel', 'Kaffe', 'Bus', 'Stjerne', 'Krone'], // index = symbol id; mult i of the table shows symbol i
  rtp: 0.5,
};

/** One card: 6 cells; 3 equal symbols win that symbol's multiple, otherwise no symbol appears 3 times. */
export function scratchPlay(rng = Math.random) {
  const mult = roll(SCRATCH.table, rng);
  const n = SCRATCH.symbols.length;
  const counts = new Array(n).fill(0);
  const cells = [];
  let winSymbol = -1;
  if (mult > 0) {
    winSymbol = SCRATCH.table.findIndex((r) => r[0] === mult);
    for (let i = 0; i < 3; i++) cells.push(winSymbol);
    counts[winSymbol] = 3;
  }
  while (cells.length < 6) {
    const s = ri(n, rng);
    if (counts[s] >= 2) continue;
    counts[s]++;
    cells.push(s);
  }
  shuffle(cells, rng);
  return { mult, cells, winSymbol };
}

// ------------------------------------------------------------------ slot machine ("Fyrtårnet")
// 3 reels x 3 rows, one payline (middle row). Symbols: 0 Cykel 1 Kaffe 2 Bus 3 Bølge 4 Stjerne 5 Krone.
// Three equal symbols pay 2/4/8/20/50/100x the stake; two Krone (any reel) pay 1x. Table RTP = 0.70 exactly:
//   1x .224 + 2x .06 + 4x .03 + 8x .012 + 20x .003 + 50x .0008 + 100x .0004.
export const SLOT = {
  symbols: ['Cykel', 'Kaffe', 'Bus', 'Bølge', 'Stjerne', 'Krone'],
  stakes: [10, 20, 50, 100, 200],
  table: [[1, 0.224], [2, 0.06], [4, 0.03], [8, 0.012], [20, 0.003], [50, 0.0008], [100, 0.0004]],
  tripleOf: { 2: 0, 4: 1, 8: 2, 20: 3, 50: 4, 100: 5 },
  nearMissChance: 0.4, // share of LOSING spins dressed up as a near miss (two equal symbols, the third one stops one row away)
  rtp: 0.7,
};

/** { mult, reels: [[top, mid, bottom] x3], near: bool }. The payline is the `mid` row. */
export function slotPlay(rng = Math.random) {
  const mult = roll(SLOT.table, rng);
  const KR = 5, n = SLOT.symbols.length;
  const line = [0, 0, 0];
  let near = false, nearSym = -1;
  if (mult >= 2) {
    const s = SLOT.tripleOf[mult];
    line[0] = line[1] = line[2] = s;
  } else if (mult === 1) {
    const pos = shuffle([0, 1, 2], rng);
    line[pos[0]] = KR; line[pos[1]] = KR;
    let o = ri(n - 1, rng); // a non-crown symbol
    line[pos[2]] = o;
  } else {
    if (rng() < SLOT.nearMissChance) {
      near = true;
      nearSym = ri(n, rng);
      line[0] = line[1] = nearSym;
      line[2] = (nearSym + 1 + ri(n - 1, rng)) % n; // anything but nearSym
      if (nearSym === KR) near = true; // two crowns would pay: avoid, re-pick below
    } else {
      for (let i = 0; i < 3; i++) line[i] = ri(n, rng);
    }
    // a losing line has no triple and fewer than two crowns
    const bad = () => (line[0] === line[1] && line[1] === line[2]) || line.filter((x) => x === KR).length >= 2;
    let guard = 0;
    while (bad() && guard++ < 50) {
      if (near) { nearSym = ri(n - 1, rng); line[0] = line[1] = nearSym; line[2] = (nearSym + 1 + ri(n - 1, rng)) % n; if (line[2] === line[0]) line[2] = (line[0] + 1) % n; }
      else for (let i = 0; i < 3; i++) line[i] = ri(n, rng);
    }
  }
  const reels = line.map((s) => [ri(n, rng), s, ri(n, rng)]);
  if (near) {
    // the missing symbol sits just above or below the payline on reel 3: "so close"
    reels[2][rng() < 0.5 ? 0 : 2] = nearSym;
  }
  return { mult, reels, near, line };
}

// ------------------------------------------------------------------ betting app ("Bookie Bjarne")
export const BET = {
  stakes: [20, 50, 100, 250, 500],
  margin: 0.78, //      the book pays back 78% on average: decimal odds = 0.78 / probability
  match: {
    probs: { win: 0.45, draw: 0.25, loss: 0.3 }, // true chances of the AGF result
    odds: { win: 1.85, draw: 3.2, loss: 2.6 }, //  offered: RTP .83 / .80 / .78
    labels: { win: 'AGF win', draw: 'Draw', loss: 'AGF lose' },
  },
  eventWindowH: 6, //     "a <event> starts within 6 hours"
  rainWindowH: 12,
  minProb: 0.03, maxProb: 0.6, // outside this range no market is offered (no free money, no hopeless long shots)
};

/** AGF result drawn when the match event ends. { result: 'win'|'draw'|'loss', agf, opp }. */
export function matchResult(rng = Math.random) {
  const r = rng(), p = BET.match.probs;
  const result = r < p.win ? 'win' : r < p.win + p.draw ? 'draw' : 'loss';
  if (result === 'draw') { const g = ri(3, rng); return { result, agf: g, opp: g }; }
  if (result === 'win') { const a = 1 + ri(3, rng); return { result, agf: a, opp: ri(a, rng) }; }
  const o = 1 + ri(3, rng);
  return { result, agf: ri(o, rng), opp: o };
}

/**
 * Probability that city event `kind` STARTS within the next `windowMin` game minutes, from the REAL schedule in data/tasks.js
 * EVENT_RULES: the TaskBoard checks every 3 game minutes and starts a rule with `chance` when `when(weekday, hour, day)` holds
 * and the rule is off cooldown (`cd[kind]`, a game minute). So p = 1 - prod(1 - chance) over the eligible checks.
 * `chanceMul` is the TaskBoard's test multiplier. Returns 0 for an unknown kind.
 */
export function eventStartProb(kind, windowMin, nowMin, cd = {}, chanceMul = 1) {
  const rule = EVENT_RULES.find((r) => r.kind === kind);
  if (!rule) return 0;
  const c = Math.min(1, rule.chance * (chanceMul || 1));
  let none = 1;
  for (let t = 3; t <= windowMin; t += 3) {
    const m = nowMin + t;
    if (m < (cd[kind] || 0)) continue;
    const day = Math.floor(m / 1440), wd = day % 7, h = (m % 1440) / 60;
    if (rule.when(wd, h, day)) none *= 1 - c;
  }
  return 1 - none;
}

/** Decimal odds with the book's margin, rounded to 0.05, never below 1.2. */
export const oddsFor = (p) => Math.max(1.2, Math.round((BET.margin / p) * 20) / 20);

export const rtpSim = (play, n, rng, price = 1) => {
  let paid = 0;
  for (let i = 0; i < n; i++) paid += play(rng).mult * price;
  return paid / (n * price);
};
