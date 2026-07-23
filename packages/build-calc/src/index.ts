export {
  aggregate,
  applyAggregate,
  emptyAggregate,
  sumFlat,
  type Aggregate
} from './modifiers.js';
export { computeDamage, BASE_CRIT_MULTIPLIER, type DamageResult } from './damage.js';
export { computeDefense, RESIST_CAP, type DefenseResult } from './defense.js';
export {
  collectModifiers,
  evaluateBuild,
  MAX_PACT_SPIRITS,
  type BuildReport
} from './build.js';
export {
  pickAffixTier,
  modifiersForSlot,
  craftableTiers,
  affixTierOdds,
  pickSkillLevel,
  availableLevels
} from './tiers.js';
export { analyticOdds, monteCarloOdds, type CraftingOdds, type MonteCarloResult } from './crafting.js';
export { totalManaCost } from './manaCost.js';
