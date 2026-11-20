// Skill definitions and effect tables. OWNER: economy specialist.
// Other systems read effects via economy.getMultiplier(skill) / getEffects(),
// or compute from skillLevel(state, key) with these tables (SKILL_EFFECTS).
import { SKILLS, SKILL_MAX } from '../../core/state.js';

export { SKILLS, SKILL_MAX };

export const SKILL_INFO = {
  driving: { name: 'Driving', desc: 'Top speed and handling', icon: 'D' },
  stamina: { name: 'Stamina', desc: 'Run speed and max health', icon: 'S' },
  charm: { name: 'Charm', desc: 'Bigger payouts and tips', icon: 'C' },
  streetSmarts: { name: 'Street smarts', desc: 'Heat builds slower and fades faster', icon: 'W' },
  navigation: { name: 'Navigation', desc: 'More time on delivery deadlines', icon: 'N' },
};

/** Skill point cost to go from level L to L+1 (L = bought level 0..4). */
export const SKILL_COSTS = [1, 1, 2, 2, 3];

/** Per-level effect strength. Effect = 1 + level * perLevel (or 1 - for reductions). */
export const SKILL_EFFECTS = {
  driving: { topSpeed: 0.04, handling: 0.05 }, //      x(1 + L*v)
  stamina: { runSpeed: 0.04, maxHealth: 0.06 }, //     x(1 + L*v)
  charm: { payout: 0.06, tips: 0.10 }, //              x(1 + L*v)
  streetSmarts: { heatGain: -0.08, heatDecay: 0.12 }, // heatGain x(1 + L*v) (v<0), decay x(1 + L*v)
  navigation: { timeLimit: 0.07 }, //                  x(1 + L*v)
};

/** Primary multiplier per skill (what getMultiplier(skill) returns). */
export const PRIMARY = {
  driving: 'topSpeed', stamina: 'runSpeed', charm: 'payout', streetSmarts: 'heatGain', navigation: 'timeLimit',
};
