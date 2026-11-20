// Uniform-grid spatial hash for objects with numeric x/y. Rebuilt each frame
// without allocating (bucket arrays are reused).
export class SpatialHash {
  constructor(cell = 256) {
    this.cell = cell;
    this.inv = 1 / cell;
    this.map = new Map();
    this.used = [];
  }

  clear() {
    for (let i = 0; i < this.used.length; i++) this.used[i].length = 0;
    this.used.length = 0;
  }

  _key(cx, cy) { return (cx + 2) * 8192 + (cy + 2); }

  insert(o) {
    const k = this._key(Math.floor(o.x * this.inv), Math.floor(o.y * this.inv));
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    if (b.length === 0) this.used.push(b);
    b.push(o);
  }

  /** Fill `out` with every object in cells overlapping the circle. Returns out. */
  query(x, y, r, out) {
    out.length = 0;
    const c0 = Math.floor((x - r) * this.inv), c1 = Math.floor((x + r) * this.inv);
    const r0 = Math.floor((y - r) * this.inv), r1 = Math.floor((y + r) * this.inv);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const b = this.map.get(this._key(cx, cy));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}
