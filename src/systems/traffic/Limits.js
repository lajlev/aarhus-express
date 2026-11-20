// Speed limit per directed drive edge (km/h), keyed by node pair. Built once from world.edgeSpeedLimit().
export class EdgeLimits {
  constructor(world) {
    this.n = world.drive.count || 1;
    this.map = new Map();
    const e = world.map.drive.e;
    for (let i = 0; i + 3 < e.length; i += 4) {
      const kmh = world.edgeSpeedLimit(i / 4);
      this.map.set(e[i] * this.n + e[i + 1], kmh);
      this.map.set(e[i + 1] * this.n + e[i], kmh);
    }
  }

  /** km/h of the edge a -> b (50 when unknown). */
  get(a, b) { return this.map.get(a * this.n + b) || 50; }
}
