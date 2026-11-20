// Shared game state + localStorage persistence.
//
// There is one live state object per play session: `session.state`.
// Each top-level key is OWNED by one module (see ARCHITECTURE.md). Owners
// mutate their keys directly and emit an event; everyone else only reads.
import { SAVE_PREFIX } from '../config.js';
import { getCharacter } from '../data/characters.js';

export const SKILLS = ['driving', 'stamina', 'charm', 'streetSmarts', 'navigation'];
export const SKILL_MAX = 5;

/** The live session. Set by CharacterSelectScene before starting Game. */
export const session = { state: null };

/** Default weekly rent of the starter basement room (kr). Rent logic itself belongs to the HOME & VEHICLES specialist. */
export const DEFAULT_RENT = 1200;

/**
 * @param {object} [options] { theft, criminalMissions, mayhem }; omitted = all off (realistic courier game).
 *   Fixed for the life of the save (set once at new-game time by NewGameScene).
 */
export function createInitialState(cityId, characterId, options) {
  const ch = getCharacter(characterId);
  return {
    version: 1,
    cityId,
    characterId,
    // --- game options (lead only; see core/options.js). Set once at new-game time, persisted. ---
    options: { theft: false, criminalMissions: false, mayhem: false, ...(options || {}) },
    // --- home: the rented basement room (data in data/home.js; rent/sleep logic is the HOME specialist's) ---
    // paidUntilDay: game day (economy clock) until which the rent is paid; the first week is prepaid.
    home: { id: 'basement', rentPerWeek: DEFAULT_RENT, paidUntilDay: 7, tier: 0, lateSince: null, evicted: false, remindedFor: null },
    // --- EconomySystem ---
    money: (ch?.startMoney ?? 250) + (options?.theft ? 0 : 250), // realistic start: 450-650 kr, first rent prepaid (see ARCHITECTURE Balance)
    lq: 0,
    skillPoints: 0,
    milestonesReached: 0,
    skills: Object.fromEntries(SKILLS.map((k) => [k, 0])),
    purchases: {}, // itemId -> count
    economy: { clock: 8 * 60, cooldowns: {}, week: null, lastWeek: null, insured: true, rentals: [], rentalSeq: 1, lastWakeDay: null },
    jobs: {}, // careers state (courier/taxi/bus), filled by missions/careers/shared.js
    licence: { clips: 0, banLeft: 0, decayT: 0 }, // traffic-rules driving licence
    // --- PoliceSystem ---
    heat: 0, // 0..5.99, level = floor(heat). Not restored on load (reset to 0).
    // --- MissionSystem ---
    job: null, // active job; transient, not saved
    contactCooldowns: {}, // contactId -> timestamp (ms, game time)
    // --- GameScene / Player ---
    player: { x: null, y: null, health: 100 },
    ownedVehicles: options?.theft ? [] : ['bike'], // vehicle type ids the player owns; no-theft games start with their own city bike
    // --- shared counters (any module may increment its own counters) ---
    stats: { deliveries: 0, missions: 0, stolen: 0, busted: 0, knockouts: 0, earned: 0, playSeconds: 0 },
    savedAt: null,
  };
}

/** Effective skill level = purchased level + character bonus. */
export function skillLevel(state, key) {
  const bonus = getCharacter(state.characterId)?.bonus?.[key] || 0;
  return (state.skills[key] || 0) + bonus;
}

const keyFor = (cityId, characterId) => `${SAVE_PREFIX}:${cityId}:${characterId}`;
const TRANSIENT = ['job', 'heat'];

export function loadSave(cityId, characterId) {
  try {
    const raw = window.localStorage.getItem(keyFor(cityId, characterId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    // merge onto defaults so new fields get sane values
    const base = createInitialState(cityId, characterId);
    // Old saves have no `options`: they load as the legacy all-ON game (see core/options.js).
    const legacy = !data.options;
    const options = legacy ? { theft: true, criminalMissions: true, mayhem: true } : { ...base.options, ...data.options };
    return { ...base, ...data, options, optionsLegacy: legacy || !!data.optionsLegacy, home: { ...base.home, ...data.home }, economy: { ...base.economy, ...(data.economy || {}) }, licence: { ...base.licence, ...data.licence }, skills: { ...base.skills, ...data.skills }, stats: { ...base.stats, ...data.stats }, job: null, heat: 0 };
  } catch (err) {
    console.warn('loadSave failed', err);
    return null;
  }
}

export function writeSave(state) {
  if (!state) return false;
  try {
    const copy = { ...state, savedAt: Date.now() };
    for (const k of TRANSIENT) delete copy[k];
    window.localStorage.setItem(keyFor(state.cityId, state.characterId), JSON.stringify(copy));
    state.savedAt = copy.savedAt;
    return true;
  } catch (err) {
    console.warn('writeSave failed', err);
    return false;
  }
}

export function deleteSave(cityId, characterId) {
  try {
    window.localStorage.removeItem(keyFor(cityId, characterId));
  } catch (err) {
    console.warn('deleteSave failed', err);
  }
}
