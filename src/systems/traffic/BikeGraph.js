// Cycleway graph built from map.bike (written by scripts/build-map.mjs): separate cycle paths,
// cycle tracks and lanes. Same shape as the world drive graph (x, y, out, nearest, randomNodeInRing)
// so CarBrain can route cyclists on it. Two-way, so cyclists keep to the right of the path centre line.
const CELL = 256;

export function buildBikeGraph(g) {
  if (!g || !g.n || !g.e || g.n.length < 4) return null;
  const count = g.n.length / 2;
  const x = new Float32Array(count), y = new Float32Array(count);
  for (let i = 0; i < count; i++) { x[i] = g.n[i * 2]; y[i] = g.n[i * 2 + 1]; }
  const out = Array.from({ length: count }, () => []);
  for (let i = 0; i < g.e.length; i += 4) {
    const a = g.e[i], b = g.e[i + 1], w = g.e[i + 3];
    out[a].push({ to: b, w }); out[b].push({ to: a, w });
  }
  const cells = new Map();
  for (let i = 0; i < count; i++) {
    const k = Math.floor(x[i] / CELL) * 65536 + Math.floor(y[i] / CELL);
    let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i);
  }
  const graph = { count, x, y, out, bike: true };
  graph.nearest = (px, py, maxDist = 400) => {
    const R = Math.ceil(maxDist / CELL), cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    let best = -1, bd = maxDist * maxDist;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
      const l = cells.get((cx + dx) * 65536 + cy + dy);
      if (!l) continue;
      for (const i of l) { const d = (x[i] - px) ** 2 + (y[i] - py) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  };
  graph.randomNodeInRing = (px, py, rMin, rMax, tries = 6) => {
    for (let t = 0; t < tries; t++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const n = graph.nearest(px + Math.cos(a) * r, py + Math.sin(a) * r, 300);
      if (n < 0) continue;
      const d = Math.hypot(x[n] - px, y[n] - py);
      if (d >= rMin && d <= rMax) return n;
    }
    return -1;
  };
  return graph;
}
