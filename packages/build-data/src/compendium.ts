// Adapter: TLI Compendium build export (JSON) -> our Build.
//
// What the export lets us map, and what it doesn't:
//
//   MAPPABLE  — gear affixes and Divinity-slate nodes carry human-readable text
//               ("+#% Lightning Resistance", "Adds # - # Fire Damage to Spells",
//               "+30 % additional Spell Damage") plus rolled values. We parse
//               that text into our Modifier model.
//   OPAQUE    — skills, hero traits, hero-memories, and skill-tree nodes are
//               stored as bare GUIDs with no names or stat text. They can't be
//               reconstructed without Compendium's internal data dictionary, so
//               they're dropped (with a warning) and DPS can't be computed —
//               there's no main-skill base damage to scale.
//
// The imported build therefore captures a character's *gear + divinity* stats
// (life, resistances, crit, added/increased damage, cast/attack speed …) as
// `extraModifiers`. Pick a main skill afterward to get a DPS estimate.

import type { Build, Element, Modifier, StatKey } from './schema.js';

// ------------------------------ text parsing ------------------------------

const ADDED: Record<Element, StatKey> = {
  physical: 'addedPhysical',
  fire: 'addedFire',
  cold: 'addedCold',
  lightning: 'addedLightning',
  erosion: 'addedErosion'
};

const INCREASED_ELEMENT: Record<Element, StatKey> = {
  physical: 'increasedPhysical',
  fire: 'increasedFire',
  cold: 'increasedCold',
  lightning: 'increasedLightning',
  erosion: 'increasedErosion'
};

const RESIST: Record<Exclude<Element, 'physical'>, StatKey> = {
  fire: 'fireResist',
  cold: 'coldResist',
  lightning: 'lightningResist',
  erosion: 'erosionResist'
};

/** Substitute `#` placeholders left-to-right with rolled values. */
export function resolveText(text: string, values: number[]): string {
  let i = 0;
  return text.replace(/#/g, () => (i < values.length ? String(values[i++]) : '#'));
}

const NUM = '([+-]?\\d+(?:\\.\\d+)?)';

/**
 * Parse one resolved modifier line into zero or more Modifiers. Conservative by
 * design: unrecognised lines (tangle, sealed mana, penetration, movement/
 * projectile speed, attributes, skill levels, conditionals) yield nothing and
 * are counted as unmapped by the caller.
 */
export function parseModifierLine(raw: string): Modifier[] {
  const line = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!line) return [];

  // "Adds A - B <Element> Damage" -> averaged flat added damage. Exclusive.
  const added = line.match(
    new RegExp(`adds ${NUM} ?- ?${NUM} (fire|cold|lightning|erosion|physical) damage`)
  );
  if (added) {
    const avg = (Number(added[1]) + Number(added[2])) / 2;
    return [{ stat: ADDED[added[3] as Element], op: 'flat', value: avg }];
  }

  const mods: Modifier[] = [];
  const first = (re: RegExp): number | null => {
    const m = line.match(re);
    return m ? Number(m[1]) : null;
  };
  const has = (s: string) => line.includes(s);

  // --- resistances (skip penetration) ---
  if (!has('penetration')) {
    for (const el of ['fire', 'cold', 'lightning', 'erosion'] as const) {
      const v = first(new RegExp(`${NUM} ?% ${el} resistance`));
      if (v !== null) mods.push({ stat: RESIST[el], op: 'flat', value: v });
    }
    const elemRes = first(new RegExp(`${NUM} ?% elemental(?: and erosion)? resistance`));
    if (elemRes !== null) {
      mods.push({ stat: 'fireResist', op: 'flat', value: elemRes });
      mods.push({ stat: 'coldResist', op: 'flat', value: elemRes });
      mods.push({ stat: 'lightningResist', op: 'flat', value: elemRes });
      if (has('erosion')) mods.push({ stat: 'erosionResist', op: 'flat', value: elemRes });
    }
  }

  // --- life ---
  const incLife =
    first(new RegExp(`${NUM} ?% additional max life`)) ??
    first(new RegExp(`${NUM} ?% max life and max mana`));
  if (incLife !== null) {
    mods.push({ stat: 'increasedLife', op: 'increased', value: incLife });
  } else {
    const flatLife = first(new RegExp(`${NUM} max life`));
    if (flatLife !== null && !has('%')) mods.push({ stat: 'life', op: 'flat', value: flatLife });
  }

  // --- increased damage pools (adjacent phrases so "spell critical strike
  //     damage" doesn't match "spell damage") ---
  const pushIncreased = (phrase: string, stat: StatKey) => {
    const v = first(new RegExp(`${NUM} ?%[^]*?\\b${phrase}\\b`));
    if (v !== null) mods.push({ stat, op: 'increased', value: v });
  };
  pushIncreased('spell damage', 'increasedSpell');
  pushIncreased('elemental damage', 'increasedElemental');
  pushIncreased('projectile damage', 'increasedProjectile');
  pushIncreased('area damage', 'increasedArea');
  if (!has('adds') && !has('resistance')) {
    for (const el of ['fire', 'cold', 'lightning', 'erosion'] as const) {
      const v = first(new RegExp(`${NUM} ?%[^]*?\\b${el} damage\\b`));
      if (v !== null) mods.push({ stat: INCREASED_ELEMENT[el], op: 'increased', value: v });
    }
  }

  // --- crit & speed ---
  const critDmg = first(new RegExp(`${NUM} ?%[^]*?critical strike damage`));
  if (critDmg !== null) mods.push({ stat: 'critDamage', op: 'flat', value: critDmg });
  const cast = first(new RegExp(`${NUM} ?%[^]*?cast speed`));
  if (cast !== null) mods.push({ stat: 'increasedCastSpeed', op: 'increased', value: cast });
  const atk = first(new RegExp(`${NUM} ?%[^]*?attack[^]*?speed`));
  if (atk !== null) mods.push({ stat: 'increasedAttackSpeed', op: 'increased', value: atk });

  return mods;
}

