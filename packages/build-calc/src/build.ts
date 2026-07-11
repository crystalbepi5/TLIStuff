import type {
  ActiveSkill,
  Build,
  DatasetIndex,
  Modifier
} from '@torchlight-companion/build-data';
import { computeDamage, type DamageResult } from './damage.js';
import { computeDefense, type DefenseResult } from './defense.js';

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
    const matches =
      support.requiresTags.length === 0 ||
      support.requiresTags.some((t) => skill.tags.includes(t));
    if (!matches) {
      warnings.push(`support '${support.name}' requires tags [${support.requiresTags.join(', ')}] which ${skill.name} lacks; ignored`);
      continue;
    }
    raw.push(...support.modifiers);
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
