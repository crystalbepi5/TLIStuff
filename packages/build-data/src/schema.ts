// Schema for the Torchlight Infinite build dataset.
//
// This models the pieces a player assembles into a build — heroes, active and
// support skills, affixes, and gear bases — plus the saved-build shape the
// planner UI reads and writes.
//
// IMPORTANT: the *numbers* in the seed dataset (packages/build-data/src/seed)
// are hand-entered approximations, not verified against the game. Torchlight
// Infinite does not publish its data tables or damage formulas. The scraper
// (packages/build-scraper) is the intended path to a real, complete dataset;
// the schema below is what it emits and what packages/build-calc consumes.

/** Damage / defence element used throughout the game. */
export type Element = 'physical' | 'fire' | 'cold' | 'lightning' | 'erosion';

/** The four elemental resistances (physical has no resistance in TLI). */
export type ResistableElement = Exclude<Element, 'physical'>;

/** How a skill deals its damage. Drives which "increased" pools apply. */
export type DamageTag =
  | 'attack'
  | 'spell'
  | 'projectile'
  | 'area'
  | 'melee'
  | 'channelled'
  | 'dot'
  | 'minion';

/**
 * The knobs the calculator understands. Kept as a flat string union so the
 * dataset stays declarative and the engine can aggregate generically. New
 * stats can be added here without touching the aggregation code.
 */
export type StatKey =
  // offensive — per element added flat damage
  | 'addedPhysical'
  | 'addedFire'
  | 'addedCold'
  | 'addedLightning'
  | 'addedErosion'
  // offensive — scaling
  | 'increasedDamage'
  | 'increasedPhysical'
  | 'increasedFire'
  | 'increasedCold'
  | 'increasedLightning'
  | 'increasedErosion'
  | 'increasedElemental'
  | 'increasedAttack'
  | 'increasedSpell'
  | 'increasedArea'
  | 'increasedProjectile'
  | 'moreDamage'
  // rate
  | 'increasedAttackSpeed'
  | 'increasedCastSpeed'
  // crit
  | 'critRate' // additive percentage points, e.g. +2 -> +2% crit chance
  | 'increasedCritRate' // scales base crit rate
  | 'critDamage' // additive percentage points onto the crit multiplier
  // defence
  | 'life'
  | 'increasedLife'
  | 'energyShield'
  | 'increasedEnergyShield'
  | 'armor'
  | 'increasedArmor'
  | 'fireResist'
  | 'coldResist'
  | 'lightningResist'
  | 'erosionResist'
  | 'block';

/** A single stat contribution. `op` selects which aggregation bucket it lands in. */
export interface Modifier {
  stat: StatKey;
  /**
   * - `flat`      adds to the base pool (added damage, +life, +resist points…)
   * - `increased` sums with all other `increased` of the same stat (PoE-style)
   * - `more`      multiplies (each is its own multiplier)
   */
  op: 'flat' | 'increased' | 'more';
  value: number;
  /** Optional: restrict this modifier to skills carrying one of these tags. */
  tags?: DamageTag[];
}

export interface Hero {
  id: string;
  name: string;
  /** Short hero/trait blurb, e.g. Selina's water theme. */
  description: string;
  /** Passive modifiers the hero grants unconditionally. */
  baseModifiers: Modifier[];
  /** Season this hero was introduced, e.g. "SS13". */
  season?: string;
}

/**
 * One entry of a skill's per-level scaling, in the same Modifier shape the
 * rest of the calculator understands, so a level pick can be aggregated the
 * same way as any other modifier source. Populated best-effort by the
 * scraper (see tlicompendium.ts's buildLevelScaling) by reconstructing the
 * real tooltip text at each level and re-running the same text->Modifier
 * engine used everywhere else — not every skill can be confidently mapped
 * (see that function's docs), so this is optional and may be absent/partial.
 */
export interface SkillLevelEntry {
  level: number;
  modifiers: Modifier[];
}

