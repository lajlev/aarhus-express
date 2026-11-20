/**
 * HomeService: rent, sleep and housing upgrades.   OWNER: HOME & VEHICLES specialist
 * Created by EconomySystem as `economy.home`. Everything is in IN-GAME DAYS of the economy clock.
 *
 * DAY SEMANTICS
 *   1 real second of play = 1 in-game minute; a day is 24 real minutes. clock 0 = Monday 00:00 (a new game starts at
 *   Monday 08:00). `day` = floor(clock / 1440); weeks start on day % 7 === 0 (Monday).
 *   state.home.paidUntilDay = the first day that is NOT paid: rent covers days [paidUntilDay - 7, paidUntilDay).
 *   Rent falls due at 00:00 of day `paidUntilDay`. The default save starts with paidUntilDay 7 (first week prepaid).
 *
 * RENT FLOW (forgiving)
 *   day before     pager reminder + economy:rentDue {stage:'reminder'}
 *   due (00:00)    economy:rentDue {stage:'due'}; if you can afford it, it is debited automatically (economy:rentPaid
 *                  {auto:true}), paidUntilDay += 7. Otherwise it becomes ARREARS: state.home.lateSince = dueDay.
 *   arrears        only ONE week of rent is ever owed (the rent does not pile up). Money is retried every in-game hour
 *                  (auto-pay as soon as you can afford it) and via the Pay rent button at home.
 *     days 0-1     'late'    grace period, friendly pager nudge (economy:rentLate {stage:'late'})
 *     days 2-3     'warning' final notice (stage:'warning')
 *     day 4+       'evicted' state.home.evicted = true: you are locked out. Sleep is disabled and LQ drops 3 per day
 *                  until you pay. The home door still opens, but only the Pay rent button works.
 *   paying late    pays one week and restarts the week on the next Monday at least 4 days away, clears arrears and eviction.
 *   rent paid      a tier with lqPerWeek gives that much LQ each paid week.
 *
 * SLEEP  skips to 07:00 of the next morning (processing every day that passes: rent, decay), restores health, saves
 *        and gives +2 LQ once per calendar day if you slept within the last 2 days (or never before).
 * UPGRADES  data/home.js HOME_TIERS (basement Trøjborg -> flat Frederiksbjerg -> harbour flat Aarhus Ø): moving costs
 *        a one-off fee, switches rent, re-resolves ctx.home (door, marker), teleports you there and brings your vehicles.
 */
import { bus, EV, pager } from '../../core/events.js';
import { getHomeTiers } from '../../data/home.js';
import { ECON_EV } from './events.js';
import { HomeMarker } from '../../world/HomeMarker.js';

export const MIN_PER_DAY = 1440;
export const WEEK_DAYS = 7;
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayName = (d) => DAY_NAMES[((d % 7) + 7) % 7];
export const HOME_TUNING = {
  graceDays: 2, // days 0..1 of arrears: 'late'
  evictDays: 4, // day 4+ of arrears: evicted
  evictLqPerDay: 3,
  morningHour: 7,
  sleepLq: 2,
  sleepRecentDays: 2,
};
const kr = (n) => `kr ${Math.round(n).toLocaleString('da-DK')}`;

export class HomeService {
  constructor(ctx, eco) {
    this.ctx = ctx;
    this.eco = eco;
    this.tiers = getHomeTiers(ctx.city?.id || ctx.state.cityId);
    const h = ctx.state.home || (ctx.state.home = { id: 'basement', rentPerWeek: 1200, paidUntilDay: 7 });
    h.tier ??= 0;
    if (!this.tiers[h.tier]) h.tier = 0;
    h.lateSince ??= null;
    h.evicted ??= false;
    h.remindedFor ??= null;
    const cfg = this.tiers[h.tier];
    if (cfg) { h.id = cfg.id; if (h.tier > 0 && !h.rentPerWeek) h.rentPerWeek = cfg.rentPerWeek; }
    this.h = h;
  }

  get cfg() { return this.tiers[this.h.tier] || this.tiers[0] || { name: 'Home', rentPerWeek: this.h.rentPerWeek, lqPerWeek: 0, parking: 0, insuranceDiscount: 0 }; }
  get rent() { return this.h.rentPerWeek; }
  get day() { return this.eco.getClock().day; }

  /** 'ok' | 'late' | 'warning' | 'evicted' */
  stage(day = this.day) {
    const h = this.h;
    if (h.lateSince == null) return 'ok';
    const late = day - h.lateSince;
    if (h.evicted || late >= HOME_TUNING.evictDays) return 'evicted';
    return late >= HOME_TUNING.graceDays ? 'warning' : 'late';
  }

  // ------------------------------------------------------------ day / hour ticks (called by EconomySystem)
  onStart() {
    if (this.day > this.h.paidUntilDay) this.h.paidUntilDay = this.day; // an old save far behind: forgive the gap, charge one week
    this.onDay(this.day, true);
  }

