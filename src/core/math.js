export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => (bx - ax) ** 2 + (by - ay) ** 2;
/** Shortest signed difference b - a between two angles, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
/** Pick from [{weight, ...}] proportionally to weight. */
export function weightedPick(items, key = 'weight') {
  const total = items.reduce((s, i) => s + (i[key] || 0), 0);
  let r = Math.random() * total;
  for (const i of items) { r -= i[key] || 0; if (r <= 0) return i; }
  return items[items.length - 1];
}

/** Minimal binary min-heap keyed by priority, used by A*. */
export class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const it = this.items, pr = this.prio;
    it.push(item); pr.push(p);
    let i = it.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [it[i], it[parent]] = [it[parent], it[i]];
      [pr[i], pr[parent]] = [pr[parent], pr[i]];
      i = parent;
    }
  }
  pop() {
    const it = this.items, pr = this.prio;
    const top = it[0];
    const lastI = it.pop(), lastP = pr.pop();
    if (it.length) {
      it[0] = lastI; pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < it.length && pr[l] < pr[m]) m = l;
        if (r < it.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[i], it[m]] = [it[m], it[i]];
        [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return top;
  }
}
