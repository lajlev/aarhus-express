// Police tuning values and police-owned events. All distances in world px unless noted (PX = 8 px/m).
import { PX } from '../../config.js';
import { LICENCE_EV } from '../economy/events.js';

export { LICENCE_EV }; // 'police:licence', payload { banned, clips, banLeft, maxClips, reason }

/** Events owned by the police system (namespaced strings). */
export const POLICE_EV = {
  /** { active: boolean, t: 0..1 progress to next heat drop, level, delay } while heat is decaying / searching */
  SEARCHING: 'police:searching',
  /** { active: boolean, level, units } pursuit started/ended (an officer has seen the player) */
  PURSUIT: 'police:pursuit',
  /** { level } heat decayed to zero (player escaped; not emitted on bust or death) */
  ESCAPED: 'police:escaped',
  /** { type, fine, clips, label, text, ratingPenalty, x, y, speedKmh?, limitKmh?, source: 'camera'|'patrol'|'auto', bike } a traffic fine was issued
   *  + billId, dueDay, dueLabel, autoPaid: the fine is a BILL in the economy ledger (due in 7 days), not charged yet; autoPaid with infiniteMoney. JOBS may listen to dock the courier rating by `ratingPenalty` (0 for minor offences). */
  TICKET: 'police:ticket',
  /** { clips, banned, banLeft, maxClips, reason: 'clip'|'ban'|'ban-ended'|'decay' } driving licence changed ("klip i koerekortet") */
  LICENCE: LICENCE_EV,
};

export const TUNING = {
  maxHeat: 5.99,
  /** crime type -> heat added when the CRIME event carries no severity */
  crimeHeat: { carjack: 0.6, parkedTheft: 0.3, pedestrianHit: 1.0, ramming: 0.25, policeHit: 0.5, policeDestroyed: 1.0, policeCarjack: 1.2, vehicleDestroyed: 0.5, mission: 0.8, default: 0.5 },
  severityScale: { pedestrianHit: 0.5, vehicleHit: 0.25 },
  /** streetSmarts level multipliers */
  searchDelay: 8, //       seconds without line of sight before searching starts
  searchDelayMin: 3,
  decayPerSec: 0.16, //    heat per second while searching
  levelPause: 0.5, //      fraction of the delay to wait again after dropping a level
  sightRange: 50 * PX, //  police can see the player within this and with clear LOS
  carsPerLevel: [0, 1, 2, 3, 4, 6],
  roadblocksPerLevel: [0, 0, 0, 0, 1, 2],
  spawnRingMin: 520, spawnRingMax: 900, // off-screen ring around the player
  spawnInterval: 2.2,
  despawnDist: 1500, //    chasers farther than this are recycled closer
  maxOfficers: 4,
  bustRange: 7 * PX,
  bustSlow: 1.5, //        m/s
  bustTime: 2, //          seconds
  officerCatchRange: 2.0 * PX,
  officerCatchRate: 2.6, // busting speed-up when an officer is on top of the player
  bustLock: 5, //          seconds of grace after a bust
  fineBase: 60, fineLevel: 50, finePct: 0.08,
  rammingCooldown: 1.5,
};
