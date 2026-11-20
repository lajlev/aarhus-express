// Careers manager: courier, taxi and bus driver. OWNER: JOBS specialist.
//
// Public API (ctx.systems.missions.careers), used by scenes/JobAppScene.js:
//   courier.offers [{ id, from:{name,x,y}, to:{name,street,x,y}, item, size, fragile, metres, reward, life }], courier.rating (1..5),
//     courier.accept(id) -> { ok, reason? }, courier.decline(id), courier.pickupMetres(offer)
//   taxi.signed, taxi.signUp(), taxi.startShift() -> { ok, reason? }, taxi.endShift(), taxi.shift (or null)
//   bus.signed,  bus.signUp(), bus.routes(), bus.startShift(routeIdx) -> { ok, reason? }, bus.endShift(), bus.shift (or null), bus.aheadBehind()
//   abortShift(reason) -> bool (ends any running shift with that reason; used when the shift vehicle breaks down)
//   levelInfo(career) -> { level, xp, base, next, frac };  shiftActive();  summary()
// State: state.jobs = { courier: { xp, rating, scores, decisions, done, failed, declined, earned },
//                       taxi: { signed, xp, shifts, fares, earned, best }, bus: { signed, xp, shifts, stops, earned, punctual } } (saved).
// Events: JOBS_EV.* in systems/missions/events.js.
import { listen, EV } from '../../../core/events.js';
import { ensureJobsState, levelInfo } from './shared.js';
import { POLICE_EV } from '../../police/tuning.js';
import { Courier } from './courier.js';
import { Taxi } from './taxi.js';
import { BusCareer } from './bus.js';

export class Careers {
  constructor(missions) {
    this.missions = missions;
    this.ctx = missions.ctx;
    ensureJobsState(this.ctx.state);
    this.courier = new Courier(this);
    this.taxi = new Taxi(this);
    this.bus = new BusCareer(this);
    listen(this.ctx.scene, POLICE_EV.TICKET, () => {
      const j = this.missions.job;
      if (j?.passenger && j.loaded) j.ticketed = true; // a fine in front of the passenger cuts the tip
    });
    listen(this.ctx.scene, EV.VEHICLE_DAMAGED, ({ vehicle, amount }) => {
      const j = this.missions.job;
      if (j?.career === 'courier' && j.loaded && vehicle === this.ctx.player.vehicle) this.courier.onDamaged(amount);
      if (this.bus.shift && vehicle === this.bus.shift.vehicle) this.bus.onDamaged(amount);
    });
  }

  levelInfo(career) { return levelInfo(this.ctx.state, career); }
  /** End the running taxi/bus shift from outside (e.g. the shift vehicle broke down). True if a shift ended. */
  abortShift(reason = 'shift ended') {
    if (this.taxi.shift) { this.taxi._finish(false, reason); return true; }
    if (this.bus.shift) { this.bus._finish(false, reason); return true; }
    return false;
  }
  shiftActive() { return !!(this.taxi.shift || this.bus.shift); }
  summary() { return { courier: this.ctx.state.jobs.courier, taxi: this.ctx.state.jobs.taxi, bus: this.ctx.state.jobs.bus, shift: this.taxi.shift || this.bus.shift || null }; }

  update(dt, time) {
    this.courier.update(dt);
    this.taxi.update(dt, time);
    this.bus.update(dt, time);
  }

  /** MissionSystem calls this when any job ended (success or failure). info: { frac, integ, payout, base, tip, reason }. */
  onJobEnd(j, ok, info) {
    this.courier.onJobEnd(j, ok, info);
    this.taxi.onJobEnd(j, ok, info);
    if (!ok && j.shift && j.career === 'bus') this.bus.externalEnd(info?.reason || 'shift failed');
  }

  targetPoint() { return this.taxi.targetPoint(); }
  draw(markers, time) { this.taxi.draw(markers, time); }
  destroy() {}
}
