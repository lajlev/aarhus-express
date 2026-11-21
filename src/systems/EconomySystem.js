/**
 * EconomySystem: money, shop, Life Quality (LQ), skills.   OWNER: economy specialist
 *
 * ===================== PUBLIC API (ctx.systems.economy) =====================
 * Money (single writer of state.money; others emit EV.REQUEST_PAY { amount, reason })
 *   getMoney()                   -> number (DKK)
 *   pay(amount, reason)          -> applies delta, floor 0, emits EV.MONEY_CHANGED { money, delta, reason }
 *   canAfford(amount)            -> bool
 * Shop
 *   getShopItems()               -> [{ id, name, desc, tier 1..4, at (landmark id), venueName, price,
 *                                      baseLq, lqGain (LQ you'd get now, incl. diminishing + nearby bonus),
 *                                      count (times bought), max|null, cooldownLeft (in-game min, 0 = ready),
 *                                      cooldown (full, min), nearVenue (bool), distanceM (to venue or null),
 *                                      grants, affordable, available (false if max/cooldown), reason ('' | text) }]
 *   buy(id)                      -> { ok, reason?, lqGained?, item?, near? }
 *   nearVenue(landmarkId, radiusM = 60) -> bool (uses player px/py vs landmark real location lx/ly)
 *   NEAR VENUE RULE: buying works from the overlay anywhere; if the player stands within 60 m
 *   of the venue the LQ gain is x1.5 ("on site bonus") and the item shows nearVenue:true.
 * Life Quality
 *   getLQ()                      -> number
 *   getLQProgress()              -> { lq, milestonesReached, prev, next, t (0..1 toward next milestone) }
 *   lqThreshold(n)               -> LQ needed for milestone n = 40n + 10n^2 (50,120,210,320,450 ...)
 *   Each milestone grants 1 skill point (2 every 5th). LQ decays 1 per in-game day (gentle),
 *   never below the last reached milestone threshold.
 * Skills
 *   getSkillPoints()             -> number
 *   getSkills()                  -> [{ id, name, desc, level (bought), bonus (character), effective, max,
 *                                      cost (points for next level or null), canUpgrade, effects }]
 *   upgradeSkill(id)             -> { ok, reason?, level? }   (costs SKILL_COSTS = 1,1,2,2,3 points)
 *   getMultiplier(skill)         -> primary multiplier (uses skillLevel(): bought + character bonus):
 *                                   driving=topSpeed, stamina=runSpeed, charm=payout,
 *                                   streetSmarts=heatGain, navigation=timeLimit
 *   getEffects()                 -> { topSpeed, handling, runSpeed, maxHealth, payout, tips,
 *                                      heatGain, heatDecay, timeLimit }  all multipliers, 1 = no effect
 *   scalePayout(amount)          -> Math.round(amount * payout)   (missions: call before REQUEST_PAY)
 *   Effect per level: driving +4% top speed/+5% handling; stamina +4% run/+6% max health;
 *   charm +6% payout/+10% tips; streetSmarts -8% heat gain (floor 0.4)/+12% heat decay;
 *   navigation +7% time limit.  See economy/skills.js SKILL_EFFECTS.
 * Bills / loans: economy.bills (issue, pay, payAll, total, garnish, ...) and economy.loans (take, settle, quote, ...), see economy/Bills.js and
 *   economy/Loans.js. Police fines are bills, not instant charges; job payouts are garnished 30% while a debt is in collection.
 * Clock: getClock() -> { minutes, day, hour }  (1 real second of play = 1 in-game minute).
 *
 * Events listened: EV.REQUEST_PAY, EV.PLAYER_DIED (hospital bill 150 + 10% of money, capped at money)
 *   (busted fines are charged by the police via REQUEST_PAY, not on EV.BUSTED, to avoid double charge)
 * Events emitted: EV.MONEY_CHANGED, EV.LQ_CHANGED { lq, delta }, EV.SKILL_POINT { skillPoints },
 *   EV.SKILL_UPGRADED { skill, level }, EV.PURCHASED { item, count }, EV.PAGER, EV.BANNER,
 *   ECON_EV.MILESTONE, ECON_EV.BUY_FAILED, ECON_EV.LQ_DECAY (see economy/events.js)
 * HOME & VEHICLES (new): see systems/economy/HomeService.js (rent, sleep, housing: `economy.home`) and
 *   systems/economy/vehicles/VehicleService.js (shops, buy/rent/repair, garage, insurance: `economy.fleet`).
 *   economy.home.getInfo() / payRent() / sleep() / moveTo(tier)
 *   economy.fleet.getShops() / getOffers(shop) / buy(shopId, type) / rent(shopId, type, days) / repair() / getGarage() / bringToDoor(key)
 *   economy.getWeeklySummary()   -> { weekStartDay, income, spent{rent,insurance,vehicles,fun,other}, totalSpent, net, upcoming{...}, lastWeek }
 *   economy.getMapPOIs()         -> [{ kind: 'home'|'bicycle'|'bikeRental'|'rental'|'dealer', name, x, y }]   (HUD minimap can draw these)
 *   economy.licenceStatus()      -> { banned, until? }   (from 'police:licence', defensive)
 *   economy.advanceClock(min)    -> skips time (sleep), running every day tick on the way
 *   economy.activeShop           -> the shop the Dealer overlay shows (set before OPEN_OVERLAY mode 'dealer')
 *   E at the home door or a shop pad opens the Home / Dealer overlay (see _pressE; vehicles you can get into win when nearer).
 *   Extra events (economy/events.js): rentDue, rentPaid, rentLate, slept, moved, week, vehicleBought, vehicleRented, rentalEnded, ...
 * State: money, lq, skillPoints, milestonesReached, skills, purchases, ownedVehicles, stats.earned,
 *   plus state.economy = { clock (in-game minutes), cooldowns: { itemId: minute it becomes ready } }
 *   (created lazily; survives save/load because loadSave spreads unknown keys).
 */
