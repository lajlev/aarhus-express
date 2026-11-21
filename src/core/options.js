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
//   noSpeedingTickets (comfort/cheat) speeding is never fined (camera vans and patrols stay, a small "no ticket (option)" hint shows).
//   noRedLightTickets (comfort/cheat) running a red light is never fined (same hint).
//   gambling         (group 'gambling') scratch cards at kiosks/supermarkets, slot machines in Latinerkvarteret / Jaegergaardsgade bars and a
//                    betting tab in the phone app. Money only, never an LQ effect, does not count as crime.
// The comfort and gambling options have a `group`, do not count as crime and do not change "Realistic courier: no crime".
// (Bills and quick loans are NOT options: every game has them.)
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
  {
    id: 'noSpeedingTickets', label: 'No speeding tickets', tag: 'Cheat: no speeding tickets', group: 'comfort',
    desc: 'Speed cameras and patrols never fine you for speeding.',
  },
  {
    id: 'noRedLightTickets', label: 'No red-light tickets', tag: 'Cheat: no red-light tickets', group: 'comfort',
    desc: 'Running a red light is never fined.',
  },
  {
    id: 'gambling', label: 'Gambling', tag: 'Gambling', group: 'gambling',
    desc: 'Scratch cards at kiosks, slot machines in the bars and a betting app. The house wins. Money only, no Life Quality.',
  },
];
export const OPTION_IDS = OPTION_INFO.map((o) => o.id);
export const CRIME_IDS = OPTION_INFO.filter((o) => !o.group).map((o) => o.id);
export const COMFORT_IDS = OPTION_INFO.filter((o) => o.group === 'comfort').map((o) => o.id);
/** Group headings of the new-game screen, in order (the ungrouped crime options come first, then START). */
export const OPTION_GROUPS = [
  { id: 'comfort', title: 'COMFORT / CHEATS  (not crime: the game stays "Realistic courier")' },
  { id: 'gambling', title: 'GAMBLING  (money only, no Life Quality, not crime)' },
];

export const noOptions = () => Object.fromEntries(OPTION_INFO.map((o) => [o.id, false]));
export const allOptions = () => ({ ...noOptions(), theft: true, criminalMissions: true, mayhem: true }); // legacy saves: the old crime game, no cheats

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
  const extra = OPTION_INFO.filter((i) => i.group && o[i.id]).map((i) => i.tag);
  return [...(crime.length ? crime : ['Realistic courier']), ...extra];
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
