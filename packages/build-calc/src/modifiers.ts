import type { Modifier, StatKey } from '@torchlight-companion/build-data';

/**
 * The result of collapsing every modifier for one stat into the three ARPG
 * buckets. Final value convention:
 *
 *   value = (base + flat) * (1 + increased / 100) * more
 *
 * where `increased` is a sum of percentage points and `more` is the product of
 * each individual `(1 + moreValue)` multiplier.
 *
 * This structure is confirmed against the game's own docs, not assumed: see
 * tlidb.com's "Damage Calculation" page (https://tlidb.com/vi/Damage_Calculation),
 * which states damage = Base Damage x (1 + all non-additional bonus %) x
 * (1 + additional bonus % 1) x (1 + additional bonus % 2) x ... -- i.e. one
 * summed multiplier for "increased"-type bonuses, then one separate
 * multiplier per "additional"/"more"-type bonus, exactly this aggregation.
 */
export interface Aggregate {
  flat: number;
  /** Summed percentage points from all `increased` modifiers. */
  increased: number;
  /** Product of all `more` multipliers (starts at 1). */
  more: number;
}

export function emptyAggregate(): Aggregate {
  return { flat: 0, increased: 0, more: 1 };
}

/** Fold the modifiers matching any of `stats` into a single aggregate. */
export function aggregate(modifiers: Modifier[], ...stats: StatKey[]): Aggregate {
  const wanted = new Set(stats);
  const acc = emptyAggregate();
  for (const mod of modifiers) {
    if (!wanted.has(mod.stat)) continue;
    switch (mod.op) {
      case 'flat':
        acc.flat += mod.value;
        break;
      case 'increased':
        acc.increased += mod.value;
        break;
      case 'more':
        acc.more *= 1 + mod.value;
        break;
    }
  }
  return acc;
}

/** Apply an aggregate to a base value using the standard pipeline. */
export function applyAggregate(base: number, agg: Aggregate): number {
  return (base + agg.flat) * (1 + agg.increased / 100) * agg.more;
}

/** Sum only the `flat` contributions of the given stats (e.g. resist points). */
export function sumFlat(modifiers: Modifier[], ...stats: StatKey[]): number {
  return aggregate(modifiers, ...stats).flat;
}
