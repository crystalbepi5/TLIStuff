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
}

export interface SupportSkill {
  id: string;
  name: string;
  /** Modifiers applied to any active skill this supports. */
  modifiers: Modifier[];
  /** Only applies to actives carrying at least one of these tags (empty = any). */
  requiresTags: DamageTag[];
}

/** An affix that can roll on gear. */
export interface Affix {
  id: string;
  name: string;
  /** 'prefix' | 'suffix' — informational; not enforced by the calculator. */
  kind: 'prefix' | 'suffix';
  modifiers: Modifier[];
  /** Gear slots this affix can appear on. */
  slots: GearSlot[];
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
}

/** A piece of gear the player has assembled: a base plus chosen affixes. */
export interface GearPiece {
  slot: GearSlot;
  baseId: string;
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
  /** Free-form extra modifiers (talent tree, pact spirits, Memory Revival…). */
  extraModifiers: Modifier[];
}
