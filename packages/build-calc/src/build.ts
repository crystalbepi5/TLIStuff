import type {
  ActiveSkill,
  Build,
  DamageTag,
  DatasetIndex,
  Modifier
} from '@torchlight-companion/build-data';
import { computeDamage, type DamageResult } from './damage.js';
import { computeDefense, type DefenseResult } from './defense.js';

/** How many Pact Spirits a build may bind. Stand-in for the real limit. */
export const MAX_PACT_SPIRITS = 3;

/**
 * SupportSkill.cannotSupport carries the scraper's raw, unnormalised source
 * strings (see its doc comment) since not every one of them maps onto the
 * DamageTag vocabulary this project tracks -- e.g. "Sentry" and "Mobility"
 * (both seen in the real scrape) have no corresponding DamageTag, so a
 * support incompatible only via one of those can't be enforced here; that's
 * an honest gap, not a guess. The ones that do map (confirmed against the
 * real scraped vocabulary: Channeled, Attack, Summon) are normalised the
 * same way mapSkills normalises `tags` in build-scraper.
 */
const CANNOT_SUPPORT_TAG: Record<string, DamageTag> = {
  Attack: 'attack',
  Spell: 'spell',
  Melee: 'melee',
  Area: 'area',
  Projectile: 'projectile',
  Channeled: 'channelled',
  Channelled: 'channelled',
  Summon: 'minion'
};

export interface BuildReport {
  skill: ActiveSkill;
  /** Every modifier that applied to this build, after tag filtering. */
  modifiers: Modifier[];
  damage: DamageResult;
  defense: DefenseResult;
  /** Non-fatal issues, e.g. a support that didn't match the skill's tags. */
  warnings: string[];
}

/** True if a tag-restricted modifier is allowed on this skill. */
function tagsAllow(modifier: Modifier, skill: ActiveSkill): boolean {
  if (!modifier.tags || modifier.tags.length === 0) return true;
  return modifier.tags.some((t) => skill.tags.includes(t));
}

/**
 * Gather every modifier a build contributes to its main skill: hero passives,
 * gear implicits + affixes, matching support skills, and free-form extras.
 * Modifiers carrying a `tags` restriction are dropped if the skill lacks them.
 */
export function collectModifiers(
  build: Build,
  index: DatasetIndex
): { modifiers: Modifier[]; skill: ActiveSkill; warnings: string[] } {
  const warnings: string[] = [];
  const skill = index.activeSkill(build.activeSkillId);
  if (!skill) {
    throw new Error(`unknown active skill: ${build.activeSkillId}`);
  }

  const raw: Modifier[] = [];

  const hero = index.hero(build.heroId);
  if (!hero) warnings.push(`unknown hero: ${build.heroId}`);
  else raw.push(...hero.baseModifiers);

  for (const piece of build.gear) {
    const base = index.gearBase(piece.baseId);
    if (!base) {
      warnings.push(`unknown gear base: ${piece.baseId}`);
    } else {
      if (base.slot !== piece.slot) {
        warnings.push(`gear base '${base.id}' is a ${base.slot}, not a ${piece.slot}`);
      }
      raw.push(...base.implicit);
    }
    for (const affixId of piece.affixIds) {
      const affix = index.affix(affixId);
      if (!affix) warnings.push(`unknown affix: ${affixId}`);
      else raw.push(...affix.modifiers);
    }
  }

  const socketed = build.supportIds.slice(0, skill.supportSlots);
  if (build.supportIds.length > skill.supportSlots) {
    warnings.push(
      `${skill.name} has ${skill.supportSlots} support slots but ${build.supportIds.length} were provided; extras ignored`
    );
  }
  for (const supportId of socketed) {
    const support = index.supportSkill(supportId);
    if (!support) {
      warnings.push(`unknown support skill: ${supportId}`);
      continue;
    }
    if (support.requiresSkillId != null && support.requiresSkillId !== build.activeSkillId) {
      warnings.push(`support '${support.name}' only supports '${support.requiresSkillId}', not ${skill.name}; ignored`);
      continue;
    }
    const matches =
      support.requiresTags.length === 0 ||
      support.requiresTags.some((t) => skill.tags.includes(t));
    if (!matches) {
      warnings.push(`support '${support.name}' requires tags [${support.requiresTags.join(', ')}] which ${skill.name} lacks; ignored`);
      continue;
    }
    const forbiddenTags = (support.cannotSupport ?? [])
      .map((raw) => CANNOT_SUPPORT_TAG[raw])
      .filter((t): t is DamageTag => t != null);
    const conflicting = forbiddenTags.filter((t) => skill.tags.includes(t));
    if (conflicting.length > 0) {
      warnings.push(`support '${support.name}' cannot support [${conflicting.join(', ')}] skills, which ${skill.name} is; ignored`);
      continue;
    }
    raw.push(...support.modifiers);
  }

  for (const talentId of build.talentIds) {
    const talent = index.talent(talentId);
    if (!talent) {
      warnings.push(`unknown talent: ${talentId}`);
      continue;
    }
    if (talent.heroId !== 'any' && talent.heroId !== build.heroId) {
      warnings.push(`talent '${talent.name}' belongs to another hero; ignored`);
      continue;
    }
    raw.push(...talent.modifiers);
  }

  for (const piece of build.voraxGear) {
    if (piece.legendaryId) {
      const legendary = index.voraxLegendary(piece.legendaryId, piece.limb);
      if (!legendary) warnings.push(`unknown vorax legendary '${piece.legendaryId}' for limb '${piece.limb}'`);
      else raw.push(...legendary.modifiers);
    }
    for (const affixId of piece.affixIds) {
      const affix = index.voraxAffix(affixId);
      if (!affix) warnings.push(`unknown vorax affix: ${affixId}`);
      else raw.push(...affix.modifiers);
    }
  }

  for (const nodeId of build.talentTreeNodeIds) {
    const entry = index.talentTreeNode(nodeId);
    if (!entry) warnings.push(`unknown talent tree node: ${nodeId}`);
    else raw.push(...entry.node.modifiers);
  }

  for (const nodeId of build.voidChartNodeIds) {
    const entry = index.voidChartNode(nodeId);
    if (!entry) warnings.push(`unknown void chart node: ${nodeId}`);
    else raw.push(...entry.node.modifiers);
  }

  const boundSpirits = build.pactSpiritIds.slice(0, MAX_PACT_SPIRITS);
  if (build.pactSpiritIds.length > MAX_PACT_SPIRITS) {
    warnings.push(
      `${build.pactSpiritIds.length} pact spirits bound but only ${MAX_PACT_SPIRITS} allowed; extras ignored`
    );
  }
  for (const spiritId of boundSpirits) {
    const spirit = index.pactSpirit(spiritId);
    if (!spirit) warnings.push(`unknown pact spirit: ${spiritId}`);
    else raw.push(...spirit.modifiers);
  }

  for (const memoryId of build.memoryIds) {
    const memory = index.memory(memoryId);
    if (!memory) warnings.push(`unknown memory: ${memoryId}`);
    else raw.push(...memory.modifiers);
  }

  raw.push(...build.extraModifiers);

  const modifiers = raw.filter((m) => tagsAllow(m, skill));
  return { modifiers, skill, warnings };
}

/** Full evaluation of a build: collect modifiers, then compute offence + defence. */
export function evaluateBuild(build: Build, index: DatasetIndex): BuildReport {
  const { modifiers, skill, warnings } = collectModifiers(build, index);
  return {
    skill,
    modifiers,
    damage: computeDamage(skill, modifiers),
    defense: computeDefense(modifiers),
    warnings
  };
}