  onDay(d, quiet = false) {
    const h = this.h;
    if (h.lateSince == null) {
      if (d >= h.paidUntilDay) {
        bus.emit(ECON_EV.RENT_DUE, { amount: h.rentPerWeek, dueDay: h.paidUntilDay, stage: 'due' });
        if (this.eco.getMoney() >= h.rentPerWeek) this._charge(d, true, false);
        else this._fallBehind(d);
      } else if (d === h.paidUntilDay - 1 && h.remindedFor !== h.paidUntilDay) {
        h.remindedFor = h.paidUntilDay;
        bus.emit(ECON_EV.RENT_DUE, { amount: h.rentPerWeek, dueDay: h.paidUntilDay, stage: 'reminder' });
        if (!quiet) pager(`Rent reminder: ${kr(h.rentPerWeek)} is debited tomorrow at midnight (${dayName(h.paidUntilDay)}). Keep the money in your pocket.`, 'warn', 'Landlord');
      }
    } else {
      if (this.eco.getMoney() >= h.rentPerWeek) { this._charge(d, true, true); return; }
      this._escalate(d, quiet);
    }
    if (h.evicted) {
      const lost = this.eco.addLQ(-HOME_TUNING.evictLqPerDay);
      if (lost && !quiet) pager('Sleeping rough hurts: Life Quality dropped. Pay the rent to get your room back.', 'warn');
    }
  }

  onHour() {
    const h = this.h;
    if (h.lateSince != null && this.eco.getMoney() >= h.rentPerWeek) this._charge(this.day, true, true);
  }

  _fallBehind(d) {
    const h = this.h;
    h.lateSince = h.paidUntilDay;
    this._escalate(d, false);
  }

  _escalate(d, quiet) {
    const h = this.h;
    const daysLate = d - h.lateSince;
    const st = this.stage(d);
    if (st === 'evicted' && !h.evicted) {
      h.evicted = true;
      bus.emit(EV.BANNER, { text: 'LOCKED OUT: pay the rent', color: '#FF5A5F', ms: 3200 });
      if (!quiet) pager(`You are locked out of ${this.cfg.name}. Pay ${kr(h.rentPerWeek)} at the door to move back in.`, 'warn', 'Landlord');
    } else if (!quiet) {
      const left = HOME_TUNING.evictDays - daysLate;
      if (st === 'late') pager(`Your rent (${kr(h.rentPerWeek)}) is late. No rush: you have ${left} days before it gets serious. Pay at your door [E].`, 'warn', 'Landlord');
      else if (st === 'warning') pager(`Final notice: pay ${kr(h.rentPerWeek)} within ${left} day${left === 1 ? '' : 's'} or you lose the room.`, 'warn', 'Landlord');
    }
    bus.emit(ECON_EV.RENT_LATE, { amount: h.rentPerWeek, daysLate, stage: st });
  }

  _charge(d, auto, late) {
    const h = this.h;
    const amount = h.rentPerWeek;
    this.eco.pay(-amount, 'rent', 'rent');
    h.paidUntilDay = late ? this._nextMonday(d) : h.paidUntilDay + WEEK_DAYS;
    h.lateSince = null;
    h.evicted = false;
    h.remindedFor = null;
    const lq = this.cfg.lqPerWeek || 0;
    if (lq) this.eco.addLQ(lq);
    bus.emit(ECON_EV.RENT_PAID, { amount, paidUntilDay: h.paidUntilDay, auto, late });
    pager(`${auto ? 'Rent debited' : 'Rent paid'}: ${kr(amount)}. Covered until ${dayName(h.paidUntilDay)}, day ${h.paidUntilDay + 1}.${lq ? ` Cosy home: +${lq} LQ.` : ''}${late ? ' Thanks for catching up.' : ''}`, 'info', 'Landlord');
  }

  /** Paying late restarts the week on the next Monday that is at least 4 days away (keeps rent in step with the weekly summary). */
  _nextMonday(d) {
    let m = (Math.floor(d / WEEK_DAYS) + 1) * WEEK_DAYS;
    if (m - d < 4) m += WEEK_DAYS;
    return m;
  }

  // ------------------------------------------------------------ actions
  payRent() {
    const h = this.h, d = this.day;
    if (h.lateSince == null && h.paidUntilDay - d >= WEEK_DAYS) return { ok: false, reason: `Already paid until ${dayName(h.paidUntilDay)} (day ${h.paidUntilDay + 1})` };
    if (this.eco.getMoney() < h.rentPerWeek) return { ok: false, reason: `You need ${kr(h.rentPerWeek)}` };
    this._charge(d, false, h.lateSince != null);
    return { ok: true };
  }

  canSleep() {
    return this.h.evicted ? { ok: false, reason: 'Locked out: pay the rent first' } : { ok: true };
  }

