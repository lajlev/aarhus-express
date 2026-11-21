// Traffic-rules / fines module.   OWNER: TRAFFIC RULES & POLICE specialist.
//
// PoliceSystem constructs this once and calls `update(dt, time)` every frame, in EVERY game mode. In the default realistic game police
// have no heat/chases: they enforce traffic rules with fines ("boede"). In pursuit games (theft / criminalMissions) the same rules stay
// active and crimes still add heat through PoliceSystem as before.
//
// createTrafficRules(ctx) -> { update(dt, time), destroy(), getLicence(), isBanned(), cameraSpots() }
//
// Offences (see ./config.js RULES for every number):
//   redLight   player crosses a stop line (TrafficSignals approach) on red, above walking speed.      2,000 kr + 1 clip (bike 1,000, no clip)
//   speeding   measured by a fotovogn van (CameraVans) or seen by a patrol car (Patrols), graded by % over: 1,000-4,000 kr (+0-2 clips)
//   ramming    hitting an AI car 1,500 kr + 1 clip; a parked car / the fotovogn 600 kr
//   pavement   driving a car on a pavement / in a pedestrian zone at speed. 800 kr (patrol sees it after 1 s, otherwise a passer-by reports after 4 s)
//   wrongWay   driving against a one-way street.                                                      1,500 kr + 1 clip (bike 500)
//   injury     traffic:injury byPlayer (mayhem off): 8,000 kr + 2 clips; killed 25,000 kr + 3 clips; ratingPenalty 15 / 30
//   banDrive   driving a car while banned: 3,000 kr and +60 s of ban
// Pedestrians are never fined. Pedal bikes get no speeding / pavement / clips.
//
// Charging: a fine is a BILL, not an instant charge. issue() creates it in the economy ledger (ctx.systems.economy.bills.issue, kind
//   'fine', due in 7 days; reminders, fees and debt collection follow, see systems/economy/Bills.js) exactly once per offence
//   (per-type cooldowns), then
//   bus.emit(POLICE_EV.TICKET, { type, fine, clips, label, text, ratingPenalty, x, y, source, bike, billId, dueDay, dueLabel, autoPaid, speedKmh?, limitKmh? })
//   and a pager line from "Politiet". With infiniteMoney the bill is paid the moment it is issued (autoPaid).
//   Options noSpeedingTickets / noRedLightTickets: those two offences are never fined (no bill, no clip, no TICKET); only a small
//   "no ticket (option)" pager hint appears, once per offence cooldown.
// Licence: state.licence = { clips, banLeft, decayT }. Three clips = BAN_SECONDS driving ban on cars (bikes allowed). Enforcing the ban on
//   ENTERING cars is a change request for Player.js (see ARCHITECTURE notes); until then driving a car while banned is fined (banDrive).
import { listen, bus, EV, pager, TRAFFIC_EV } from '../../../core/events.js';
import { opt } from '../../../core/options.js';
import { dueLabel } from '../../economy/Bills.js';
import { PX } from '../../../config.js';
import { fmtKr } from '../../../ui/theme.js';
import { POLICE_EV } from '../tuning.js';
import { RULES as R } from './config.js';
import { Licence } from './Licence.js';
import { CameraVans, Patrols } from './Cameras.js';

const RATING = { redLight: 2, speeding: 1, ramming: 3, parked: 1, pavement: 1, wrongWay: 2, injury: 15, killed: 30, banDrive: 3 };