import { listen, EV, bus, pager } from '../core/events.js';
import { skillLevel } from '../core/state.js';
import { opt } from '../core/options.js';
import { getShop } from '../data/shop.js';
import { SKILLS, SKILL_MAX, SKILL_INFO, SKILL_COSTS, SKILL_EFFECTS, PRIMARY } from './economy/skills.js';
import { ECON_EV, LICENCE_EV } from './economy/events.js';
import { HomeService, MIN_PER_DAY as MPD, WEEK_DAYS, dayName } from './economy/HomeService.js';
import { BillService } from './economy/Bills.js';
import { LoanService } from './economy/Loans.js';
import { NON_INCOME_PREFIXES } from '../data/finance.js';
import { VehicleService } from './economy/vehicles/VehicleService.js';
import { ShopMarkers } from './economy/vehicles/ShopMarkers.js';
import { PX } from '../config.js';

export const lqThreshold = (n) => (n <= 0 ? 0 : 40 * n + 10 * n * n);

const MIN_PER_DAY = MPD;
const NEW_GAME_START_MIN = 8 * 60; // a new game starts Monday 08:00
const INTERACT_R = 3.2 * PX; // how close you must stand to the home door or a shop pad
const DOOR_PRIORITY_M = 1.2 * PX; // door/shop beats an owned vehicle unless the vehicle is this much closer
const NEAR_M = 60;
const NEAR_BONUS = 1.5;
const DIMINISH = 0.6; // each repeat buy yields DIMINISH^count of the base LQ, min 10%
const DIMINISH_MIN = 0.1;
const DECAY_PER_DAY = 1;

