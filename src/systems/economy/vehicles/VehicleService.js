/**
 * VehicleService: shops, buying, renting, repairs, garage and insurance.   OWNER: HOME & VEHICLES specialist
 * Created by EconomySystem as `economy.fleet`.
 *
 * SHOPS    built once from world.getVehicleShops() (OSM): international chains are filtered (data/shop.js
 *          CHAIN_BLOCKLIST), near-duplicates merged, nameless "Bike rental" entries named after their street.
 *          Plus the invented local DEALERS (data/shop.js) on Viborgvej, Randersvej and Silkeborgvej.
 *          shop = { id, name, kind (bicycle|bikeRental|rental|dealer), label, street, district, x, y (pad), buy[], rent[], repair }
 * BUY      economy.fleet.buy(shopId, type): charges price, pushes the type into state.ownedVehicles (one per type) and
 *          spawns the vehicle owned next to the shop. GameScene respawns every owned type at the home door per session.
 * RENT     economy.fleet.rent(shopId, type, days 1..3): spawns it with rentedBy:'player' next to the shop. Rentals are saved in
 *          state.economy.rentals [{ uid, type, endsAt (clock min), shop }]; at endsAt the vehicle is removed
 *          (player pushed out if riding) with a pager message. Renting the same type again extends it. After a reload
 *          the still-running rentals are respawned at the home door.
 * REPAIR   repairQuote()/repair(): nearest owned or rented vehicle within 40 m: REPAIR_PER_HP kr per missing health point
 *          (half price while insured).
 * INSURANCE weekly premium for owned cars and scooters (data/vehicles.js `insurance`), charged by EconomySystem each
 *          Monday; state.economy.insured says whether it is paid (lapses, never punishes beyond dearer repairs).
 * LICENCE  cars and vans (non-bike) are refused politely while the driving licence is suspended ('police:licence').
 */
import { PX } from '../../../config.js';
import { bus, EV, pager } from '../../../core/events.js';
import { VEHICLES } from '../../../data/vehicles.js';
import { CHAIN_BLOCKLIST, SHOP_KINDS, getDealers } from '../../../data/shop.js';
import { ECON_EV } from '../events.js';
import { MIN_PER_DAY } from '../HomeService.js';

export const FLEET_TUNING = {
  repairPerHp: 12, // kr per missing health point
  insuredRepairFactor: 0.5,
  maxRentDays: 3,
  repairRangeM: 40,
  dedupeM: 40,
};
const kr = (n) => `kr ${Math.round(n).toLocaleString('da-DK')}`;
const isCar = (type) => !VEHICLES[type]?.bike;

export class VehicleService {
  constructor(ctx, eco) {
    this.ctx = ctx;
    this.eco = eco;
    const e = ctx.state.economy;
    e.rentals ||= [];
    e.rentalSeq ||= 1;
    if (e.insured == null) e.insured = true;
    this.shops = [];
    this._respawned = false;
    this._build();
  }

  // ------------------------------------------------------------ shops
  _build() {
    const w = this.ctx.world, out = [], seen = [];
    const cityId = this.ctx.city?.id || this.ctx.state.cityId;
    const raw = w?.getVehicleShops?.() || [];
    raw.forEach((s) => {
      const kind = SHOP_KINDS[s.kind] ? s.kind : null;
      if (!kind || CHAIN_BLOCKLIST.test(s.name || '')) return;
      const pad = w.findFreeSpot(s.lx ?? s.x, s.ly ?? s.y, 160) || { x: s.x, y: s.y };
      if (seen.some((o) => o.kind === kind && o.name === s.name && Math.hypot(o.x - pad.x, o.y - pad.y) < FLEET_TUNING.dedupeM * PX)) return;
      const street = w.streetAt?.(pad.x, pad.y) || '';
      const district = w.districtAt?.(pad.x, pad.y) || '';
      let name = s.name || '';
      if (!name || /^bike rental$/i.test(name)) name = `Cykeludlejning${street ? ` ${street}` : district ? ` ${district}` : ''}`;
      const k = SHOP_KINDS[kind];
      const shop = { kind, label: k.label, name, street, district, x: pad.x, y: pad.y, buy: k.buy, rent: k.rent, repair: k.repair, color: k.color, dealer: false };
      seen.push(shop);
      out.push(shop);
    });
    getDealers(cityId).forEach((d) => {
      const b = w.map.bbox, mid = ((b.south + b.north) / 2) * (Math.PI / 180);
      const hx = (d.lon - b.west) * 111320 * Math.cos(mid) * (w.map.scale || PX), hy = (b.north - d.lat) * 111132 * (w.map.scale || PX);
      const pad = w.findFreeSpot(hx, hy, 160) || { x: hx, y: hy };
      out.push({
        kind: 'dealer', label: 'Dealer', name: d.name, street: d.street, district: w.districtAt?.(pad.x, pad.y) || '', x: pad.x, y: pad.y,
        buy: d.buy, rent: d.rent, repair: true, color: 'orange', dealer: true, blurb: d.blurb, dealerId: d.id,
      });
    });
    out.forEach((s, i) => { s.id = s.dealer ? s.dealerId : `shop-${i}`; });
    this.shops = out;
  }

