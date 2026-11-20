// Shared event bus. Every cross-module interaction goes through here so the
// specialist systems (traffic, police, missions, economy, HUD) stay decoupled.
// See ARCHITECTURE.md for the full event contract (payload shapes).
import Phaser from 'phaser';

export const bus = new Phaser.Events.EventEmitter();

export const EV = {
  // ---- player / vehicles (emitted by GameScene, Player, Vehicle) ----
  PLAYER_ENTERED_VEHICLE: 'player:enteredVehicle', // { vehicle, stolen, method: 'carjack'|'parked'|'own'|'abandoned' }
  PLAYER_EXITED_VEHICLE: 'player:exitedVehicle', //   { vehicle }
  VEHICLE_STOLEN: 'vehicle:stolen', //               { vehicle, method: 'carjack'|'parked', driverEjected: boolean }
  VEHICLE_DAMAGED: 'vehicle:damaged', //             { vehicle, amount, impact, other: Vehicle|null }
  VEHICLE_DESTROYED: 'vehicle:destroyed', //         { vehicle, x, y, cause: 'explosion'|'sunk' }
  VEHICLE_BROKEN: 'vehicle:broken', //              { vehicle, mine }  mayhem OFF: health hit 0, the car is "broken down" (smoking, undriveable) instead of exploding; mine = player's own/rented/job vehicle
  VEHICLE_TOWED: 'vehicle:towed', //                { vehicle, fee, x, y, home }  a broken vehicle was towed and respawned repaired (fee charged once via REQUEST_PAY 'tow')
  PLAYER_DAMAGED: 'player:damaged', //               { amount, source }
  PLAYER_DIED: 'player:died', //                     { x, y, cause }
  PLAYER_RESPAWNED: 'player:respawned', //           { x, y, where: 'hospital'|'police' }
  DRIVER_EJECTED: 'driver:ejected', //               { vehicle, x, y }  traffic spawns a fleeing pedestrian
  HORN: 'player:horn', //                            { x, y }

  // ---- crime & police (PoliceSystem) ----
  CRIME: 'crime', //                                 { type, severity, x, y }  any module may emit
  HEAT_CHANGED: 'heat:changed', //                   { heat, level, prevLevel }
  BUSTED: 'player:busted', //                        { fine }
  BUST_PROGRESS: 'police:bustProgress', //           { t } 0..1, HUD meter

  // ---- jobs (MissionSystem) ----
  JOB_OFFERED: 'job:offered', //                     { job, contact }
  JOB_STARTED: 'job:started', //                     { job }
  JOB_STAGE: 'job:stage', //                         { job, stageIndex }
  JOB_COMPLETED: 'job:completed', //                 { job, payout }
  JOB_FAILED: 'job:failed', //                       { job, reason }

  // ---- economy (EconomySystem) ----
  MONEY_CHANGED: 'money:changed', //                 { money, delta, reason }
  LQ_CHANGED: 'lq:changed', //                       { lq, delta }
  SKILL_POINT: 'skill:point', //                     { skillPoints }
  SKILL_UPGRADED: 'skill:upgraded', //               { skill, level }
  PURCHASED: 'shop:purchased', //                    { item, count }
  /** Request (anyone -> Economy): add or remove money. */
  REQUEST_PAY: 'economy:pay', //                     { amount, reason }  negative = charge

  // ---- UI ----
  PAGER: 'ui:pager', //                              { text, from?, kind?: 'info'|'job'|'warn'|'crime' }
  PROMPT: 'ui:prompt', //                            { text|null }  context hint ("[E] Enter car")
  BANNER: 'ui:banner', //                            { text, color?, ms? }  big centre text
  OPEN_OVERLAY: 'ui:openOverlay', //                 { mode: 'pause'|'shop'|'skills'|'map'|'jobs'|'home'|'dealer' }
  OVERLAY_CLOSED: 'ui:overlayClosed', //             {}

  // ---- lifecycle ----
  GAME_READY: 'game:ready', //                       { scene }  all systems created
  REQUEST_SAVE: 'state:requestSave', //              {}
  SAVED: 'state:saved', //                           {}
};

/**
 * Subscribe for the lifetime of a scene; the listener is removed when the
 * scene shuts down, so restarting the Game scene never doubles listeners.
 */
export function listen(scene, event, fn, ctx) {
  bus.on(event, fn, ctx);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off(event, fn, ctx));
}

/** Shorthand for a pager message. */
export const pager = (text, kind = 'info', from) => bus.emit(EV.PAGER, { text, kind, from });

// Namespaced system events, re-exported so everything can be imported from here.
export { TRAFFIC_EV } from '../systems/traffic/events.js';
export { POLICE_EV } from '../systems/police/tuning.js';
export { MISSION_EV, JOBS_EV } from '../systems/missions/events.js';
export { ECON_EV } from '../systems/economy/events.js';

// Debug handle for QA scripts (window.__game is the other one).
if (typeof window !== 'undefined') window.__bus = bus;