export class EconomySystem {
  constructor(ctx) {
    this.ctx = ctx;
    const st = ctx.state;
    if (!st.economy) st.economy = { clock: NEW_GAME_START_MIN, cooldowns: {} };
    st.economy.cooldowns ||= {};
    st.economy.clock ||= 0;
    st.ownedVehicles ||= [];
    this.items = getShop(ctx.city?.id || st.cityId);
    this._lastDay = Math.floor(st.economy.clock / MIN_PER_DAY);
    this._clockAcc = 0;
    this._lastHour = Math.floor(st.economy.clock / 60);
    const wk = st.economy.week;
    if (!wk) st.economy.week = { startDay: Math.floor(this._lastDay / WEEK_DAYS) * WEEK_DAYS, earned: 0, spent: {} };
    this.bills = new BillService(ctx, this);
    this.loans = new LoanService(ctx, this);
    this.home = new HomeService(ctx, this);
    this.fleet = new VehicleService(ctx, this);
    this.activeShop = null;
    this.licence = { banned: false, until: null };
    this._promptShown = null;
    this._seenGamePrompt = undefined;
    this.markers = ctx.world ? new ShopMarkers(ctx.scene, this.fleet.getShops()) : null;
    this._onE = (ev) => { if (!ev?.repeat) this._pressE(); };
    ctx.scene.input.keyboard?.on('keydown-E', this._onE);
    listen(ctx.scene, LICENCE_EV, (e) => this._onLicence(e));
    listen(ctx.scene, EV.OVERLAY_CLOSED, () => { ctx.player?.keys?.enter?.reset?.(); });
    listen(ctx.scene, EV.REQUEST_PAY, ({ amount, reason }) => this._onRequestPay(amount, reason));
    listen(ctx.scene, EV.PLAYER_DIED, () => {
      const m = this.ctx.state.money;
      const bill = Math.min(m, 150 + Math.round(m * 0.1));
      if (bill > 0) {
        this.pay(-bill, 'hospital bill');
        pager(`Hospital bill: ${bill} kr`, 'warn');
      }
    });
    // catch up: ensure milestones are consistent with loaded lq
    this._checkMilestones(false);
    this.home.onStart();
  }

  // ---------------------------------------------------------------- money
  getMoney() { return this.ctx.state.money; }
  canAfford(amount) { return this.ctx.state.money >= amount; }

  /** cat (optional spending category for the weekly summary): rent|insurance|vehicles|fun|other (fines/tow count as other). */
  pay(amount, reason = '', cat, opts) {
    const st = this.ctx.state;
    amount = Math.round(Number(amount) || 0);
    if (!amount) return;
    const income = opts?.income !== false; // false: loan money / refunds, not earnings (stats.earned, weekly income)
    const before = st.money;
    if (opt('infiniteMoney')) { // payments never lower the balance; income still adds up and every event/pager line stays the same
      if (st.money < 9e8) st.money = 1e9;
      if (amount < 0) {
        const wk0 = st.economy.week;
        if (wk0) { const c = cat || 'other'; wk0.spent[c] = (wk0.spent[c] || 0) - amount; }
        bus.emit(EV.MONEY_CHANGED, { money: st.money, delta: amount, reason });
        return;
      }
    }
    st.money = Math.max(0, before + amount);
    const delta = st.money - before;
    if (delta > 0 && income) st.stats.earned += delta;
    const wk = st.economy.week;
    if (wk) {
      if (delta > 0) { if (income) wk.earned += delta; }
      else if (delta < 0) { const c = cat || 'other'; wk.spent[c] = (wk.spent[c] || 0) - delta; }
    }
    bus.emit(EV.MONEY_CHANGED, { money: st.money, delta, reason });
  }

  /** REQUEST_PAY handler: job income (positive, not a loan/gambling reason) is garnished while a debt is in collection. */
  _onRequestPay(amount, reason) {
    if (amount > 0 && this.bills.collecting() && !NON_INCOME_PREFIXES.some((p) => String(reason || '').startsWith(p))) {
      const { net, cut } = this.bills.garnish(amount);
      if (cut > 0) {
        this.pay(net, reason);
        return;
      }
    }
    this.pay(amount, reason);
  }

  // ---------------------------------------------------------------- clock
  getClock() {
    const m = this.ctx.state.economy.clock;
    return { minutes: m, day: Math.floor(m / MIN_PER_DAY), hour: Math.floor((m % MIN_PER_DAY) / 60) };
  }