export interface ActiveSkill {
  id: string;
  name: string;
  tags: DamageTag[];
  /** Base damage the skill deals, per element, at the modelled level. */
  baseDamage: Partial<Record<Element, number>>;
  /** Attacks/casts per second before any speed scaling. */
  baseRate: number;
  /** Base crit rate as a percentage, e.g. 5 -> 5%. */
  baseCritRate: number;
  /** Max support skills this active can socket. */
  supportSlots: number;
  season?: string;
  /** Per-level modifiers, if the scraper could confidently reconstruct them
   * (see SkillLevelEntry). Absent -> callers fall back to baseDamage, which
   * reflects a single fixed level. */
  levelScaling?: SkillLevelEntry[];
  manaCost?: number;
  /** Attribute(s) this skill scales with, e.g. ["Strength"]. */
  mainStat?: string[];
}

export interface SupportSkill {
  id: string;
  name: string;
  /** Modifiers applied to any active skill this supports. */
  modifiers: Modifier[];
  /** Only applies to actives carrying at least one of these tags (empty = any). */
  requiresTags: DamageTag[];
  /** e.g. 130 -> this support multiplies the socketed skill's mana cost by 130%. */
  manaMultiplier?: number;
  /** Active-skill tags this support is incompatible with (raw source strings,
   * not normalised to DamageTag -- informational until cross-referenced). */
  cannotSupport?: string[];
  /**
   * Set only for "signature" supports scoped to one specific active skill
   * (the game's Magnificent/Noble Support categories -- confirmed against
   * the real scrape: every entry in both categories carries a `skillTag`
   * naming its one active skill, while the generic Support/Activation
   * Medium/Module/Passive categories never carry one at all). Value is the
   * matching ActiveSkill.id (same idFromName() derivation as everywhere
   * else). A tag-based `requiresTags` check can't express "only this one
   * exact skill", so this is checked separately in collectModifiers.
   */
  requiresSkillId?: string;
  /** Per-level modifiers, best-effort (see ActiveSkill.levelScaling). */
  levelScaling?: SkillLevelEntry[];
}

/**
 * One craftable tier of an affix, with the real weight the game's crafting
 * RNG uses to pick it (see tlicompendium.ts's mapAffixes) -- 0 means the tier
 * is currently disabled/unobtainable, not that it's impossible to weight.
 */
export interface AffixTier {
  tier: string;
  levelRequirement?: number;
  weight: number;
  modifiers: Modifier[];
  modifierId?: string;
}

/** An affix that can roll on gear. */
export interface Affix {
  id: string;
  name: string;
  /** 'prefix' | 'suffix' — informational; not enforced by the calculator. */
  kind: 'prefix' | 'suffix';
  /** The top (best-roll) tier's modifiers -- kept for callers that don't care
   * which tier landed, e.g. the existing build-calc aggregation. */
  modifiers: Modifier[];
  /** Gear slots this affix can appear on. */
  slots: GearSlot[];
  /**
   * The game's internal modifier ids this affix corresponds to (all tiers /
   * gear subtypes that share the same stat). Lets a future loot parser map a
   * dropped item's rolled affix id back to this entry for pricing.
   */
  modifierIds?: string[];
  /**
   * Every craftable tier with its real weight, for a crafting-odds
   * simulator. Absent for affixes that were only ever seen at one tier.
   */
  tiers?: AffixTier[];
}

export type GearSlot =
  | 'weapon'
  | 'offhand'
  | 'helmet'
  | 'chest'
  | 'gloves'
  | 'boots'
  | 'belt'
  | 'amulet'
  | 'ring';

export interface GearBase {
  id: string;
  name: string;
  slot: GearSlot;
  /** Implicit modifiers inherent to the base (before affixes). */
  implicit: Modifier[];
  /** tlidb.com item id — a stable cross-reference for loot/price lookups. */
  tlidbId?: string;
}

/**
 * A node in a hero's trait/talent tree. `heroId` scopes it to one hero, or
 * `'any'` for shared nodes. Point budgets aren't modelled — a node is simply
 * allocated or not.
 */