  getShops() { return this.shops; }
  getShop(id) { return this.shops.find((s) => s.id === id) || null; }

  // ------------------------------------------------------------ licence
  licence() { return this.eco.licenceStatus(); }

  _licenceBlock(type) {
    const l = this.licence();
    if (l.banned && isCar(type)) return 'Your driving licence is suspended. We cannot hand you the keys right now.';
    return '';
  }

  // ------------------------------------------------------------ offers
  _owned(type) { return this.ctx.state.ownedVehicles.includes(type); }
  _rentalOf(type) { return this.ctx.state.economy.rentals.find((r) => r.type === type) || null; }

  /** Rows the dealer overlay shows. */
  getOffers(shop) {
    const money = this.eco.getMoney(), rows = [];
    for (const type of shop.buy || []) {
      const def = VEHICLES[type];
      let reason = this._licenceBlock(type);
      if (!reason && this._owned(type)) reason = 'You already own one';
      else if (!reason && money < def.price) reason = 'Not enough money';
      rows.push({ kind: 'buy', type, name: def.name, price: def.price, insurance: def.insurance || 0, available: !reason, reason, affordable: money >= def.price, owned: this._owned(type) });
    }
    for (const type of shop.rent || []) {
      const def = VEHICLES[type];
      const rental = this._rentalOf(type);
      let reason = this._licenceBlock(type);
      if (!reason && money < def.rentPerDay) reason = 'Not enough money';
      rows.push({ kind: 'rent', type, name: def.name, perDay: def.rentPerDay, available: !reason, reason, affordable: money >= def.rentPerDay, rentedUntil: rental ? rental.endsAt : null });
    }
    if (shop.repair) {
      const q = this.repairQuote();
      rows.push({ kind: 'repair', name: 'Repair my vehicle', quote: q, price: q?.cost || 0, available: !!q && q.cost > 0 && money >= q.cost, reason: !q ? 'No vehicle of yours nearby' : q.cost <= 0 ? 'Nothing to repair' : money < q.cost ? 'Not enough money' : '', affordable: !q || money >= q.cost });
    }
    return rows;
  }

  // ------------------------------------------------------------ buy / rent
  _spawnNear(type, x, y, opts, angle = 0) {
    const w = this.ctx.world;
    const spot = w.findFreeSpot(x + 3.2 * PX, y + 1.6 * PX, 160) || { x, y };
    return this.ctx.spawnVehicle(type, spot.x, spot.y, { angle, ...opts });
  }

  buy(shopId, type) {
    const fail = (reason) => { bus.emit(ECON_EV.BUY_FAILED, { id: type, reason }); return { ok: false, reason }; };
    const shop = this.getShop(shopId), def = VEHICLES[type];
    if (!shop || !def || !(shop.buy || []).includes(type)) return fail('Not sold here');
    const block = this._licenceBlock(type);
    if (block) return fail(block);
    if (this._owned(type)) return fail('You already own one');
    if (this.eco.getMoney() < def.price) return fail('Not enough money');
    this.eco.pay(-def.price, `${def.name} from ${shop.name}`, 'vehicles');
    this.ctx.state.ownedVehicles.push(type);
    if (def.insurance) this.ctx.state.economy.insured = true;
    try { this._spawnNear(type, shop.x, shop.y, { owned: true }); } catch (err) { console.warn('buy spawn failed', err); }
    bus.emit(ECON_EV.VEHICLE_BOUGHT, { type, price: def.price, shop: shop.name });
    pager(`Bought a ${def.name.toLowerCase()} from ${shop.name} for ${kr(def.price)}. It is parked outside; from now on it waits at your door.${def.insurance ? ` Insurance ${kr(def.insurance)}/week.` : ''}`, 'info', shop.name);
    bus.emit(EV.REQUEST_SAVE, {});
    return { ok: true };
  }