  // ---------------------------------------------------------------- LQ
  getLQ() { return this.ctx.state.lq; }
  lqThreshold(n) { return lqThreshold(n); }

  getLQProgress() {
    const st = this.ctx.state;
    const n = st.milestonesReached;
    const prev = lqThreshold(n), next = lqThreshold(n + 1);
    return { lq: st.lq, milestonesReached: n, prev, next, t: Math.max(0, Math.min(1, (st.lq - prev) / (next - prev))) };
  }

  addLQ(delta) {
    const st = this.ctx.state;
    const before = st.lq;
    st.lq = Math.max(lqThreshold(st.milestonesReached), Math.round((st.lq + delta) * 10) / 10);
    const d = st.lq - before;
    if (d) bus.emit(EV.LQ_CHANGED, { lq: st.lq, delta: d });
    if (d > 0) this._checkMilestones(true);
    return d;
  }

  _checkMilestones(announce) {
    const st = this.ctx.state;
    while (st.lq >= lqThreshold(st.milestonesReached + 1)) {
      st.milestonesReached += 1;
      const n = st.milestonesReached;
      const gained = n % 5 === 0 ? 2 : 1;
      st.skillPoints += gained;
      if (announce) {
        bus.emit(ECON_EV.MILESTONE, { n, lq: st.lq, skillPointsGained: gained, skillPoints: st.skillPoints });
        bus.emit(EV.SKILL_POINT, { skillPoints: st.skillPoints });
        bus.emit(EV.BANNER, { text: `Life Quality milestone ${n}: +${gained} skill point${gained > 1 ? 's' : ''}`, color: '#7bd88f', ms: 2600 });
        pager(`Life Quality ${Math.floor(st.lq)}. You earned ${gained} skill point${gained > 1 ? 's' : ''} [K]`, 'info');
      }
    }
  }

  // ---------------------------------------------------------------- shop
  _landmark(id) { return this.ctx.world?.landmark?.(id) || null; }

  _distanceM(id) {
    const lm = this._landmark(id), p = this.ctx.player;
    if (!lm || !p) return null;
    const x = lm.lx ?? lm.x, y = lm.ly ?? lm.y;
    return Math.hypot(p.px - x, p.py - y) / 8; // PX = 8 px per metre
  }

  nearVenue(landmarkId, radiusM = NEAR_M) {
    const d = this._distanceM(landmarkId);
    return d !== null && d <= radiusM;
  }

  _lqFor(item, near, count = this.ctx.state.purchases[item.id] || 0) {
    const f = Math.max(DIMINISH_MIN, Math.pow(DIMINISH, count));
    return Math.round(item.lq * f * (near ? NEAR_BONUS : 1) * 10) / 10;
  }

  _cooldownLeft(item) {
    const e = this.ctx.state.economy;
    const ready = e.cooldowns[item.id] || 0;
    return Math.max(0, Math.ceil(ready - e.clock));
  }

  _status(item) {
    const st = this.ctx.state;
    const count = st.purchases[item.id] || 0;
    const near = this.nearVenue(item.at);
    const cooldownLeft = this._cooldownLeft(item);
    const affordable = st.money >= item.price;
    let reason = '';
    if (item.max && count >= item.max) reason = 'Already owned';
    else if (cooldownLeft > 0) reason = `Available again in ${cooldownLeft} min`;
    else if (!affordable) reason = 'Not enough money';
    return { count, near, cooldownLeft, affordable, available: !reason, reason };
  }

  getShopItems() {
    return this.items.map((item) => {
      const s = this._status(item);
      const lm = this._landmark(item.at);
      const d = this._distanceM(item.at);
      return {
        id: item.id, name: item.name, desc: item.desc || '', tier: item.tier || 1, at: item.at,
        venueName: lm?.n || item.at, price: item.price, baseLq: item.lq, lqGain: this._lqFor(item, s.near),
        count: s.count, max: item.max || null, cooldown: item.cooldown || 0, cooldownLeft: s.cooldownLeft,
        nearVenue: s.near, distanceM: d === null ? null : Math.round(d), grants: item.grants || null,
        affordable: s.affordable, available: s.available, reason: s.reason,
      };
    });
  }