// --------------------------- export traversal -----------------------------

type Json = Record<string, unknown>;

/** Pull {text, values} pairs from any affix-ish object shape in the export. */
function readAffix(obj: unknown): { text: string; values: number[] } | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Json;
  const text = (o.modifierDescription ?? o.description ?? o.rawText) as string | undefined;
  if (typeof text !== 'string' || text.length === 0) return null;
  const rolled = (o.rolledValues ?? o.values) as Array<{ value?: unknown }> | undefined;
  const values = Array.isArray(rolled)
    ? rolled.map((v) => (typeof v?.value === 'number' ? v.value : NaN)).filter((n) => !Number.isNaN(n))
    : [];
  return { text, values };
}

function collectFromArray(arr: unknown, sink: Array<{ text: string; values: number[] }>): void {
  if (!Array.isArray(arr)) return;
  for (const el of arr) {
    const a = readAffix(el);
    if (a) sink.push(a);
  }
}

/** Every text-bearing affix source on one equipped gear item. */
function collectFromGearItem(item: Json, sink: Array<{ text: string; values: number[] }>): void {
  const base = item.baseItem as Json | undefined;
  if (base) collectFromArray(base.implicits, sink);
  collectFromArray(item.legendaryMods, sink);
  collectFromArray(item.prefixes, sink);
  collectFromArray(item.suffixes, sink);
  collectFromArray(item.affixes, sink); // vorax
  for (const key of ['baseAffix', 'baseAffix2', 'sweetDreamAffix', 'corrosionImplicit', 'towerSequence', 'beltBlend']) {
    const a = readAffix(item[key]);
    if (a) sink.push(a);
  }
}

export function isCompendiumExport(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Json;
  const loadouts = o.loadouts as Json | undefined;
  return Array.isArray(loadouts?.loadouts);
}

/** One category of a Compendium data-bundle: guid -> readable text. */
export type GuidDictionary = Record<string, { description?: string; template?: string }>;

/**
 * The hero-memory data bundle (e.g. tlicompendium.com/data-bundles/
 * SS12.5-hero-memory-en.json), which resolves the opaque memory-affix guids in
 * a build export to readable stat text. Supplied by the caller — the bundle is
 * hosted on a blocked host, so it can't be fetched from here.
 */
export interface HeroMemoryDict {
  baseStats?: GuidDictionary;
  fixedAffixes?: GuidDictionary;
  randomAffixes?: GuidDictionary;
  revivedAffixes?: GuidDictionary;
}

export interface CompendiumOptions {
  /** When given, equipped hero-memory affixes are resolved and included. */
  heroMemoryDict?: HeroMemoryDict;
}

export interface CompendiumImport {
  build: Build;
  warnings: string[];
}

/**
 * Resolve one guid-keyed memory affix ({guid, value, unit}) to modifiers, using
 * a dictionary that maps the guid to a stat description. Reuses the same text
 * parser as gear by synthesising a line like "+52% Max Life".
 */