  rent(shopId, type, days = 1) {
    const fail = (reason) => { bus.emit(ECON_EV.BUY_FAILED, { id: type, reason }); return { ok: false, reason }; };
    const shop = this.getShop(shopId), def = VEHICLES[type];
    days = Math.max(1, Math.min(FLEET_TUNING.maxRentDays, Math.round(days) || 1));
    if (!shop || !def || !(shop.rent || []).includes(type)) return fail('Not for rent here');
    const block = this._licenceBlock(type);
    if (block) return fail(block);
    const price = def.rentPerDay * days;
    if (this.eco.getMoney() < price) return fail('Not enough money');
    this.eco.pay(-price, `rental: ${def.name}`, 'vehicles');
    const e = this.ctx.state.economy, clock = e.clock;
    let r = this._rentalOf(type);
    if (r && this._liveVehicle(r)) {
      r.endsAt += days * MIN_PER_DAY;
      r.warned = false;
    } else {
      if (r) e.rentals.splice(e.rentals.indexOf(r), 1);
      r = { uid: e.rentalSeq++, type, endsAt: clock + days * MIN_PER_DAY, shop: shop.name, warned: false };
      e.rentals.push(r);
      try { const v = this._spawnNear(type, shop.x, shop.y, { rentedBy: 'player' }); v._rentalUid = r.uid; } catch (err) { console.warn('rent spawn failed', err); }
    }
    bus.emit(ECON_EV.VEHICLE_RENTED, { type, days, price, shop: shop.name, endsAt: r.endsAt });
    pager(`Rented a ${def.name.toLowerCase()} for ${days} day${days > 1 ? 's' : ''} (${kr(price)}). It is waiting outside ${shop.name} and goes back automatically when the rental ends.`, 'info', shop.name);
    return { ok: true };
  }

  _liveVehicle(r) { return this.ctx.vehicles.find((v) => v._rentalUid === r.uid && !v.destroyed) || null; }

  getRentals() {
    const clock = this.ctx.state.economy.clock;
    return this.ctx.state.economy.rentals.map((r) => ({ ...r, name: VEHICLES[r.type]?.name || r.type, minutesLeft: Math.max(0, Math.round(r.endsAt - clock)) }));
  }