  buy(id) {
    const fail = (reason) => { bus.emit(ECON_EV.BUY_FAILED, { id, reason }); return { ok: false, reason }; };
    const item = this.items.find((i) => i.id === id);
    if (!item) return fail('Unknown item');
    const st = this.ctx.state;
    const s = this._status(item);
    if (!s.available) return fail(s.reason);
    this.pay(-item.price, item.name, 'fun');
    st.purchases[id] = s.count + 1;
    if (item.cooldown) st.economy.cooldowns[id] = st.economy.clock + item.cooldown;
    const gain = this._lqFor(item, s.near, s.count);
    this.addLQ(gain);
    this._grant(item);
    bus.emit(EV.PURCHASED, { item: { ...item }, count: st.purchases[id] });
    pager(`${item.name}: +${gain} LQ${s.near ? ' (on-site bonus)' : ''}`, 'info');
    return { ok: true, lqGained: gain, item: { ...item }, near: s.near };
  }

  _grant(item) {
    const v = item.grants?.vehicle;
    if (!v) return;
    const st = this.ctx.state;
    if (!st.ownedVehicles.includes(v)) st.ownedVehicles.push(v);
    const { player, world } = this.ctx;
    try {
      if (player && this.ctx.spawnVehicle) {
        const spot = world.findFreeSpot(player.px + 40, player.py + 24, 160) || { x: player.px, y: player.py };
        this.ctx.spawnVehicle(v, spot.x, spot.y, { owned: true });
      }
    } catch (err) { console.warn('grant spawn failed', err); }
  }

  // ---------------------------------------------------------------- skills
  getSkillPoints() { return this.ctx.state.skillPoints; }

  _cost(level) { return level >= SKILL_MAX ? null : SKILL_COSTS[Math.min(level, SKILL_COSTS.length - 1)]; }

  getSkills() {
    const st = this.ctx.state;
    return SKILLS.map((id) => {
      const level = st.skills[id] || 0;
      const eff = skillLevel(st, id);
      const cost = this._cost(level);
      return {
        id, name: SKILL_INFO[id].name, desc: SKILL_INFO[id].desc, level, bonus: eff - level,
        effective: eff, max: SKILL_MAX, cost, canUpgrade: cost !== null && st.skillPoints >= cost,
        effects: this._effectsFor(id, eff),
      };
    });
  }

  upgradeSkill(id) {
    const st = this.ctx.state;
    if (!SKILLS.includes(id)) return { ok: false, reason: 'Unknown skill' };
    const level = st.skills[id] || 0;
    const cost = this._cost(level);
    if (cost === null) return { ok: false, reason: 'Already at max level' };
    if (st.skillPoints < cost) return { ok: false, reason: `Needs ${cost} skill point${cost > 1 ? 's' : ''}` };
    st.skillPoints -= cost;
    st.skills[id] = level + 1;
    bus.emit(EV.SKILL_UPGRADED, { skill: id, level: st.skills[id] });
    bus.emit(EV.SKILL_POINT, { skillPoints: st.skillPoints });
    return { ok: true, level: st.skills[id] };
  }

  _effectsFor(id, lvl) {
    const out = {};
    for (const [k, v] of Object.entries(SKILL_EFFECTS[id])) {
      out[k] = k === 'heatGain' ? Math.max(0.4, 1 + lvl * v) : 1 + lvl * v;
    }
    return out;
  }

  getMultiplier(skill) {
    if (!SKILL_EFFECTS[skill]) return 1;
    return this._effectsFor(skill, skillLevel(this.ctx.state, skill))[PRIMARY[skill]];
  }

