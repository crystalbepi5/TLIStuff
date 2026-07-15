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
  craftableTiers,
  affixTierOdds,
  pickSkillLevel,
  availableLevels
} from './tiers.js';