export interface Talent {
  id: string;
  name: string;
  description?: string;
  heroId: string | 'any';
  modifiers: Modifier[];
}

/** One step of a Pact Spirit's linear effect chain. */
export interface PactSpiritNode {
  nodeId: number;
  nodeType?: string;
  /** Next node in the chain, or null/absent at the end. */
  nextNode?: number | null;
  modifiers: Modifier[];
}

/** A Pact Spirit the hero binds for passive bonuses. */
export interface PactSpirit {
  id: string;
  name: string;
  description?: string;
  /** Every node's modifiers flattened together, for callers that don't care
   * about the chain structure (the existing build-calc aggregation). */
  modifiers: Modifier[];
  /** The real node-by-node chain, if scraped from tlicompendium's pactspirit
   * bundle rather than hand-seeded. */
  nodes?: PactSpiritNode[];
  typeCode?: string;
  rarity?: string;
  iconUrl?: string;
}

/**
 * An SS13 "Memory Revival" awakening -- a specific named, non-tiered effect
 * (as opposed to the tiered/weighted affix pools below). Modelled here as a
 * selectable bundle of modifiers.
 */
export interface MemoryRevival {
  id: string;
  name: string;
  description?: string;
  modifiers: Modifier[];
  season?: string;
}

/**
 * One of Memory Revival's weighted affix pools (base stats, fixed affixes,
 * random affixes, revived affixes, special random affixes) -- structurally
 * identical to a gear Affix's tier list, since the underlying game data uses
 * the same modifierId/tier/level/weight shape. Keyed by `memoryType`
 * ("Origin" | "Discipline" | "Progress" | "Any") in MemoryAffixPools below.
 */
export interface MemoryAffix {
  id: string;
  name: string;
  modifiers: Modifier[];
  modifierIds?: string[];
  tiers?: AffixTier[];
}

export interface MemoryAffixPools {
  baseStats: MemoryAffix[];
  fixedAffixes: MemoryAffix[];
  randomAffixes: MemoryAffix[];
  revivedAffixes: MemoryAffix[];
  specialRandomAffixes: MemoryAffix[];
}

/** A node in a Void Chart / Talent Tree graph, shared shape for both (see
 * VoidChartTree and TalentTree) since they're structurally the same idea:
 * a real position, real graph edges, and a small list of typed effects. */
export interface ProgressionNode {
  id: string;
  tlidbId?: string;
  type?: string;
  name?: string;
  description?: string;
  icon?: string;
  /** Graph edges to other nodes' `id`, however the source bundle expresses
   * them (Void Chart: bidirectional `connections`; Talent Tree: `ancestor` +
   * `predecessors`) -- normalised here into one adjacency list. */
  connections: string[];
  maxPoints?: number;
  position?: { x: number; y: number };
  modifiers: Modifier[];
}

/** A Void Chart meta-progression tree (one per season/category, e.g. "war",
 * "vorax", "aeterna") or a hero-archetype Talent Tree (Alchemist, God of
 * War, ...). Purely a real-game-data reference for now -- not yet wired into
 * Build/collectModifiers, since these are account-wide unlocks rather than
 * per-build loadout choices like gear/skills/talents. */
export interface ProgressionTree {
  id: string;
  name: string;
  icon?: string;
  nodes: ProgressionNode[];
}

/** A Vorax limb gear base (SS13's extra equipment slot) -- kept distinct
 * from GearBase/GearSlot since a Vorax limb is worn *in addition to* normal
 * gear, not instead of it, and its slot names ("digits", "waist", ...) don't
 * map onto the existing closed GearSlot union. */
export interface VoraxGearBase {
  id: string;
  name: string;
  limb: string;
  icon?: string;
  modifiers: Modifier[];
}

/** A Vorax-exclusive legendary, with its normal and "corroded" (mutated)
 * variant values -- corroded is a distinct value set, not a modifier op. */