  getEffects() {
    const st = this.ctx.state;
    const out = {};
    for (const id of SKILLS) Object.assign(out, this._effectsFor(id, skillLevel(st, id)));
    return out;
  }

  scalePayout(amount) { return Math.round(amount * this.getMultiplier('charm')); }

  // ---------------------------------------------------------------- loop
  update(dt) {
    const e = this.ctx.state.economy;
    e.clock += dt; // 1 real second = 1 in-game minute
    this._syncClock();
    this.fleet.update();
    this._updateInteract();
  }

  /** Skip time (sleep). Runs every day/hour tick on the way. */
  advanceClock(minutes) {
    this.ctx.state.economy.clock += Math.max(0, minutes);
    this._syncClock();
  }

  _syncClock() {
    const e = this.ctx.state.economy;
    const hour = Math.floor(e.clock / 60);
    const day = Math.floor(e.clock / MIN_PER_DAY);
    while (this._lastDay < day) { this._lastDay++; this._lastHour = this._lastDay * 24; this._onDay(this._lastDay); }
    if (hour > this._lastHour) { this._lastHour = hour; this.home.onHour(); this.loans.onHour(); }
  }

  _onDay(d) {
    const st = this.ctx.state;
    const floor = lqThreshold(st.milestonesReached);
    const loss = Math.min(DECAY_PER_DAY, Math.max(0, st.lq - floor));
    if (loss > 0) {
      st.lq -= loss;
      bus.emit(EV.LQ_CHANGED, { lq: st.lq, delta: -loss });
      bus.emit(ECON_EV.LQ_DECAY, { lq: st.lq, delta: -loss });
    }
    const weekStart = d % WEEK_DAYS === 0 && d > 0;
    if (weekStart) this._closeWeek(d);
    this.home.onDay(d);
    this.loans.onDay(d);
    this.bills.onDay(d);
    if (weekStart) this._insurance();
  }

  _insurance() {
    const e = this.ctx.state.economy, premium = this.fleet.insurancePremium();
    if (premium <= 0) { e.insured = true; return; }
    if (this.getMoney() >= premium) {
      this.pay(-premium, 'insurance', 'insurance');
      e.insured = true;
      pager(`Insurance debited: kr ${premium.toLocaleString('da-DK')} for your vehicles this week.`, 'info', 'Insurance');
    } else {
      e.insured = false;
      pager(`Insurance lapsed: you could not afford kr ${premium.toLocaleString('da-DK')}. Repairs cost double until you can pay next Monday.`, 'warn', 'Insurance');
    }
    bus.emit(ECON_EV.INSURANCE, { premium, paid: e.insured });
  }

  _closeWeek(d) {
    const e = this.ctx.state.economy;
    const sum = this.getWeeklySummary();
    e.lastWeek = { income: sum.income, spent: sum.spent, totalSpent: sum.totalSpent, net: sum.net, weekStartDay: sum.weekStartDay };
    const kr = (n) => `kr ${Math.round(n).toLocaleString('da-DK')}`;
    const sp = sum.spent;
    pager(`Week ${Math.floor(sum.weekStartDay / WEEK_DAYS) + 1}: earned ${kr(sum.income)}, spent ${kr(sum.totalSpent)} (rent ${kr(sp.rent || 0)}, insurance ${kr(sp.insurance || 0)}). Net ${sum.net >= 0 ? '+' : '-'}${kr(Math.abs(sum.net))}.`, sum.net >= 0 ? 'info' : 'warn', 'Weekly summary');
    bus.emit(ECON_EV.WEEK, { summary: e.lastWeek });
    e.week = { startDay: d, earned: 0, spent: {} };
  }

  getWeeklySummary() {
    const e = this.ctx.state.economy, wk = e.week || { startDay: 0, earned: 0, spent: {} };
    const spent = { rent: 0, insurance: 0, vehicles: 0, fun: 0, other: 0, ...wk.spent };
    const totalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
    const h = this.ctx.state.home;
    return {
      weekStartDay: wk.startDay, income: wk.earned, spent, totalSpent, net: wk.earned - totalSpent,
      billsOwed: this.bills.total(), upcoming: { rent: h.rentPerWeek, rentDay: h.paidUntilDay, rentLabel: dayName(h.paidUntilDay), insurance: this.fleet.insurancePremium() },
      lastWeek: e.lastWeek || null,
    };
  }

