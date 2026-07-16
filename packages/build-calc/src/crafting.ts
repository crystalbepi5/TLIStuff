import type { AffixTier } from '@torchlight-companion/build-data';

/**
 * Weight-based crafting odds for one affix's tier pool, mirroring the
 * standalone Python crafting_sim.py's `analytic_odds`: chance is just each
 * matching tier's share of the pool's total weight. `pool` should already be
 * filtered to craftable (weight > 0) tiers -- see `craftableTiers`.
 */
export interface CraftingOdds {
  poolSize: number;
  totalWeight: number;
  matchingWeight: number;
  chancePerCraft: number;
  /** Infinity when chancePerCraft is 0 (nothing in the pool matches). */
  expectedAttempts: number;
  /**
   * True when every tier in the pool shares the same weight -- i.e. "Weight"
   * here is really an available/unavailable flag, not a differentiated RNG
   * weight (seen on tlidb.com's per-item gear tables). Odds computed from a
   * flat pool assume uniform chance among currently-enabled tiers, which is
   * NOT a confirmed in-game probability. tlicompendium's tiers have been
   * real differentiated weights in every sample checked so far, but this
   * flag is kept as the same honesty check the Python tool used.
   */
  isFlatPool: boolean;
}

export function analyticOdds(pool: AffixTier[], matches: AffixTier[]): CraftingOdds {
  const totalWeight = pool.reduce((sum, t) => sum + t.weight, 0);
  const matchingWeight = matches.reduce((sum, t) => sum + t.weight, 0);
  const chancePerCraft = totalWeight > 0 ? matchingWeight / totalWeight : 0;
  const weights = new Set(pool.map((t) => t.weight));
  return {
    poolSize: pool.length,
    totalWeight,
    matchingWeight,
    chancePerCraft,
    expectedAttempts: chancePerCraft > 0 ? 1 / chancePerCraft : Infinity,
    isFlatPool: weights.size <= 1
  };
}

export interface MonteCarloResult {
  trials: number;
  hitRate: number;
  avgAttempts: number;
}

/** Deterministic PRNG (mulberry32) so a seeded run is reproducible, e.g. for
 * tests -- Math.random() can't be seeded. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_ATTEMPTS_PER_TRIAL = 100_000; // safety valve against a zero-probability target

/**
 * Monte Carlo cross-check of `analyticOdds`: simulate `trials` craft
 * sessions, each re-rolling from the full weighted pool until a matching
 * tier comes up, and report the observed hit rate + average attempts.
 * Mirrors the Python tool's `monte_carlo`.
 */
export function monteCarloOdds(
  pool: AffixTier[],
  matches: AffixTier[],
  trials: number,
  seed?: number
): MonteCarloResult {
  const rng = seed != null ? mulberry32(seed) : Math.random;
  const totalWeight = pool.reduce((sum, t) => sum + t.weight, 0);
  const matchSet = new Set(matches.map((t) => t.modifierId ?? t.tier));
  let hits = 0;
  let attemptsSum = 0;
  let hitCount = 0;

  for (let trial = 0; trial < trials; trial++) {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS_PER_TRIAL) {
      attempts++;
      let roll = rng() * totalWeight;
      let picked = pool[pool.length - 1];
      for (const tier of pool) {
        roll -= tier.weight;
        if (roll <= 0) {
          picked = tier;
          break;
        }
      }
      if (picked && matchSet.has(picked.modifierId ?? picked.tier)) {
        hits++;
        attemptsSum += attempts;
        hitCount++;
        break;
      }
    }
  }

  return {
    trials,
    hitRate: trials > 0 ? hits / trials : 0,
    avgAttempts: hitCount > 0 ? attemptsSum / hitCount : Infinity
  };
}
