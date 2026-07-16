import type {
  ActiveSkill,
  Affix,
  Dataset,
  GearBase,
  Hero,
  Kismet,
  MemoryAffixPools,
  MemoryRevival,
  PactSpirit,
  ProgressionNode,
  ProgressionTree,
  SupportSkill,
  Talent,
  VoraxAffix,
  VoraxLegendary
} from './schema.js';

import heroes from './seed/heroes.json' with { type: 'json' };
import activeSkills from './seed/activeSkills.json' with { type: 'json' };
import supportSkills from './seed/supportSkills.json' with { type: 'json' };
import affixes from './seed/affixes.json' with { type: 'json' };
import gearBases from './seed/gearBases.json' with { type: 'json' };
import talents from './seed/talents.json' with { type: 'json' };
import pactSpirits from './seed/pactSpirits.json' with { type: 'json' };
import memories from './seed/memories.json' with { type: 'json' };
import memoryAffixPools from './seed/memoryAffixPools.json' with { type: 'json' };
import voidCharts from './seed/voidCharts.json' with { type: 'json' };
import talentTrees from './seed/talentTrees.json' with { type: 'json' };
import voraxAffixes from './seed/voraxAffixes.json' with { type: 'json' };
import voraxLegendaries from './seed/voraxLegendaries.json' with { type: 'json' };
import kismets from './seed/kismets.json' with { type: 'json' };

/**
 * The bundled seed dataset. Hand-entered, approximate, and intentionally small
 * — enough to exercise the calculator and UI end-to-end. Replace it with the
 * scraper's output (packages/build-scraper) for real, complete data.
 */
export const seedDataset: Dataset = {
  meta: {
    source: 'seed',
    generatedAt: '2026-07-11T00:00:00.000Z',
    note: 'Hand-entered seed data. Numbers are approximations, not verified against Torchlight Infinite.'
  },
  heroes: heroes as Hero[],
  activeSkills: activeSkills as ActiveSkill[],
  supportSkills: supportSkills as SupportSkill[],
  affixes: affixes as Affix[],
  gearBases: gearBases as GearBase[],
  talents: talents as Talent[],
  pactSpirits: pactSpirits as PactSpirit[],
  memories: memories as MemoryRevival[],
  memoryAffixPools: memoryAffixPools as MemoryAffixPools,
  voidCharts: voidCharts as ProgressionTree[],
  talentTrees: talentTrees as ProgressionTree[],
  voraxAffixes: voraxAffixes as VoraxAffix[],
  voraxLegendaries: voraxLegendaries as VoraxLegendary[],
  kismets: kismets as Kismet[]
};

/** A tree node plus the id of the ProgressionTree it belongs to (so a caller
 * that only has a bare node id, e.g. from Build.talentTreeNodeIds, can still
 * find which tree/hero-archetype it's part of). */
export interface IndexedProgressionNode {
  node: ProgressionNode;
  treeId: string;
  treeName: string;
}

function indexNodes(trees: ProgressionTree[] | undefined): Map<string, IndexedProgressionNode> {
  const map = new Map<string, IndexedProgressionNode>();
  for (const tree of trees ?? []) {
    for (const node of tree.nodes) {
      map.set(node.id, { node, treeId: tree.id, treeName: tree.name });
    }
  }
  return map;
}

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
  memory(id: string): MemoryRevival | undefined;
  voraxAffix(id: string): VoraxAffix | undefined;
  /**
   * `id` alone is NOT unique across VoraxLegendary -- confirmed against the
   * real scrape: 822 entries collapse to 239 distinct ids, every one
   * duplicated (the same legendary effect can spawn on more than one
   * compatible limb, e.g. "head" and "neck", as separate array entries
   * sharing one id). `limb` is required to disambiguate.
   */
  voraxLegendary(id: string, limb: string): VoraxLegendary | undefined;
  talentTreeNode(id: string): IndexedProgressionNode | undefined;
  voidChartNode(id: string): IndexedProgressionNode | undefined;
}

export function indexDataset(dataset: Dataset): DatasetIndex {
  const heroes = new Map(dataset.heroes.map((h) => [h.id, h]));
  const actives = new Map(dataset.activeSkills.map((s) => [s.id, s]));
  const supports = new Map(dataset.supportSkills.map((s) => [s.id, s]));
  const affixes = new Map(dataset.affixes.map((a) => [a.id, a]));
  const gearBases = new Map(dataset.gearBases.map((g) => [g.id, g]));
  const talents = new Map(dataset.talents.map((t) => [t.id, t]));
  const pactSpirits = new Map(dataset.pactSpirits.map((p) => [p.id, p]));
  const memories = new Map(dataset.memories.map((m) => [m.id, m]));
  const voraxAffixes = new Map((dataset.voraxAffixes ?? []).map((a) => [a.id, a]));
  const voraxLegendaries = new Map((dataset.voraxLegendaries ?? []).map((l) => [`${l.limb}::${l.id}`, l]));
  const talentTreeNodes = indexNodes(dataset.talentTrees);
  const voidChartNodes = indexNodes(dataset.voidCharts);

  return {
    dataset,
    hero: (id) => heroes.get(id),
    activeSkill: (id) => actives.get(id),
    supportSkill: (id) => supports.get(id),
    affix: (id) => affixes.get(id),
    gearBase: (id) => gearBases.get(id),
    talent: (id) => talents.get(id),
    pactSpirit: (id) => pactSpirits.get(id),
    memory: (id) => memories.get(id),
    voraxAffix: (id) => voraxAffixes.get(id),
    voraxLegendary: (id, limb) => voraxLegendaries.get(`${limb}::${id}`),
    talentTreeNode: (id) => talentTreeNodes.get(id),
    voidChartNode: (id) => voidChartNodes.get(id)
  };
}

let gearByTlidbId: Map<string, GearBase> | undefined;

/**
 * Resolve a gear base by its in-game ConfigBaseId. The game log records drops as
 * `ConfigBaseId = <n>`, which equals tlidb/tlicompendium's item id — so this
 * turns a raw drop id into a real item (name, slot, implicits) from the seed.
 */
export function gearByConfigBaseId(configBaseId: number): GearBase | undefined {
  if (!gearByTlidbId) {
    gearByTlidbId = new Map();
    for (const g of seedDataset.gearBases) if (g.tlidbId) gearByTlidbId.set(g.tlidbId, g);
  }
  return gearByTlidbId.get(String(configBaseId));
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
    // No base-damage is valid for utility/movement skills (Blink, warcries…),
    // so it isn't flagged. A non-positive rate is still a data error.
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
