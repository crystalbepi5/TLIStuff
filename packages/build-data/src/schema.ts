// Schema for the Torchlight Infinite build dataset.
//
// This models the pieces a player assembles into a build — heroes, active and
// support skills, affixes, and gear bases — plus the saved-build shape the
// planner UI reads and writes.
//
// The seed dataset (packages/build-data/src/seed) is curated by hand from the
// official SS13 "Afterlight" patch notes — names and quoted values are real,
// but mapped onto this simplified model (see each seed file's note). Effects
// that depend on mechanics this calculator doesn't model (Terra Charge stacks,
// Spell Burst, Bond, shotgun falloff, conditionals) are approximated to the
// nearest modelled stat or dropped. The scraper (packages/build-scraper) is the
// path to a fuller dataset; the schema below is what it emits and what
// packages/build-calc consumes.

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
  // NB: these are increased *Area/Projectile Damage*, applied to skills carrying
  // the tag — NOT AoE size or projectile count. Don't map "Skill Area" (radius)
  // or "+N Projectiles" here; those aren't damage and aren't modelled.
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
  /** Short hero/trait blurb, e.g. Selena's water/Terra theme. */
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

/** A Pact Spirit the hero binds for passive bonuses. */
export interface PactSpirit {
  id: string;
  name: string;
  description?: string;
  modifiers: Modifier[];
}

/**
 * A Nether King's Divinity node — SS13's craftable Divinity Slate progression.
 * Each entry is one inscribed Talent Node modelled as a bundle of modifiers.
 * The socket/craft mechanics aren't modelled; only the resulting stats are.
 */
export interface Divinity {
  id: string;
  name: string;
  description?: string;
  modifiers: Modifier[];
  /** Node tier, informational: 'small' | 'medium' | 'legendary' | 'ultimate'. */
  tier?: 'small' | 'medium' | 'legendary' | 'ultimate';
  season?: string;
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
  divinities: Divinity[];
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
  /** Allocated talent-tree nodes. */
  talentIds: string[];
  /** Bound Pact Spirits (capped by MAX_PACT_SPIRITS in build-calc). */
  pactSpiritIds: string[];
  /** Inscribed Nether King's Divinity nodes. */
  divinityIds: string[];
  /** Free-form extra modifiers — an escape hatch for anything not modelled. */
  extraModifiers: Modifier[];
}
