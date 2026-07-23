import type { Affix, Build, DatasetIndex, GearSlot } from '@torchlight-companion/build-data';
import { evaluateBuild } from './build.js';

/**
 * One hypothetical single-affix swap and the DPS it would produce. `gain` is
 * relative to the build's current (unmodified) DPS.
 */
export interface AffixSwapSuggestion {
  slot: GearSlot;
  pieceBaseId: string;
  fromAffixId: string;
  fromAffixName: string;
  toAffixId: string;
  toAffixName: string;
  dps: number;
  gain: number;
}

/**
 * For every equipped gear affix, try swapping it (one at a time) for every
 * other affix valid on that slot and not already equipped on the same piece,
 * recompute the build's DPS, and rank the resulting deltas -- "if you could
 * change exactly one affix, which change matters most". Modelled as a swap
 * (not an addition) because the real game caps affixes per piece even
 * though this project's Build/GearPiece shape doesn't enforce that cap
 * itself; comparing like-for-like keeps the suggestion realistic.
 *
 * `affixPool` is the full affix list to consider candidates from (e.g.
 * seedDataset.affixes) -- DatasetIndex only exposes single-id lookups, not
 * enumeration, so the caller supplies it directly (the planner UI already
 * does the equivalent filtering itself for the affix picker).
 *
 * O(equipped affixes x candidate pool per slot) evaluateBuild calls -- fine
 * for the seed's affix-pool sizes (tens per slot), not meant for a hot path.
 */
export function marginalGearAnalysis(
  build: Build,
  index: DatasetIndex,
  affixPool: Affix[],
  limit = 10
): AffixSwapSuggestion[] {
  const baseline = evaluateBuild(build, index).damage.dps;
  const suggestions: AffixSwapSuggestion[] = [];

  build.gear.forEach((piece, pieceIdx) => {
    const candidates = affixPool.filter((a) => a.slots.includes(piece.slot));
    for (const fromId of piece.affixIds) {
      const fromAffix = index.affix(fromId);
      for (const candidate of candidates) {
        if (piece.affixIds.includes(candidate.id)) continue; // already equipped here
        const gear = build.gear.map((p, i) =>
          i === pieceIdx ? { ...p, affixIds: p.affixIds.map((id) => (id === fromId ? candidate.id : id)) } : p
        );
        const dps = evaluateBuild({ ...build, gear }, index).damage.dps;
        const gain = dps - baseline;
        if (gain > 0) {
          suggestions.push({
            slot: piece.slot,
            pieceBaseId: piece.baseId,
            fromAffixId: fromId,
            fromAffixName: fromAffix?.name ?? fromId,
            toAffixId: candidate.id,
            toAffixName: candidate.name,
            dps,
            gain
          });
        }
      }
    }
  });

  return suggestions.sort((a, b) => b.gain - a.gain).slice(0, limit);
}