export interface VoraxLegendary {
  id: string;
  limb: string;
  icon?: string;
  modifiers: Modifier[];
  corrodedModifiers?: Modifier[];
}

/** A Vorax limb's craftable affix, same tiered/weighted shape as a regular
 * gear Affix. */
export interface VoraxAffix {
  id: string;
  limb: string;
  modifiers: Modifier[];
  tiers?: AffixTier[];
}

/** A Kismet: a small rarity-tiered charm-like item (SS9+), one optional
 * effect each (many carry no published effect text at all -- kept as an
 * empty modifiers list rather than omitted, same as every other
 * best-effort-parsed category). No `name` field in the scraped data. */
export interface Kismet {
  id: string;
  iconUrl?: string;
  rarity?: string;
  type?: string;
  modifiers: Modifier[];
}

/** The whole dataset, as loaded by the app and emitted by the scraper. */
export interface Dataset {
  /** Provenance so the UI can show "seed data" vs. a real scrape, and when. */
  meta: {
    source: 'seed' | 'scrape';
    generatedAt: string;
    /** Free-form note, e.g. the DB URL and season scraped. */
    note?: string;
  };
  heroes: Hero[];
  activeSkills: ActiveSkill[];
  supportSkills: SupportSkill[];
  affixes: Affix[];
  gearBases: GearBase[];
  talents: Talent[];
  pactSpirits: PactSpirit[];
  memories: MemoryRevival[];
  /** Memory Revival's weighted affix pools -- absent when not yet scraped. */
  memoryAffixPools?: MemoryAffixPools;
  /** Void Chart meta-progression trees (one per season/category) and hero
   * archetype Talent Trees -- reference data, not yet wired into Build. */
  voidCharts?: ProgressionTree[];
  talentTrees?: ProgressionTree[];
  voraxGearBases?: VoraxGearBase[];
  voraxAffixes?: VoraxAffix[];
  voraxLegendaries?: VoraxLegendary[];
  kismets?: Kismet[];
}

/** A piece of gear the player has assembled: a base plus chosen affixes. */
export interface GearPiece {
  slot: GearSlot;
  baseId: string;
  affixIds: string[];
}

/**
 * A piece of Vorax gear -- SS13's extra "limb" slot, worn in addition to
 * normal gear (see VoraxAffix/VoraxLegendary). Keyed by `limb` (a free-form
 * string like "head" or "aberrant digits", not the closed GearSlot union)
 * since it's a separate slot system layered on top of regular gear.
 */
export interface VoraxGearPiece {
  limb: string;
  legendaryId?: string;
  affixIds: string[];
}

/** A complete saved build — what the planner serialises to a share string. */
export interface Build {
  id: string;
  name: string;
  heroId: string;
  /** The main active skill and its socketed supports. */
  activeSkillId: string;
  supportIds: string[];
  gear: GearPiece[];
  /** Vorax limb gear (legendary + affixes per limb slot). */
  voraxGear: VoraxGearPiece[];
  /** Allocated hero traits (the flat per-hero Talent list, see mapHeroTraits --
   * a different system from the graph-shaped talentTrees/talentTreeNodeIds
   * below, despite the similar name). */
  talentIds: string[];
  /** Selected nodes from the hero-archetype Talent Trees (graph-shaped,
   * see ProgressionTree/talentTrees). */
  talentTreeNodeIds: string[];
  /** Selected nodes from the Void Chart meta-progression trees (graph-shaped,
   * see ProgressionTree/voidCharts). Most nodes have no modeled effect yet
   * (best-effort text parsing recognizes only a small fraction) -- selecting
   * one is still meaningful as a real account-progression record, just often
   * contributes zero modifiers today. */
  voidChartNodeIds: string[];
  /** Bound Pact Spirits (capped by MAX_PACT_SPIRITS in build-calc). */
  pactSpiritIds: string[];
  /** Selected Memory Revival awakenings. */
  memoryIds: string[];
  /** Free-form extra modifiers — an escape hatch for anything not modelled. */
  extraModifiers: Modifier[];
}
