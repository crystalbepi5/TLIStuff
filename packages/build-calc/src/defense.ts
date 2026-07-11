import type { Modifier, ResistableElement, StatKey } from '@torchlight-companion/build-data';
import { aggregate } from './modifiers.js';

/** Resistances are capped at 75% by default in TLI. */
export const RESIST_CAP = 75;

export interface DefenseResult {
  life: number;
  energyShield: number;
  armor: number;
  /** Life + energy shield. */
  healthPool: number;
  resists: Record<ResistableElement, number>;
  /**
   * A crude effective-HP figure vs. a purely elemental hit: the health pool
   * scaled up by average elemental mitigation. Approximation only — armor and
   * physical mitigation are not folded in here.
   */
  effectiveHpVsElemental: number;
}

const RESIST_STATS: Record<ResistableElement, StatKey> = {
  fire: 'fireResist',
  cold: 'coldResist',
  lightning: 'lightningResist',
  erosion: 'erosionResist'
};

export function computeDefense(modifiers: Modifier[]): DefenseResult {
  const life = applyIncreased(modifiers, 'life', 'increasedLife');
  const energyShield = applyIncreased(modifiers, 'energyShield', 'increasedEnergyShield');
  const armor = applyIncreased(modifiers, 'armor', 'increasedArmor');

  const resists = {} as Record<ResistableElement, number>;
  let resistSum = 0;
  for (const element of Object.keys(RESIST_STATS) as ResistableElement[]) {
    const raw = aggregate(modifiers, RESIST_STATS[element]).flat;
    const capped = Math.min(RESIST_CAP, raw);
    resists[element] = capped;
    resistSum += capped;
  }
  const avgResist = resistSum / 4;

  const healthPool = life + energyShield;
  const effectiveHpVsElemental =
    avgResist >= 100 ? Infinity : healthPool / (1 - avgResist / 100);

  return { life, energyShield, armor, healthPool, resists, effectiveHpVsElemental };
}

/** flat pool scaled by its matching `increased` pool. */
function applyIncreased(modifiers: Modifier[], flatStat: StatKey, increasedStat: StatKey): number {
  const flat = aggregate(modifiers, flatStat).flat;
  const increased = aggregate(modifiers, increasedStat).increased;
  return flat * (1 + increased / 100);
}