  // ---------------------------------------------------------------- licence (defensive: 'police:licence')
  _onLicence(e) {
    if (!e || typeof e !== 'object') return;
    const flag = e.banned ?? e.suspended ?? e.active;
    this.licence = { banned: !!flag, until: e.until ?? null };
    if (flag) pager('Your driving licence is suspended. Car dealers and rentals will not serve you.', 'warn');
  }

  licenceStatus() {
    const st = this.ctx.state;
    const extra = st.licence?.banned || st.police?.licenceBanned || false;
    return { banned: !!(this.licence.banned || extra), until: this.licence.until };
  }

  // ---------------------------------------------------------------- map data for HUD / overlay
  getMapPOIs() {
    const out = this.fleet.getShops().map((s) => ({ kind: s.kind, name: s.name, x: s.x, y: s.y }));
    const h = this.ctx.home;
    if (h) out.push({ kind: 'home', name: 'Home', x: h.x, y: h.y });
    return out;
  }

  // ---------------------------------------------------------------- interaction (E at the home door / shop pads)
  _nearest() {
    const p = this.ctx.player;
    if (!p || p.dead || p.vehicle) return null;
    const px = p.x, py = p.y;
    let best = null, bd = INTERACT_R;
    const h = this.ctx.home;
    if (h) { const d = Math.hypot(h.x - px, h.y - py); if (d < bd) { bd = d; best = { kind: 'home', d }; } }
    for (const s of this.fleet.getShops()) {
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bd) { bd = d; best = { kind: 'shop', shop: s, d }; }
    }
    if (!best) return null;
    // an owned / rented vehicle clearly closer than the pad wins the E key (Player.tryEnter handles it)
    const v = p.nearestVehicle(this.ctx.vehicles);
    if (v && (v.owned || v.rentedBy === 'player' || v.jobVehicle)) {
      const gap = Math.hypot(v.x - px, v.y - py) - v.len / 2;
      if (gap + DOOR_PRIORITY_M < best.d) return null;
    }
    return best;
  }

  _promptFor(n) {
    if (n.kind === 'home') {
      const stage = this.home.stage();
      return stage === 'ok' ? '[E] Home: sleep, rent, garage' : '[E] Home: rent is overdue';
    }
    return `[E] ${n.shop.name}: ${n.shop.label.toLowerCase()}`;
  }

  _updateInteract() {
    const n = this._nearest();
    const sc = this.ctx.scene;
    if (n) {
      const text = this._promptFor(n);
      if (text !== this._promptShown || sc.lastPrompt !== this._seenGamePrompt) {
        this._promptShown = text;
        this._seenGamePrompt = sc.lastPrompt;
        bus.emit(EV.PROMPT, { text });
      }
    } else if (this._promptShown) {
      this._promptShown = null;
      bus.emit(EV.PROMPT, { text: sc.lastPrompt ?? null }); // hand the prompt back to GameScene
    }
  }

  _pressE() {
    const n = this._nearest();
    if (!n) return;
    const sc = this.ctx.scene;
    if (sc.scene.isActive('Overlay') || sc.scene.isActive('JobApp') || sc.scene.isActive('Gamble') || !sc.scene.isActive()) return;
    this.ctx.player.keys.enter.reset(); // consume this E press so Player does not also enter/exit a vehicle
    if (n.kind === 'home') { bus.emit(EV.OPEN_OVERLAY, { mode: 'home' }); return; }
    this.activeShop = n.shop;
    bus.emit(EV.OPEN_OVERLAY, { mode: 'dealer' });
  }

  destroy() {
    this.ctx.scene.input?.keyboard?.off('keydown-E', this._onE);
    this.markers?.destroy();
  }
}