export function createTrafficRules(ctx) {
  const licence = new Licence(ctx);
  const vans = new CameraVans(ctx);
  const patrols = new Patrols(ctx);
  const world = ctx.world;
  const cd = { red: 0, speed: 0, ram: 0, parked: 0, pavement: 0, wrongWay: 0, injury: 0, ban: 0 };
  const near = [];
  let px0 = 0, py0 = 0, havePrev = false;
  let pavT = 0, wwT = 0, banT = 0, tickT = 0;
  let witness = null; // patrol car that currently sees the player

  const playerCar = () => {
    const p = ctx.player, v = p.vehicle;
    return !p.dead && v && v.driver === 'player' ? v : null;
  };

  function issue(type, o) {
    const v = ctx.player.vehicle;
    const bike = !!(v && v.def.cyclist);
    const motor = !!(v && !v.def.bike); // the licence applies to cars (not bikes / scooters)
    const fine = Math.round(o.fine * R.FINE_SCALE);
    const clips = motor ? (o.clips || 0) : 0;
    const bill = ctx.systems.economy.bills.issue({ kind: 'fine', label: o.label, amount: fine, source: 'Politiet' });
    const due = dueLabel(bill.dueDay);
    const text = bill.status === 'paid' ? `Fine ${fmtKr(fine)} (paid automatically): ${o.label}` : `Bill ${fmtKr(fine)}, due ${due}: ${o.label}`;
    const ticket = {
      billId: bill.id, dueDay: bill.dueDay, dueLabel: due, autoPaid: bill.status === 'paid',
      type, fine, clips, label: o.label, text, ratingPenalty: o.rating || 0, source: o.source || 'auto', bike,
      x: o.x ?? ctx.player.px, y: o.y ?? ctx.player.py, speedKmh: o.speedKmh, limitKmh: o.limitKmh,
    };
    bus.emit(POLICE_EV.TICKET, ticket);
    pager(`${text}.${clips ? ` Licence clip ${licence.s.clips + clips >= R.CLIPS_TO_BAN ? '3/3' : `${licence.s.clips + clips}/${R.CLIPS_TO_BAN}`}.` : ''}`, 'warn', 'Politiet');
    if (clips && licence.addClips(clips)) pager(`Licence suspended: no driving cars for ${Math.round(R.BAN_SECONDS / 60)} minutes. Bikes are fine.`, 'crime', 'Politiet');
    return ticket;
  }

  // ---------------------------------------------------------------- red light
  function redLight(v) {
    const sig = ctx.systems.traffic?.signals;
    if (!sig) return;
    const x = v.x, y = v.y;
    if (havePrev && (x - px0) ** 2 + (y - py0) ** 2 < (30 * PX) ** 2 && cd.red <= 0) {
      const spd = v.speedMps, fs = v.forwardSpeed;
      if (spd > R.RED_MIN_SPEED && fs > 0) {
        sig.nearby(x, y, 20 * PX, near);
        const ux = v.vx / (v.speed || 1), uy = v.vy / (v.speed || 1);
        for (let i = 0; i < near.length; i++) {
          const ap = near[i];
          if (ap.dx * ux + ap.dy * uy < 0.6) continue;
          const s = (x - ap.sx) * ap.dx + (y - ap.sy) * ap.dy, sp = (px0 - ap.sx) * ap.dx + (py0 - ap.sy) * ap.dy;
          if (!(sp < 0 && s >= 0)) continue;
          const lat = (x - ap.sx) * -ap.dy + (y - ap.sy) * ap.dx;
          if (Math.abs(lat) > ap.w / 2 + PX) continue;
          if (sig.redAge(ap) < R.RED_GRACE) continue;
          cd.red = R.RED_COOLDOWN;
          if (opt('noRedLightTickets')) { pager('Red light: no ticket (option).', 'info', 'Politiet'); break; }
          const bike = v.def.cyclist;
          issue('redLight', { fine: bike ? R.RED_BIKE_FINE : R.RED_FINE, clips: R.RED_CLIPS, label: bike ? 'Cycled through a red light' : 'Ran a red light', rating: RATING.redLight, source: 'auto' });
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- speeding (camera vans + patrol)
  function speeding(v) {
    if (v.def.cyclist) return;
    const kmh = v.speedMps * 3.6, limit = world.speedLimitAt(v.x, v.y);
    const van = vans.nearVan(v.x, v.y, 80 * PX);
    if (van && van.warnCd <= 0 && !v.def.bike) { van.warnCd = 120; pager('Fotovogn ahead: speed camera.', 'info', 'Politiet'); }
    if (kmh <= limit + R.SPEED_TOL_KMH || cd.speed > 0) return;
    let source = null, cam = null;
    if (van && van.cd <= 0 && (van.v.x - v.x) ** 2 + (van.v.y - v.y) ** 2 < (R.CAMERA_RADIUS * PX) ** 2) { source = 'camera'; cam = van; }
    else if (witness) source = 'patrol';
    if (!source) return;
    const over = (kmh - limit) / limit;
    const tier = R.SPEED_TIERS.find((t) => over <= t[0]);
    cd.speed = R.SPEED_COOLDOWN;
    if (cam) { cam.cd = R.CAMERA_COOLDOWN; vans.flash(cam); }
    if (opt('noSpeedingTickets')) { pager('Speeding: no ticket (option).', 'info', 'Politiet'); return; }
    issue('speeding', { fine: tier[1], clips: tier[2], label: `Speeding: ${Math.round(kmh)} km/h in a ${limit} zone`, rating: RATING.speeding, source, speedKmh: Math.round(kmh), limitKmh: limit });
  }

  // ---------------------------------------------------------------- pavement / pedestrian zone
  function pavement(v, dt) {
    const on = !v.def.bike && v.surface === 'foot' && v.forwardSpeed / PX > R.PAVEMENT_SPEED;
    if (!on) { pavT = Math.max(0, pavT - dt * 2); return; }
    pavT += dt;
    if (cd.pavement > 0) return;
    if (pavT >= (witness ? R.PAVEMENT_WITNESS_T : R.PAVEMENT_REPORT_T)) {
      pavT = 0; cd.pavement = R.PAVEMENT_COOLDOWN;
      issue('pavement', { fine: R.PAVEMENT_FINE, label: 'Driving on the pavement', rating: RATING.pavement, source: witness ? 'patrol' : 'auto' });
    }
  }

  // ---------------------------------------------------------------- wrong way in a one-way street
  function wrongWayNow(v) {
    const g = world.drive;
    const n = g.nearest(v.x, v.y, 130 * PX);
    if (n < 0 || v.speed < 1) return false;
    const ux = v.vx / v.speed, uy = v.vy / v.speed;
    const und = g.und[n], out = g.out[n];
    for (let i = 0; i < und.length; i++) {
      const m = und[i].to;
      let legal = false;
      for (let k = 0; k < out.length; k++) if (out[k].to === m) { legal = true; break; }
      if (legal) continue; // two-way, or one-way pointing away from n
      // m -> n is the only legal direction, so n -> m is wrong way
      const dx = g.x[m] - g.x[n], dy = g.y[m] - g.y[n], len = Math.hypot(dx, dy) || 1;
      const ex = dx / len, ey = dy / len;
      if (ex * ux + ey * uy < 0.85) continue;
      const t = ((v.x - g.x[n]) * ex + (v.y - g.y[n]) * ey) / len;
      if (t < 0.1 || t > 0.9) continue;
      const lat = Math.abs(-(v.x - g.x[n]) * ey + (v.y - g.y[n]) * ex);
      if (lat < Math.min(und[i].w / 2, 5 * PX)) return true;
    }
    return false;
  }

  function wrongWay(v, dt) {
    if (v.speedMps < R.WRONGWAY_SPEED || v.forwardSpeed <= 0 || !wrongWayNow(v)) { wwT = Math.max(0, wwT - dt * 2); return; }
    wwT += dt;
    if (cd.wrongWay > 0) return;
    if (wwT >= (witness ? R.WRONGWAY_WITNESS_T : R.WRONGWAY_REPORT_T)) {
      wwT = 0; cd.wrongWay = R.WRONGWAY_COOLDOWN;
      const bike = v.def.cyclist;
      issue('wrongWay', { fine: bike ? R.WRONGWAY_BIKE_FINE : R.WRONGWAY_FINE, clips: R.WRONGWAY_CLIPS, label: 'Wrong way in a one-way street', rating: RATING.wrongWay, source: witness ? 'patrol' : 'auto' });
    }
  }

  // ---------------------------------------------------------------- events
  const sc = ctx.scene;
  listen(sc, EV.VEHICLE_DAMAGED, ({ vehicle, impact, other }) => {
    const pv = ctx.player.vehicle;
    if (!pv || other !== pv || vehicle === pv || pv.def.cyclist || vehicle.def.cyclist || ctx.player.dead) return;
    if (vehicle.driver === 'police') return; // pursuit units: heat handles it
    const parked = !vehicle.driver;
    if (parked) {
      if (impact < R.PARKED_MIN_IMPACT || cd.parked > 0) return;
      cd.parked = R.PARKED_COOLDOWN;
      issue('parked', { fine: R.PARKED_FINE, label: vehicle.fotovogn ? 'Hit the speed camera van' : 'Hit a parked vehicle', rating: RATING.parked, x: vehicle.x, y: vehicle.y });
    } else {
      if (impact < R.RAM_MIN_IMPACT || cd.ram > 0) return;
      cd.ram = R.RAM_COOLDOWN;
      issue('ramming', { fine: R.RAM_FINE, clips: R.RAM_CLIPS, label: 'Reckless driving: hit another vehicle', rating: RATING.ramming, x: vehicle.x, y: vehicle.y });
    }
  });
  listen(sc, TRAFFIC_EV.INJURY, ({ severity, byPlayer, killed, x, y }) => {
    if (!byPlayer || opt('mayhem') || cd.injury > 0) return;
    cd.injury = R.INJURY_COOLDOWN;
    if (killed || severity >= 2) issue('injury', { fine: R.KILL_FINE, clips: R.KILL_CLIPS, label: 'Fatal accident', rating: R.KILL_RATING, x, y });
    else issue('injury', { fine: R.INJURY_FINE, clips: R.INJURY_CLIPS, label: 'Injured a pedestrian or cyclist', rating: R.INJURY_RATING, x, y });
  });
  listen(sc, POLICE_EV.LICENCE, ({ reason }) => {
    if (reason === 'ban-ended') pager('Driving ban over. Drive carefully.', 'info', 'Politiet');
  });

  return {
    update(dt, time) {
      licence.update(dt);
      for (const k in cd) if (cd[k] > 0) cd[k] -= dt;
      vans.update(dt, time);
      patrols.update(dt);
      const v = playerCar();
      if (!v) { havePrev = false; pavT = wwT = banT = 0; witness = null; return; }
      tickT -= dt;
      if (tickT <= 0) { tickT = 0.2; witness = patrols.sees(v.x, v.y); speeding(v); wrongWay(v, 0.2); }
      redLight(v);
      pavement(v, dt);
      // driving a car while banned
      if (licence.banned && !v.def.bike && v.speedMps > 1.5) {
        banT += dt;
        if (banT > 2.5 && cd.ban <= 0) {
          banT = 0; cd.ban = R.BAN_DRIVE_COOLDOWN;
          licence.s.banLeft += 60;
          issue('banDrive', { fine: R.BAN_DRIVE_FINE, label: 'Driving while banned', rating: RATING.banDrive });
        }
      } else banT = 0;
      px0 = v.x; py0 = v.y; havePrev = true;
    },
    getLicence: () => licence.get(),
    addClips: (n) => licence.addClips(n), // tests / debug
    isBanned: () => licence.banned,
    cameraSpots: () => vans.spots,
    patrolCars: () => patrols.cars,
    destroy() { vans.destroy(); patrols.destroy(); },
  };
}
