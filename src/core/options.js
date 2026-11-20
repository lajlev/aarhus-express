// Game options: the opt-in "crime" toggles chosen once when a NEW game starts.
//
// The default game is a realistic courier life with NO crime. Every option is OFF by default and is
// stored in `state.options` (persisted per save, never changed after new-game time).
//
//   theft            vehicle theft: steal parked or driven vehicles; every stolen vehicle offers a delivery order.
//   criminalMissions Ravn's smuggling / hot-car jobs and Sille's steal-to-order (the criminal contacts).
//   mayhem           hitting pedestrians and exploding cars are allowed with no rating or job penalty.
//   infiniteMoney    (comfort/cheat) money never limits you: every payment succeeds without lowering the balance (HUD shows the infinity sign).
//   noDrivingBan     (comfort/cheat) licence clips are still recorded and fines still apply, but a driving ban never starts.
// The two comfort options have group 'comfort', do not count as crime and do not change "Realistic courier: no crime".
//
// Police pursuit and heat are NOT an option of their own: they are active only when theft or
// criminalMissions is on (pursuitEnabled()). With everything off, police only enforce traffic rules.
//
// LEGACY SAVES: a save written before options existed has no `state.options`. loadSave() gives it all
// three options ON (the old game) and sets `state.optionsLegacy = true`, so the continue screen can show
// a "Classic (old save)" tag. Brand-new games never get optionsLegacy.
//
// Everything here reads `session.state`, so it works anywhere (systems, entities, scenes) without ctx.
// OWNER: lead only (shared file, specialists request changes).
import { session } from './state.js';

/** Option ids in display order, with UI text (NewGameScene, continue tags). */
export const OPTION_INFO = [
  {
    id: 'theft', label: 'Vehicle theft', tag: 'Theft',
    desc: 'Steal parked or driven vehicles with E. Every stolen vehicle offers a delivery order. Brings police heat.',
  },
  {
    id: 'criminalMissions', label: 'Criminal missions', tag: 'Crime jobs',
    desc: 'Ravn\'s smuggling and hot-car jobs, and Sille\'s steal-to-order. Brings police heat.',
  },
  {
    id: 'mayhem', label: 'Mayhem', tag: 'Mayhem',
    desc: 'Run over pedestrians and blow up cars with no penalty. Off: wrecks are towed, injuries fined.',
  },
  {
    id: 'infiniteMoney', label: 'Infinite money', tag: 'Cheat: infinite money', group: 'comfort',
    desc: 'Money never limits you: purchases, rent, fines and tows do not lower your balance.',
  },
  {
    id: 'noDrivingBan', label: 'No driving ban', tag: 'Cheat: no ban', group: 'comfort',
    desc: 'Clips and fines still apply, but you are never banned from driving, renting or buying cars.',
  },
];
export const OPTION_IDS = OPTION_INFO.map((o) => o.id);
export const CRIME_IDS = OPTION_INFO.filter((o) => !o.group).map((o) => o.id);
export const COMFORT_IDS = OPTION_INFO.filter((o) => o.group === 'comfort').map((o) => o.id);

export const noOptions = () => ({ theft: false, criminalMissions: false, mayhem: false, infiniteMoney: false, noDrivingBan: false });
export const allOptions = () => ({ theft: true, criminalMissions: true, mayhem: true, infiniteMoney: false, noDrivingBan: false }); // legacy saves: the old crime game, no cheats

/** Tunables of the realistic (mayhem-off) rules. */
export const REALISTIC = {
  towFee: 300, // kr, charged once via REQUEST_PAY reason 'tow'
  towDelaySec: 6, // seconds between the breakdown and the tow truck finishing
};

/** Read one option of the live session (false when no game is running). */
export function opt(name) {
  return !!session.state?.options?.[name];
}

/** Any crime option on: theft or criminalMissions. */
export function crimeEnabled() {
  return opt('theft') || opt('criminalMissions');
}

/** Police heat / pursuit / roadblocks / busting are active only when crime is possible. */
export function pursuitEnabled() {
  return crimeEnabled();
}

/** True when every CRIME option is off: the default "Realistic courier: no crime" game (comfort options do not matter). */
export function isRealistic(options = session.state?.options) {
  return !!options && CRIME_IDS.every((id) => !options[id]);
}

/** Active option tags for a save/state, for the small tag chips (continue screen, character select). */
export function optionTags(state) {
  const o = state?.options;
  if (!o) return [];
  if (state.optionsLegacy) return ['Classic: all options on'];
  const crime = OPTION_INFO.filter((i) => !i.group && o[i.id]).map((i) => i.tag);
  const comfort = OPTION_INFO.filter((i) => i.group && o[i.id]).map((i) => i.tag);
  return [...(crime.length ? crime : ['Realistic courier']), ...comfort];
}

/** May the player get into / use this vehicle? With theft off: only owned, rented or job vehicles
 *  (plus the target car of an active criminal mission when criminalMissions is on). */
export function playerMayUse(v) {
  if (opt('theft') || v.owned || v.rentedBy === 'player' || v.jobVehicle) return true;
  return v.tag === 'mission' && opt('criminalMissions'); // a criminal mission's target car may be taken (that is the job)
}

/** Criminal contacts are hidden and disabled unless criminalMissions is on. Legal contacts always stay. */
export function contactEnabled(c) {
  return !!c.legal || opt('criminalMissions');
}
