import type {
  Affix,
  AffixTier,
  ActiveSkill,
  GearSlot,
  Modifier,
  SkillLevelEntry,
  SupportSkill
} from '@torchlight-companion/build-data';

/**
 * Modifiers for one specific tier of an affix, falling back to the affix's
 * top-tier `modifiers` if per-tier data isn't available or the requested
 * tier isn't found -- so callers that don't care which tier landed (the
 * existing build-calc pipeline) keep working unchanged.
 *
 * Pass `modifierId` whenever the caller has it: mapAffixes unions tiers
 * across gear subtypes, so the same generic tier label (e.g. "1") can
 * legitimately appear more than once in one affix's tiers array (each
 * subtype keeps its own row/weight) -- `tier` alone is ambiguous and would
 * arbitrarily return whichever matching row comes first. `modifierId` is
 * each row's real, unique id and disambiguates correctly.
 */
export function pickAffixTier(affix: Affix, tier?: string, modifierId?: string): Modifier[] {
  if (tier == null && modifierId == null) return affix.modifiers;
  const found =
    modifierId != null
      ? affix.tiers?.find((t) => t.modifierId === modifierId)
      : affix.tiers?.find((t) => t.tier === tier);
  return found ? found.modifiers : affix.modifiers;
}

/**
 * Modifiers for an affix as actually rolled on a specific gear slot. The
 * same craft template merges across gear subtypes/slots into one Affix (see
 * tlicompendium.ts's mapAffixes), but different slots can genuinely roll
 * different value ranges for "the same" affix (confirmed real: a Max Life
 * prefix craftable to +220 on boots but +330 on a weapon) -- `affix.modifiers`
 * is only a best-across-all-slots preview value, not necessarily correct for
 * any one slot. Prefers the best-craftable tier tagged with this slot; falls
 * back to `affix.modifiers` when the affix has no slot-tagged tiers at all
 * (e.g. a hand-curated affix with no scraped tier data).
 */
export function modifiersForSlot(affix: Affix, slot: GearSlot): Modifier[] {
  const slotTiers = (affix.tiers ?? []).filter((t) => t.slot === slot);
  if (slotTiers.length === 0) return affix.modifiers;
  const craftable = slotTiers.filter((t) => t.weight > 0);
  const pool = craftable.length > 0 ? craftable : slotTiers;
  const best = pool.slice().sort((a, b) => (b.modifiers[0]?.value ?? 0) - (a.modifiers[0]?.value ?? 0))[0];
  return best?.modifiers ?? affix.modifiers;
}

/**
 * The affix's craftable tier pool for a crafting-odds calculation: every
 * tier with a nonzero weight (weight 0 means currently disabled/
 * unobtainable, not "equally likely as everything else").
 */
export function craftableTiers(affix: Affix): AffixTier[] {
  return (affix.tiers ?? []).filter((t) => t.weight > 0);
}

/** Each tier's share of the total weight -- the crafting-odds a real
 * simulator would use (see the standalone Python crafting_sim.py tool for a
 * full Monte Carlo treatment of this same data). */
export function affixTierOdds(affix: Affix): { tier: string; weight: number; chance: number }[] {
  const pool = craftableTiers(affix);
  const total = pool.reduce((sum, t) => sum + t.weight, 0);
  return pool.map((t) => ({ tier: t.tier, weight: t.weight, chance: total > 0 ? t.weight / total : 0 }));
}

/**
 * Modifiers for a skill (active or support) at a specific level, falling
 * back to its flat baseline (`modifiers` for supports, `[]` for actives --
 * their baseline is `baseDamage`/`baseRate`, tracked separately, not a
 * Modifier list) when no levelScaling data is available or no level is
 * given. Clamps to the nearest level present in levelScaling rather than
 * failing outright, since it's sparse/best-effort (see buildLevelScaling in
 * build-scraper for why not every skill has it, and not necessarily at
 * every level).
 */
export function pickSkillLevel(
  skill: ActiveSkill | (SupportSkill & { modifiers?: Modifier[] }),
  level?: number
): Modifier[] {
  const scaling = skill.levelScaling;
  if (level == null || !scaling || scaling.length === 0) {
    return 'modifiers' in skill ? (skill.modifiers ?? []) : [];
  }
  const nearest = scaling.reduce((best, entry) =>
    Math.abs(entry.level - level) < Math.abs(best.level - level) ? entry : best
  );
  return nearest.modifiers;
}

/** Every level entry available for a skill, if any -- e.g. for a UI level
 * slider to know its valid range. */
export function availableLevels(skill: { levelScaling?: SkillLevelEntry[] }): number[] {
  return (skill.levelScaling ?? []).map((e) => e.level);
}