  // ------------------------------------------------------------ repair
  _repairTarget() {
    const p = this.ctx.player;
    let best = null, bd = FLEET_TUNING.repairRangeM * PX;
    for (const v of this.ctx.vehicles) {
      if (v.destroyed || !(v.owned || v.rentedBy === 'player')) continue;
      if (v.state !== 'ok' && v.state !== 'broken') continue;
      const d = Math.hypot(v.x - p.px, v.y - p.py);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  repairQuote() {
    const v = this._repairTarget();
    if (!v) return null;
    const missing = Math.max(0, v.maxHealth - v.health);
    const factor = this.ctx.state.economy.insured && v.owned ? FLEET_TUNING.insuredRepairFactor : 1;
    return { vehicle: v, name: v.def.name, missing: Math.round(missing), cost: Math.ceil(missing * FLEET_TUNING.repairPerHp * factor), insured: factor < 1 };
  }

  repair() {
    const q = this.repairQuote();
    if (!q) return { ok: false, reason: 'No vehicle of yours nearby' };
    if (q.cost <= 0) return { ok: false, reason: 'Nothing to repair' };
    if (this.eco.getMoney() < q.cost) return { ok: false, reason: 'Not enough money' };
    this.eco.pay(-q.cost, `repair: ${q.name}`, 'vehicles');
    q.vehicle.repair();
    bus.emit(ECON_EV.VEHICLE_REPAIRED, { type: q.vehicle.type, cost: q.cost });
    pager(`${q.name} repaired for ${kr(q.cost)}${q.insured ? ' (insurance discount)' : ''}.`, 'info');
    return { ok: true, cost: q.cost };
  }

  // ------------------------------------------------------------ garage
  _slot(i) {
    const h = this.ctx.home, ang = h.angle + Math.PI / 2;
    const spot = this.ctx.world.findFreeSpot(h.parkX + Math.cos(ang) * i * 2.4 * PX, h.parkY + Math.sin(ang) * i * 2.4 * PX, 120) || { x: h.parkX, y: h.parkY };
    return { x: spot.x, y: spot.y, angle: ang };
  }

  /** Owned types and running rentals with their live vehicle (or null). */
  getGarage() {
    const home = this.ctx.home, p = this.ctx.player, list = [];
    const dist = (v) => (v && home ? Math.round(Math.hypot(v.x - home.x, v.y - home.y) / PX) : null);
    this.ctx.state.ownedVehicles.forEach((type) => {
      if (!VEHICLES[type]) return;
      const v = this.ctx.vehicles.find((o) => o.owned && o.type === type && !o.destroyed && o.state !== 'sunk');
      list.push({ key: `own:${type}`, type, name: VEHICLES[type].name, kind: 'owned', vehicle: v || null, distanceM: dist(v), driving: p.vehicle === v });
    });
    this.getRentals().forEach((r) => {
      const v = this._liveVehicle(r);
      list.push({ key: `rent:${r.uid}`, type: r.type, name: r.name, kind: 'rented', uid: r.uid, vehicle: v, distanceM: dist(v), minutesLeft: r.minutesLeft, driving: p.vehicle === v });
    });
    return list;
  }

  _place(v, slot) {
    if (this.ctx.player.vehicle === v) this.ctx.player.exitVehicle();
    v.x = slot.x; v.y = slot.y; v.angle = slot.angle; v.vx = 0; v.vy = 0; v.spin = 0;
    v.input = { throttle: 0, steer: 0, handbrake: true };
    v.sprite.setPosition(slot.x, slot.y).setRotation(slot.angle);
  }

  bringToDoor(key) {
    if (!this.ctx.home) return { ok: false, reason: 'No home' };
    const g = this.getGarage();
    const idx = g.findIndex((e) => e.key === key);
    const entry = g[idx];
    if (!entry) return { ok: false, reason: 'Vehicle not found' };
    let v = entry.vehicle;
    const slot = this._slot(idx);
    if (!v || (v.state !== 'ok' && v.state !== 'burning')) {
      if (v) this.ctx.removeVehicle(v);
      v = this.ctx.spawnVehicle(entry.type, slot.x, slot.y, { angle: slot.angle, owned: entry.kind === 'owned', rentedBy: entry.kind === 'rented' ? 'player' : null });
      if (entry.kind === 'rented') v._rentalUid = entry.uid;
    } else this._place(v, slot);
    return { ok: true };
  }

  bringAllHome() {
    this.getGarage().forEach((e) => this.bringToDoor(e.key));
  }

  // ------------------------------------------------------------ insurance
  insurancePremium() {
    const disc = this.eco.home?.cfg?.insuranceDiscount || 0;
    let sum = 0;
    for (const t of this.ctx.state.ownedVehicles) sum += VEHICLES[t]?.insurance || 0;
    return Math.round(sum * (1 - disc));
  }

  // ------------------------------------------------------------ rentals loop
  update() {
    const e = this.ctx.state.economy;
    if (!this._respawned) {
      this._respawned = true;
      const owned = this.ctx.state.ownedVehicles.length;
      e.rentals.forEach((r, i) => {
        if (r.endsAt <= e.clock || this._liveVehicle(r) || !this.ctx.home) return;
        const slot = this._slot(owned + i);
        const v = this.ctx.spawnVehicle(r.type, slot.x, slot.y, { angle: slot.angle, rentedBy: 'player' });
        v._rentalUid = r.uid;
      });
    }
    for (let i = e.rentals.length - 1; i >= 0; i--) {
      const r = e.rentals[i];
      const left = r.endsAt - e.clock;
      if (left <= 0) {
        const v = this._liveVehicle(r);
        if (v) this.ctx.removeVehicle(v);
        e.rentals.splice(i, 1);
        bus.emit(ECON_EV.RENTAL_ENDED, { type: r.type, shop: r.shop });
        pager(`Your rented ${VEHICLES[r.type]?.name.toLowerCase() || r.type} was returned to ${r.shop}. Rent it again any time.`, 'info', r.shop);
      } else if (left <= 60 && !r.warned) {
        r.warned = true;
        pager(`Your rented ${VEHICLES[r.type]?.name.toLowerCase() || r.type} must be back at ${r.shop} in about an hour. It returns by itself.`, 'warn', r.shop);
      }
    }
  }
}
