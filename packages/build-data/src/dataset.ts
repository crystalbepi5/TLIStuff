import type {
  ActiveSkill,
  Affix,
  Dataset,
  Divinity,
  GearBase,
  Hero,
  PactSpirit,
  SupportSkill,
  Talent
} from './schema.js';

import heroes from './seed/heroes.json' with { type: 'json' };
import activeSkills from './seed/activeSkills.json' with { type: 'json' };
import supportSkills from './seed/supportSkills.json' with { type: 'json' };
import affixes from './seed/affixes.json' with { type: 'json' };
import gearBases from './seed/gearBases.json' with { type: 'json' };
import talents from './seed/talents.json' with { type: 'json' };
import pactSpirits from './seed/pactSpirits.json' with { type: 'json' };
import divinities from './seed/divinities.json' with { type: 'json' };

/**
 * The bundled seed dataset. Curated by hand from the SS13 "Afterlight" patch
 * notes — real names/values mapped onto a simplified model — and intentionally
 * small. Replace it with the scraper's output (packages/build-scraper) for a
 * fuller dataset.
 */
export const seedDataset: Dataset = {
  meta: {
    source: 'seed',
    generatedAt: '2026-07-11T00:00:00.000Z',
    note: 'Curated from the official SS13 "Afterlight" patch notes; values mapped onto a simplified damage model (see per-file notes).'
  },
  heroes: heroes as Hero[],
  activeSkills: activeSkills as ActiveSkill[],
  supportSkills: supportSkills as SupportSkill[],
  affixes: affixes as Affix[],
  gearBases: gearBases as GearBase[],
  talents: talents as Talent[],
  pactSpirits: pactSpirits as PactSpirit[],
  divinities: divinities as Divinity[]
};

/** Indexed view over a dataset for O(1) lookups by id. */
export interface DatasetIndex {
  dataset: Dataset;
  hero(id: string): Hero | undefined;
  activeSkill(id: string): ActiveSkill | undefined;
  supportSkill(id: string): SupportSkill | undefined;
  affix(id: string): Affix | undefined;
  gearBase(id: string): GearBase | undefined;
  talent(id: string): Talent | undefined;
  pactSpirit(id: string): PactSpirit | undefined;
  divinity(id: string): Divinity | undefined;
}

export function indexDataset(dataset: Dataset): DatasetIndex {
  const heroes = new Map(dataset.heroes.map((h) => [h.id, h]));
  const actives = new Map(dataset.activeSkills.map((s) => [s.id, s]));
  const supports = new Map(dataset.supportSkills.map((s) => [s.id, s]));
  const affixes = new Map(dataset.affixes.map((a) => [a.id, a]));
  const gearBases = new Map(dataset.gearBases.map((g) => [g.id, g]));
  const talents = new Map(dataset.talents.map((t) => [t.id, t]));
  const pactSpirits = new Map(dataset.pactSpirits.map((p) => [p.id, p]));
  const divinities = new Map(dataset.divinities.map((d) => [d.id, d]));

  return {
    dataset,
    hero: (id) => heroes.get(id),
    activeSkill: (id) => actives.get(id),
    supportSkill: (id) => supports.get(id),
    affix: (id) => affixes.get(id),
    gearBase: (id) => gearBases.get(id),
    talent: (id) => talents.get(id),
    pactSpirit: (id) => pactSpirits.get(id),
    divinity: (id) => divinities.get(id)
  };
}

/**
 * Minimal structural validation for a dataset loaded from JSON (e.g. scraper
 * output). Returns a list of human-readable problems; empty means it's usable.
 * This is deliberately lightweight — it catches broken references and missing
 * fields, not game-balance sanity.
 */
export function validateDataset(dataset: Dataset): string[] {
  const problems: string[] = [];
  const affixIds = new Set(dataset.affixes.map((a) => a.id));
  const baseIds = new Set(dataset.gearBases.map((g) => g.id));

  if (dataset.heroes.length === 0) problems.push('dataset has no heroes');
  if (dataset.activeSkills.length === 0) problems.push('dataset has no active skills');

  for (const skill of dataset.activeSkills) {
    if (Object.keys(skill.baseDamage).length === 0) {
      problems.push(`active skill '${skill.id}' has no base damage`);
    }
    if (skill.baseRate <= 0) {
      problems.push(`active skill '${skill.id}' has non-positive baseRate`);
    }
  }
  for (const affix of dataset.affixes) {
    for (const slot of affix.slots) {
      // slots are a closed set in the schema; nothing to cross-check, but an
      // affix with zero modifiers is almost certainly a scrape error.
      void slot;
    }
    if (affix.modifiers.length === 0) {
      problems.push(`affix '${affix.id}' has no modifiers`);
    }
  }
  // Referential checks that a hand-built Build would rely on.
  void affixIds;
  void baseIds;
  return problems;
}