  sleep() {
    const chk = this.canSleep();
    if (!chk.ok) return chk;
    const eco = this.eco, p = this.ctx.player, st = this.ctx.state;
    const c = eco.getClock();
    const targetDay = c.hour >= HOME_TUNING.morningHour ? c.day + 1 : c.day;
    const target = targetDay * MIN_PER_DAY + HOME_TUNING.morningHour * 60;
    eco.advanceClock(target - c.minutes);
    let healed = false;
    if (p && !p.dead && p.health < p.maxHealth) { p.health = p.maxHealth; healed = true; }
    const e = st.economy;
    const wake = this.day;
    let lq = 0;
    const last = e.lastWakeDay;
    if ((last == null || wake > last) && (last == null || wake - last <= HOME_TUNING.sleepRecentDays)) lq = eco.addLQ(HOME_TUNING.sleepLq);
    e.lastWakeDay = wake;
    bus.emit(ECON_EV.SLEPT, { day: wake, hour: HOME_TUNING.morningHour, lqGained: lq, healed });
    bus.emit(EV.BANNER, { text: `Good morning. ${dayName(wake)}, day ${wake + 1}`, color: '#F3EEE4', ms: 2600 });
    pager(`You slept well. It is ${dayName(wake)} morning.${lq ? ` Rested: +${lq} LQ.` : ''}${healed ? ' Health restored.' : ''} Game saved.`, 'info');
    bus.emit(EV.REQUEST_SAVE, {});
    return { ok: true, lqGained: lq, healed, day: wake };
  }

  // ------------------------------------------------------------ info for the overlay
  getInfo() {
    const h = this.h, d = this.day, cfg = this.cfg, stage = this.stage(d);
    return {
      tier: h.tier, name: cfg.name, area: cfg.area, blurb: cfg.blurb,
      street: this.ctx.home?.street || '', district: this.ctx.home?.district || '',
      rent: h.rentPerWeek, paidUntilDay: h.paidUntilDay, day: d, daysToDue: h.paidUntilDay - d,
      stage, evicted: !!h.evicted, lateSince: h.lateSince, lqPerWeek: cfg.lqPerWeek || 0, parking: cfg.parking || 0,
      insuranceDiscount: cfg.insuranceDiscount || 0,
      canPay: stage !== 'ok' || h.paidUntilDay - d < WEEK_DAYS,
      canSleep: this.canSleep(),
      upgrades: this.getUpgrades(),
    };
  }

  getUpgrades() {
    const h = this.h, money = this.eco.getMoney();
    return this.tiers.filter((t) => t.tier > h.tier).map((t) => {
      let reason = '';
      if (h.evicted || h.lateSince != null) reason = 'Settle your rent first';
      else if (money < t.moveCost) reason = `You need ${kr(t.moveCost)}`;
      return { tier: t.tier, name: t.name, area: t.area, blurb: t.blurb, rent: t.rentPerWeek, lqPerWeek: t.lqPerWeek, moveCost: t.moveCost, parking: t.parking, available: !reason, reason };
    });
  }

  moveTo(tier) {
    const up = this.getUpgrades().find((u) => u.tier === tier);
    if (!up) return { ok: false, reason: 'Not available' };
    if (!up.available) return { ok: false, reason: up.reason };
    const { world, home, state, scene, player } = this.ctx;
    const cfg = this.tiers[tier];
    const prevTier = this.h.tier;
    this.h.tier = tier; // getHomeConfig reads this
    const res = world.resolveHome({ ...cfg });
    if (!res || !home) { this.h.tier = prevTier; if (home) world.home = home; return { ok: false, reason: 'That flat is not available right now' }; }
    Object.assign(home, res);
    world.home = home;
    this.eco.pay(-cfg.moveCost, `moving to ${cfg.name}`, 'other');
    Object.assign(this.h, { id: cfg.id, tier, rentPerWeek: cfg.rentPerWeek, paidUntilDay: this._nextMonday(this.day), lateSince: null, evicted: false, remindedFor: null });
    // marker + player + vehicles follow the move
    try { scene.homeMarker?.destroy(); scene.homeMarker = new HomeMarker(scene, home); } catch (err) { console.warn('home marker', err); }
    if (player.vehicle) player.exitVehicle();
    player.x = home.x; player.y = home.y;
    player.sprite.setPosition(home.x, home.y);
    player.visual?.reset?.(home.x, home.y, player.angle);
    state.player.x = Math.round(home.x); state.player.y = Math.round(home.y);
    this.eco.fleet.bringAllHome();
    bus.emit(ECON_EV.MOVED, { tier, name: cfg.name, rent: cfg.rentPerWeek });
    bus.emit(EV.BANNER, { text: `Welcome to ${cfg.name}`, color: '#7bd88f', ms: 2800 });
    pager(`You moved to ${cfg.name} (${home.street || cfg.area}). Rent is ${kr(cfg.rentPerWeek)} a week, the first week is prepaid.`, 'info', 'Landlord');
    bus.emit(EV.REQUEST_SAVE, {});
    return { ok: true };
  }
}
