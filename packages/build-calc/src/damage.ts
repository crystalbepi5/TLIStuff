import type {
  ActiveSkill,
  Element,
  Modifier,
  StatKey
} from '@torchlight-companion/build-data';
import { aggregate, applyAggregate } from './modifiers.js';

/** Base crit multiplier in TLI: a crit deals 150% of the hit (i.e. +50%). */
export const BASE_CRIT_MULTIPLIER = 1.5;

const ELEMENTS: Element[] = ['physical', 'fire', 'cold', 'lightning', 'erosion'];
const ELEMENTAL: Element[] = ['fire', 'cold', 'lightning', 'erosion'];

const ADDED: Record<Element, StatKey> = {
  physical: 'addedPhysical',
  fire: 'addedFire',
  cold: 'addedCold',
  lightning: 'addedLightning',
  erosion: 'addedErosion'
};

const INCREASED_ELEMENT: Record<Element, StatKey> = {
  physical: 'increasedPhysical',
  fire: 'increasedFire',
  cold: 'increasedCold',
  lightning: 'increasedLightning',
  erosion: 'increasedErosion'
};

export interface DamageResult {
  /** Per-element average hit damage after all scaling, before crit. */
  perElement: Partial<Record<Element, number>>;
  /** Sum of `perElement`. */
  averageHit: number;
  /** Effective crit chance as a percentage, clamped to [0, 100]. */
  critRate: number;
  /** Crit multiplier, e.g. 1.7 means a crit deals 170% of a normal hit. */
  critMultiplier: number;
  /** Attacks/casts per second after speed scaling. */
  rate: number;
  /** Damage per second: averageHit x crit factor x rate. */
  dps: number;
}

/**
 * Compute DPS for one active skill given the full list of modifiers that apply
 * to it (hero + gear + supports + extras, already tag-filtered in build.ts).
 *
 * This is a standard, honest approximation of the ARPG damage pipeline. It is
 * NOT reverse-engineered from Torchlight's real formulas (those aren't public),
 * so treat the absolute numbers as relative indicators, not in-game truth.
 */
export function computeDamage(skill: ActiveSkill, modifiers: Modifier[]): DamageResult {
  const hasTag = (t: string) => skill.tags.includes(t as never);

  // Tag-conditional "increased" pools that apply to every element.
  const tagIncreasedStats: StatKey[] = [];
  if (hasTag('attack')) tagIncreasedStats.push('increasedAttack');
  if (hasTag('spell')) tagIncreasedStats.push('increasedSpell');
  if (hasTag('area')) tagIncreasedStats.push('increasedArea');
  if (hasTag('projectile')) tagIncreasedStats.push('increasedProjectile');

  const generic = aggregate(modifiers, 'increasedDamage', ...tagIncreasedStats);
  const moreAll = aggregate(modifiers, 'moreDamage');

  const perElement: Partial<Record<Element, number>> = {};
  let averageHit = 0;

  for (const element of ELEMENTS) {
    const base = skill.baseDamage[element] ?? 0;
    if (base === 0) continue;

    const added = aggregate(modifiers, ADDED[element]).flat;
    const elementIncreased = aggregate(modifiers, INCREASED_ELEMENT[element]).increased;
    const elementalIncreased = ELEMENTAL.includes(element)
      ? aggregate(modifiers, 'increasedElemental').increased
      : 0;

    // One combined pipeline: increased pools sum, more pools multiply.
    const increased = generic.increased + elementIncreased + elementalIncreased;
    const more = generic.more * moreAll.more;
    const hit = applyAggregate(base, {
      flat: added,
      increased,
      more
    });
    perElement[element] = hit;
    averageHit += hit;
  }

  // Crit.
  const critAgg = aggregate(modifiers, 'critRate');
  const critScale = aggregate(modifiers, 'increasedCritRate').increased;
  const critRate = clamp(
    skill.baseCritRate * (1 + critScale / 100) + critAgg.flat,
    0,
    100
  );
  const critDamage = aggregate(modifiers, 'critDamage').flat;
  const critMultiplier = BASE_CRIT_MULTIPLIER + critDamage / 100;
  const critFactor = 1 + (critRate / 100) * (critMultiplier - 1);

  // Rate: attacks use attack speed, otherwise casts use cast speed.
  const speedStat: StatKey = hasTag('attack') ? 'increasedAttackSpeed' : 'increasedCastSpeed';
  const speed = aggregate(modifiers, speedStat);
  const rate = applyAggregate(skill.baseRate, { flat: 0, increased: speed.increased, more: speed.more });

  return {
    perElement,
    averageHit,
    critRate,
    critMultiplier,
    rate,
    dps: averageHit * critFactor * rate
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