function resolveGuidAffix(affix: unknown, dict: GuidDictionary | undefined): Modifier[] {
  if (!dict || !affix || typeof affix !== 'object') return [];
  const o = affix as Record<string, unknown>;
  const guid = o.guid as string | undefined;
  if (!guid) return [];
  const desc = dict[guid]?.description;
  if (!desc) return [];
  const value = typeof o.value === 'number' ? o.value : Number(o.value);
  if (!Number.isFinite(value)) return [];
  const unit = typeof o.unit === 'string' ? o.unit : '';
  const sign = value < 0 ? '' : '+';
  return parseModifierLine(`${sign}${value}${unit} ${desc}`);
}

/**
 * Parse a TLI Compendium export (JSON string or object) into a Build whose
 * `extraModifiers` hold the mappable gear + divinity stats. `heroId` and
 * `activeSkillId` are left blank — the export doesn't name them — so pick a
 * main skill afterward to get a DPS estimate.
 */
export function parseCompendiumExport(
  input: string | object,
  options: CompendiumOptions = {}
): CompendiumImport {
  const json = (typeof input === 'string' ? JSON.parse(input) : input) as Json;
  if (!isCompendiumExport(json)) {
    throw new Error('Not a TLI Compendium export (no loadouts).');
  }
  const loadouts = (json.loadouts as Json).loadouts as Json[];
  const loadout = loadouts[0];
  if (!loadout) throw new Error('Compendium export has no loadouts.');

  const modifiers: Modifier[] = [];
  const entries: Array<{ text: string; values: number[] }> = [];

  // Equipped gear only.
  const gear = loadout.gear as Json | undefined;
  const equipped = new Set(Object.values((gear?.equipped as Json) ?? {}).filter(Boolean) as string[]);
  const gearInventory = [
    ...(((gear?.inventory as Json[]) ?? [])),
    ...((((loadout.vorax as Json)?.inventory as Json[]) ?? []))
  ];
  for (const item of gearInventory) {
    if (equipped.has(item.id as string)) collectFromGearItem(item, entries);
  }

  // Divinity slate nodes (all placed slates contribute).
  const divinity = loadout.divinity as Json | undefined;
  for (const slate of ((divinity?.inventory as Json[]) ?? [])) {
    collectFromArray(slate.affixes, entries);
  }

  // Parse every gear/divinity entry's lines.
  let totalLines = 0;
  let matchedLines = 0;
  for (const { text, values } of entries) {
    for (const line of resolveText(text, values).split('\n')) {
      if (!line.trim()) continue;
      totalLines += 1;
      const mods = parseModifierLine(line);
      if (mods.length > 0) matchedLines += 1;
      modifiers.push(...mods);
    }
  }

  // Hero-memories, resolved through the supplied data bundle (if any).
  const dict = options.heroMemoryDict;
  let memoryModCount = 0;
  if (dict) {
    const hm = loadout.heroMemories as Json | undefined;
    const equippedMem = new Set(
      Object.values((hm?.equipped as Json) ?? {}).filter(Boolean) as string[]
    );
    for (const mem of ((hm?.inventory as Json[]) ?? [])) {
      if (!equippedMem.has(mem.id as string)) continue;
      const resolved = [
        ...resolveGuidAffix(mem.baseStat, dict.baseStats),
        ...((mem.fixedAffixes as unknown[]) ?? []).flatMap((a) => resolveGuidAffix(a, dict.fixedAffixes)),
        ...((mem.randomAffixes as unknown[]) ?? []).flatMap((a) => resolveGuidAffix(a, dict.randomAffixes))
      ];
      memoryModCount += resolved.length;
      modifiers.push(...resolved);
    }
  }

  const heroName = ((loadout.hero as Json)?.heroId as string) ?? 'Unknown hero';
  const build: Build = {
    id: `compendium-${(json.id as string) ?? Date.now()}`,
    name: `${(json.name as string) ?? 'Imported'} (Compendium)`,
    heroId: '',
    activeSkillId: '',
    supportIds: [],
    gear: [],
    talentIds: [],
    pactSpiritIds: [],
    divinityIds: [],
    extraModifiers: modifiers
  };

  const memorySource = dict ? ` + hero-memories` : '';
  const warnings = [
    `Imported ${modifiers.length} modifiers from ${heroName}'s gear + divinity${memorySource}.`,
    `${matchedLines}/${totalLines} gear/divinity affix lines recognised; the rest (tangle, sealed mana, penetration, movement/projectile speed, attributes, skill levels, conditionals) aren't modelled.`,
    dict
      ? `Resolved ${memoryModCount} modifiers from equipped hero-memories via the data bundle.`
      : `Hero-memories, traits, and skill-tree nodes are opaque guids here — supply the season data bundle (e.g. SS12.5-hero-memory-en.json) to resolve them.`,
    `The main skill is stored as an opaque id and can't be identified — pick a main skill to compute DPS.`
  ];

  return { build, warnings };
}
