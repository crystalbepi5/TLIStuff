// Data source: tlicompendium.com structured JSON data bundles.
//
// One bundle per category (skill, gear, legendaries, hero-trait, pactspirit, …)
// at `/data-bundles/<version>-<name>-{en,master}.json`. Bundles are deeply
// nested maps; leaf entries carry `name` + structured fields. The `-master`
// bundles hold the structured data (tags, values, affix pools), the `-en`
// bundles hold localized names/text; the mappers join them. `<version>` is the
// season (e.g. SS12.5) — resolveLatestVersion() finds the newest one so the
// scrape self-updates when a new season is published.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ActiveSkill,
  Affix,
  AffixTier,
  DamageTag,
  Element,
  GearBase,
  GearSlot,
  Kismet,
  MemoryAffix,
  MemoryAffixPools,
  MemoryRevival,
  PactSpirit,
  ProgressionNode,
  ProgressionTree,
  SkillLevelEntry,
  SupportSkill,
  Talent,
  VoraxAffix,
  VoraxLegendary
} from '@torchlight-companion/build-data';
import { DEFAULT_CONFIG, parseModifiers, type ScrapeConfig } from './scrape.js';

export const BUNDLE_BASE = 'https://tlicompendium.com/data-bundles';

/** Numeric weight of a season string for comparison: "SS12.5" -> 12.5. */
function seasonNumber(version: string): number {
  return Number(version.replace(/^SS/i, ''));
}

/**
 * Fetch the bundle manifest and return the newest `SS*` season it publishes, so
 * the scrape follows the live season without a code change. Falls back to
 * `cfg.version` if the manifest can't be read.
 */
export async function resolveLatestVersion(cfg: ScrapeConfig): Promise<string> {
  try {
    const res = await fetch(`${BUNDLE_BASE}/manifest.json`, { headers: { 'user-agent': cfg.userAgent } });
    if (!res.ok) return cfg.version;
    const manifest = JSON.parse(await res.text()) as { bundles?: Record<string, unknown> };
    const versions = new Set<string>();
    for (const key of Object.keys(manifest.bundles ?? {})) {
      const m = key.match(/^(SS\d+(?:\.\d+)?)-/i);
      if (m?.[1]) versions.add(m[1]);
    }
    const latest = [...versions].sort((a, b) => seasonNumber(a) - seasonNumber(b)).at(-1);
    return latest ?? cfg.version;
  } catch {
    return cfg.version;
  }
}

/** Fetch a `<version>-<name>-en.json` bundle, cached on disk. */
export async function fetchBundle(name: string, cfg: ScrapeConfig): Promise<unknown> {
  const file = `${cfg.version}-${name}-en.json`;
  const cacheFile = join(cfg.cacheDir, file + '.cache');
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const res = await fetch(`${BUNDLE_BASE}/${file}`, { headers: { 'user-agent': cfg.userAgent } });
  if (!res.ok) throw new Error(`GET ${file} -> HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  // Soft-404s return a small SPA shell; a real bundle is a large JSON object.
  if (text.length < 5000 || !text.trimStart().startsWith('{')) {
    throw new Error(`bundle ${file} looks like a soft-404 (len ${text.length})`);
  }
  mkdirSync(cfg.cacheDir, { recursive: true });
  writeFileSync(cacheFile, text);
  return JSON.parse(text);
}

/** Recursively yield leaf entries — any object carrying a string `name`. */
export function* leaves(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.name === 'string') {
    yield obj;
    return;
  }
  for (const v of Object.values(obj)) yield* leaves(v);
}

function idFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Strip tlicompendium markup: `<span…>`, `<link:…>`, HTML tags, entities. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .trim();
}

const SLOT_MAP: Record<string, GearSlot> = {
  Feet: 'boots',
  Chest: 'chest',
  Hands: 'gloves',
  Helmet: 'helmet',
  Head: 'helmet',
  'One-Handed': 'weapon',
  'Two-handed': 'weapon',
  Weapon: 'weapon',
  'Off-Hand': 'offhand',
  Shield: 'offhand',
  Waist: 'belt',
  Neck: 'amulet',
  Finger: 'ring'
};

/** Shared lowercase-underscore category vocabulary used by both gear-master's
 * `section.category` and the legendaries-en bundle's key path (see
 * legendarySlotFromKey below) -- confirmed the same strings appear in both. */
const CATEGORY_SLOT: Record<string, GearSlot> = {
  boots: 'boots',
  chest_armor: 'chest',
  gloves: 'gloves',
  helmet: 'helmet',
  one_handed: 'weapon',
  two_handed: 'weapon',
  shield: 'offhand',
  amulet: 'amulet',
  necklace: 'amulet',
  ring: 'ring',
  spirit_ring: 'ring',
  belt: 'belt',
  waist: 'belt'
};

interface GearLeaf {
  name: string;
  slotType?: string;
  implicits?: { rawText?: string }[];
}

/** Map the `gear` bundle to GearBase[] (base items with implicit mods). */
export function mapGear(bundle: unknown): GearBase[] {
  const byId = new Map<string, GearBase>();
  for (const raw of leaves(bundle)) {
    const e = raw as unknown as GearLeaf;
    const slot = e.slotType ? SLOT_MAP[e.slotType] : undefined;
    if (!slot) continue; // skip unknown/empty slot types
    const text = (e.implicits ?? []).map((i) => i.rawText ?? '').join('\n');
    const id = idFromName(e.name);
    if (!byId.has(id)) byId.set(id, { id, name: e.name, slot, implicit: parseModifiers(text) });
  }
  return [...byId.values()];
}

interface LegendaryLeaf {
  name: string;
  mods?: { normalRawText?: string }[];
}

/**
 * Real slot from the legendaries-en bundle's own top-level key path, e.g.
 * "legendaries/boots/dex_boots/i18n/en" -> category "boots" -- confirmed live
 * against the SS13 bundle, every top-level key encodes its category as the
 * 2nd path segment. "trinket" is a catch-all parent category whose real slot
 * is the *next* segment instead (confirmed live:
 * legendaries/trinket/{belt,necklace,ring,spirit_ring}/i18n/en), so it's
 * special-cased to look one level deeper. Categories CATEGORY_SLOT doesn't
 * know (i.e. not modelled by the closed GearSlot union) return undefined and
 * are skipped, same as CATEGORY_SLOT's other call sites in this file.
 *
 * Replaces a previous name-based regex guess (inferSlot/SLOT_KEYWORDS) that
 * produced confirmed false positives -- e.g. "Devouring Tide" contains "ring"
 * as a substring and was misclassified as a ring, and shield items had no
 * matching keyword and silently defaulted to 'weapon'.
 */
function legendarySlotFromKey(key: string): GearSlot | undefined {
  const parts = key.split('/');
  const category = parts[1] === 'trinket' ? parts[2] : parts[1];
  return category ? CATEGORY_SLOT[category] : undefined;
}

/** Map the `legendaries` bundle to GearBase[], slot derived from the bundle's
 * own key path (see legendarySlotFromKey) rather than guessed from the name. */
export function mapLegendaries(bundle: unknown): GearBase[] {
  const byId = new Map<string, GearBase>();
  for (const [key, section] of Object.entries(bundle as Record<string, unknown>)) {
    const slot = legendarySlotFromKey(key);
    if (!slot) continue; // unknown category (e.g. not yet in CATEGORY_SLOT)
    for (const raw of leaves(section)) {
      const e = raw as unknown as LegendaryLeaf;
      if (!Array.isArray(e.mods)) continue; // skip label-only leaves
      const text = e.mods.map((m) => stripHtml(m.normalRawText ?? '')).join('\n');
      const id = idFromName(e.name);
      if (!byId.has(id)) {
        byId.set(id, { id, name: e.name, slot, implicit: parseModifiers(text) });
      }
    }
  }
  return [...byId.values()];
}

interface TraitTierRaw {
  level?: number;
  description?: string;
}
interface TraitRaw {
  name: string;
  tiers?: TraitTierRaw[];
}
interface HeroTraitEntry {
  characterName?: string;
  traits?: Record<string, TraitRaw>;
}

/**
 * Map the `hero-trait` bundle to Talent[], scoped to the real owning hero.
 * The bundle nests traits under each hero (`heroes[uuid].characterName` +
 * `.traits`) -- confirmed against the real scrape (e.g. "Rehan" owns a trait
 * named "Anger"). heroId is derived as idFromName(characterName), same
 * convention as every other id in this file. Previously every trait got the
 * placeholder heroId 'any' regardless of which hero it actually belongs to,
 * so hero-specific traits could be selected (and their modifiers applied)
 * on any hero in the planner -- a real, confirmed bug.
 */
export function mapHeroTraits(bundle: unknown): Talent[] {
  const byId = new Map<string, Talent>();
  const sections = Object.values(bundle as Record<string, { heroes?: Record<string, HeroTraitEntry> }>);
  for (const section of sections) {
    for (const hero of Object.values(section.heroes ?? {})) {
      const heroId = hero.characterName ? idFromName(hero.characterName) : 'any';
      for (const trait of Object.values(hero.traits ?? {})) {
        if (!Array.isArray(trait.tiers) || trait.tiers.length === 0) continue;
        const top = trait.tiers[trait.tiers.length - 1]; // highest tier
        const text = stripHtml(top?.description ?? '');
        const id = idFromName(trait.name);
        if (!byId.has(id)) {
          byId.set(id, { id, name: trait.name, heroId, modifiers: parseModifiers(text) });
        }
      }
    }
  }
  return [...byId.values()];
}

// ------------------------------- skills --------------------------------------
// Structured from the `-master` bundle (tags/element/castSpeed/effectiveness);
// display name + effect text joined from the `-en` bundle by uuid.

const ELEMENT_TAG: Record<string, Element> = {
  Physical: 'physical',
  Fire: 'fire',
  Cold: 'cold',
  Lightning: 'lightning',
  Erosion: 'erosion'
};
const DAMAGE_TAG: Record<string, DamageTag> = {
  Attack: 'attack',
  Spell: 'spell',
  Melee: 'melee',
  Area: 'area',
  Projectile: 'projectile',
  Channeled: 'channelled',
  Channelled: 'channelled'
};

interface LevelProgressionRow {
  level: number;
  [valueKey: string]: number | string;
}

interface MasterSkill {
  id: string;
  tags?: string[];
  castSpeed?: string;
  effectivenessOfAddedDamage?: string;
  manaMultiplier?: string;
  cannotSupport?: string[];
  levelProgression?: LevelProgressionRow[];
  manaCost?: number;
  mainStat?: string[];
  /** Only populated on Magnificent_Support/Noble_Support entries (confirmed:
   * every entry in both categories carries one; no other category ever
   * does) -- names the one active skill this "signature" support is scoped
   * to. */
  skillTag?: string;
}

interface EnSkillEntry {
  name: string;
  description?: string | undefined;
  templateDescription?: string | undefined;
}

/** Map uuid -> { name, description, templateDescription } from an `-en` skill/gear bundle. */
function indexEnById(enBundle: unknown): Map<string, EnSkillEntry> {
  const map = new Map<string, EnSkillEntry>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (val && typeof val === 'object' && typeof (val as { name?: unknown }).name === 'string') {
        const v = val as EnSkillEntry;
        map.set(key, { name: v.name, description: v.description, templateDescription: v.templateDescription });
      } else {
        walk(val);
      }
    }
  };
  walk(enBundle);
  return map;
}

/** First damage figure in an effect description: a spell "X-Y" range midpoint,
 * else an attack "N%" effectiveness. */
function damageFromText(text: string | undefined, effectiveness: string | undefined): number {
  if (text) {
    const range = text.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
    if (range?.[1] && range[2]) {
      return Math.round((Number(range[1].replace(/,/g, '')) + Number(range[2].replace(/,/g, ''))) / 2);
    }
  }
  const eff = effectiveness?.match(/([\d.]+)/);
  return eff?.[1] ? Math.round(Number(eff[1])) : 0;
}

// --------------------- per-level scaling (levelProgression) ------------------
//
// `levelProgression` gives every level's raw values as anonymous `value1`..
// `valueN` slots -- no field tells you which slot is "damage" vs "duration"
// vs an unrelated mechanic constant. But `-en`'s `templateDescription` has
// the real tooltip text with "#" placeholders standing in for *some* of
// those slots (not necessarily all of them -- some slots are baked into the
// template as fixed literal numbers instead, by whatever authored the
// template; there's no way to tell which without checking). `description`
// is the same text with the placeholders already filled in, at whichever
// level was used as the display snapshot -- found by matching
// `effectivenessOfAddedDamage` against value1's per-level series.
//
// So: find that reference level, extract the actual numbers sitting at each
// "#" position in `description`, then match each one (in order) against the
// first not-yet-used value slot (in value1, value2, ... order) whose value
// at the reference level equals it. That gives a position -> slot mapping
// good enough to refill the template at any other level and re-run it
// through the same parseModifiers() text engine used everywhere else in
// this file. If any position can't be confidently matched, this bails
// (returns undefined) rather than guess -- a wrong slot mapping would
// silently fabricate numbers, which is worse than having none.

/** "37/5" is a known upstream data quirk (also seen verbatim on tlidb.com's
 * independent HTML scrape) -- treat it as a fraction, not two numbers. */
function parseValueSlot(raw: number | string | undefined): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  const frac = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (frac?.[1] && frac[2]) {
    const denom = Number(frac[2]);
    return denom !== 0 ? Number(frac[1]) / denom : undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** value1, value2, ... keys present on a row, in numeric order. Some skills
 * (range-damage spells, e.g. "Deals #-# Spell Damage") use `value1Min`/
 * `value1Max` pairs instead of a flat `value1` -- both count as slots here,
 * Min sorting before Max within the same index. */
const SUFFIX_RANK: Record<string, number> = { '': 0, Min: 1, Max: 2 };

function valueSlotKeys(row: LevelProgressionRow): string[] {
  return Object.keys(row)
    .filter((k) => /^value\d+(Min|Max)?$/.test(k))
    .sort((a, b) => {
      const [, an, asuf] = /^value(\d+)(Min|Max)?$/.exec(a) ?? [];
      const [, bn, bsuf] = /^value(\d+)(Min|Max)?$/.exec(b) ?? [];
      const byIndex = Number(an) - Number(bn);
      if (byIndex !== 0) return byIndex;
      return (SUFFIX_RANK[asuf ?? ''] ?? 0) - (SUFFIX_RANK[bsuf ?? ''] ?? 0);
    });
}

/** Extract the numbers that fill each "#" in `template` when it produced
 * `filled`, by matching the literal text between placeholders. undefined if
 * `filled` doesn't actually match the template's literal structure. */
function extractFilledNumbers(template: string, filled: string): number[] | undefined {
  const segments = template.split('#');
  if (segments.length < 2) return []; // no placeholders to resolve
  const escaped = segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(escaped.join('(-?[\\d.]+)'), 's');
  const m = re.exec(filled);
  if (!m) return undefined;
  const nums = m.slice(1).map(Number);
  return nums.every((n) => Number.isFinite(n)) ? nums : undefined;
}

/** Greedy positional match against one candidate row: for each extracted
 * number (in template order), take the first not-yet-used value slot (in
 * value1, value2, ... order) whose value at that row equals it. Returns
 * undefined (not a partial mapping) if any position can't be matched --
 * a partial match against the wrong row is worse than no match. */
function tryMapAgainstRow(extracted: number[], row: LevelProgressionRow): (string | undefined)[] | undefined {
  const used = new Set<string>();
  const keys = valueSlotKeys(row);
  const mapped = extracted.map((num) => {
    for (const key of keys) {
      if (used.has(key)) continue;
      const v = parseValueSlot(row[key]);
      if (v !== undefined && Math.abs(v - num) < 0.05) {
        used.add(key);
        return key;
      }
    }
    return undefined;
  });
  return mapped.every((k) => k !== undefined) ? mapped : undefined;
}

/**
 * `description` is a snapshot filled in at *some* level, but which one isn't
 * consistent -- active skills seem to snapshot at a high/max level (findable
 * via effectivenessOfAddedDamage, which only exists on actives), while
 * supports have been observed snapshotting at level 1. Rather than assume
 * one convention, try the effectivenessOfAddedDamage-implied row first (a
 * fast path when it's available and correct), then fall back to trying
 * every row until one produces a *complete* placeholder mapping.
 */
function mapPlaceholdersToValueKeys(
  extracted: number[],
  rows: LevelProgressionRow[],
  effectivenessOfAddedDamage: string | undefined
): (string | undefined)[] | undefined {
  const target = effectivenessOfAddedDamage ? parseValueSlot(effectivenessOfAddedDamage.replace('%', '')) : undefined;
  if (target !== undefined) {
    const hinted = rows.find((r) => {
      const v1 = parseValueSlot(r.value1);
      return v1 !== undefined && Math.abs(v1 - target) < 0.05;
    });
    if (hinted) {
      const mapped = tryMapAgainstRow(extracted, hinted);
      if (mapped) return mapped;
    }
  }
  for (const row of rows) {
    const mapped = tryMapAgainstRow(extracted, row);
    if (mapped) return mapped;
  }
  return undefined;
}

/**
 * Reconstruct real per-level modifiers from a skill's levelProgression, by
 * refilling templateDescription's "#" placeholders with each level's values
 * (once the placeholder->value-slot mapping is known, see above) and
 * re-parsing the result with the same text->Modifier engine used elsewhere.
 * Returns undefined if the mapping isn't confidently resolvable.
 */
export function buildLevelScaling(
  levelProgression: LevelProgressionRow[] | undefined,
  templateDescription: string | undefined,
  description: string | undefined,
  effectivenessOfAddedDamage: string | undefined
): SkillLevelEntry[] | undefined {
  if (!levelProgression || levelProgression.length === 0 || !templateDescription || !description) {
    return undefined;
  }
  const extracted = extractFilledNumbers(templateDescription, description);
  if (!extracted) return undefined;
  if (extracted.length === 0) {
    // No placeholders at all -- the text is level-invariant, so every level
    // shares the same (already-parsed-elsewhere) modifiers. Nothing to add.
    return undefined;
  }

  const keyMap = mapPlaceholdersToValueKeys(extracted, levelProgression, effectivenessOfAddedDamage);
  if (!keyMap) return undefined; // couldn't confidently map any row -> don't guess

  const segments = templateDescription.split('#');
  return levelProgression.map((row) => {
    let filled = segments[0] ?? '';
    keyMap.forEach((key, i) => {
      const v = key ? parseValueSlot(row[key]) : undefined;
      filled += (v !== undefined ? String(v) : '?') + (segments[i + 1] ?? '');
    });
    return { level: Number(row.level), modifiers: parseModifiers(filled) };
  });
}

/** Map the skill `-master` + `-en` bundles into active and support skills. */
export function mapSkills(
  master: unknown,
  en: unknown,
  version: string = DEFAULT_CONFIG.version
): { active: ActiveSkill[]; support: SupportSkill[] } {
  const names = indexEnById(en);
  const active: ActiveSkill[] = [];
  const support: SupportSkill[] = [];
  const bundle = master as Record<string, { category?: string; skills?: MasterSkill[] }>;

  for (const [subKey, section] of Object.entries(bundle)) {
    const category = section?.category ?? subKey;
    const skills = Array.isArray(section?.skills) ? section.skills : [];
    // Only the "Active" category is a main skill; Support/Magnificent/Noble and
    // the modifier-like Activation_Medium/Module/Passive all behave as supports.
    const isActive = category === 'Active';

    for (const s of skills) {
      const meta = names.get(s.id);
      const name = meta?.name;
      if (!name) continue; // no localized name -> skip
      const id = idFromName(name);
      const tags = (s.tags ?? []).map((t) => DAMAGE_TAG[t]).filter((t): t is DamageTag => Boolean(t));

      const levelScaling = buildLevelScaling(
        s.levelProgression,
        meta?.templateDescription,
        meta?.description,
        s.effectivenessOfAddedDamage
      );

      if (!isActive) {
        const manaMultiplier = s.manaMultiplier ? parseValueSlot(s.manaMultiplier.replace('%', '')) : undefined;
        support.push({
          id,
          name,
          modifiers: parseModifiers(meta?.description ?? ''),
          requiresTags: [],
          ...(manaMultiplier != null ? { manaMultiplier } : {}),
          ...(s.skillTag ? { requiresSkillId: idFromName(s.skillTag) } : {}),
          ...(s.cannotSupport && s.cannotSupport.length > 0 ? { cannotSupport: s.cannotSupport } : {}),
          ...(levelScaling ? { levelScaling } : {})
        });
        continue;
      }

      const element = (s.tags ?? []).map((t) => ELEMENT_TAG[t]).find(Boolean) ?? 'physical';
      const base = damageFromText(meta?.description, s.effectivenessOfAddedDamage);
      const baseDamage: Partial<Record<Element, number>> = {};
      if (base > 0) baseDamage[element] = base;
      const castSeconds = s.castSpeed ? Number.parseFloat(s.castSpeed) : NaN;
      const baseRate = castSeconds > 0 ? Number((1 / castSeconds).toFixed(3)) : 1;

      active.push({
        id,
        name,
        tags,
        baseDamage,
        baseRate,
        baseCritRate: 5,
        supportSlots: 5,
        season: version,
        ...(levelScaling ? { levelScaling } : {}),
        ...(s.manaCost != null ? { manaCost: s.manaCost } : {}),
        ...(s.mainStat && s.mainStat.length > 0 ? { mainStat: s.mainStat } : {})
      });
    }
  }
  return { active, support };
}

/** Fetch the skill `-master` + `-en` bundles and map them. */
export async function scrapeSkillsFromBundles(
  overrides: Partial<ScrapeConfig> = {}
): Promise<{ active: ActiveSkill[]; support: SupportSkill[] }> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  const [master, en] = await Promise.all([
    fetchBundleRaw('skill-master', cfg),
    fetchBundle('skill', cfg)
  ]);
  return mapSkills(master, en, cfg.version);
}

/** Fetch a `-master` bundle (same as fetchBundle but the master variant name is
 * passed literally, e.g. `skill-master`). */
async function fetchBundleRaw(fullName: string, cfg: ScrapeConfig): Promise<unknown> {
  const file = `${cfg.version}-${fullName}.json`;
  const cacheFile = join(cfg.cacheDir, file + '.cache');
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
  const res = await fetch(`${BUNDLE_BASE}/${file}`, { headers: { 'user-agent': cfg.userAgent } });
  if (!res.ok) throw new Error(`GET ${file} -> HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.length < 5000 || !text.trimStart().startsWith('{')) {
    throw new Error(`bundle ${file} looks like a soft-404 (len ${text.length})`);
  }
  mkdirSync(cfg.cacheDir, { recursive: true });
  writeFileSync(cacheFile, text);
  return JSON.parse(text);
}

// -------------------- affixes + item ids (gear-master) -----------------------

interface AffixValue {
  minValue?: number;
  maxValue?: number;
  sign?: string;
}
/** Raw per-tier shape from the gear-master bundle (renamed from the schema's
 * output AffixTier to avoid a name collision -- this is the input, that's
 * the output). weight is the game's real crafting RNG weight; 0 means the
 * tier is currently disabled/unobtainable rather than "impossible to weight"
 * (confirmed by cross-checking against tlidb.com's independent HTML scrape,
 * which shows the same tiers as a binary available/unavailable flag). */
interface RawAffixTier {
  modifierId?: string;
  tier?: string;
  levelRequirement?: number;
  weight?: number;
  values?: AffixValue[];
}
interface CraftAffix {
  descriptionTemplate?: string;
  tiers?: RawAffixTier[];
}
interface GearSection {
  category?: string;
  baseItems?: { id?: string; tlidbId?: string | number; implicits?: unknown[] }[];
  craftPrefix?: CraftAffix[];
  craftSuffix?: CraftAffix[];
}

/** Fill a "+# Max Life" template with a tier's (max) roll values, in order. */
function fillTemplate(template: string, values: AffixValue[] | undefined): string {
  let i = 0;
  return template.replace(/#/g, () => {
    const v = values?.[i++];
    return v?.maxValue != null ? String(v.maxValue) : '0';
  });
}

/** Readable affix name from its template: "+# Max Life" -> "Max Life". */
function affixName(template: string): string {
  return template.replace(/[+\-]?#%?/g, '').replace(/\s+/g, ' ').trim() || template;
}

/** Highest-roll *craftable* tier of a craft affix (used for the top-level
 * `modifiers`). weight 0 means disabled/unobtainable (see RawAffixTier's
 * doc comment) -- a disabled tier can carry a higher roll than any tier a
 * player can actually craft (confirmed against the real scrape: several
 * affixes' strongest-looking tier is a disabled 0+ row), so it must be
 * excluded here or the top-level `modifiers` would show an impossible
 * value. Falls back to considering every tier only if none are craftable,
 * so an affix doesn't lose its `modifiers` entirely in that edge case. */
function topTier(a: CraftAffix): RawAffixTier | undefined {
  const tiers = a.tiers ?? [];
  const craftable = tiers.filter((t) => (t.weight ?? 0) > 0);
  const pool = craftable.length > 0 ? craftable : tiers;
  return pool.slice().sort((x, y) => (y.values?.[0]?.maxValue ?? 0) - (x.values?.[0]?.maxValue ?? 0))[0];
}

/** Map every raw tier of a craft affix into the schema's AffixTier shape,
 * parsing that tier's own filled-in text so e.g. a T0 and a T5 roll of the
 * same affix get their own (accurate, different-range) modifiers. */
function buildAffixTiers(a: CraftAffix, template: string): AffixTier[] {
  return (a.tiers ?? []).map((t) => ({
    tier: t.tier ?? '?',
    weight: t.weight ?? 0,
    modifiers: parseModifiers(fillTemplate(template, t.values)),
    ...(t.levelRequirement != null ? { levelRequirement: t.levelRequirement } : {}),
    ...(t.modifierId != null ? { modifierId: t.modifierId } : {})
  }));
}

/**
 * Map gear-master's craftPrefix/craftSuffix into the Affix pool. Dedupes by
 * (kind, stat template), unions slots + modifier ids + tiers across gear
 * subtypes, and keeps only affixes whose stat the calculator models.
 * modifierIds/tiers are retained so a future loot parser or crafting
 * simulator can map a dropped/rolled affix back to a specific tier + weight.
 */
export function mapAffixes(gearMaster: unknown): Affix[] {
  const byKey = new Map<string, Affix>();
  for (const section of Object.values(gearMaster as Record<string, GearSection>)) {
    const slot = section.category ? CATEGORY_SLOT[section.category] : undefined;
    if (!slot) continue;
    for (const [kind, list] of [
      ['prefix', section.craftPrefix],
      ['suffix', section.craftSuffix]
    ] as const) {
      for (const a of list ?? []) {
        const template = a.descriptionTemplate;
        if (!template) continue;
        const modifiers = parseModifiers(fillTemplate(template, topTier(a)?.values));
        if (modifiers.length === 0) continue; // stat the calculator doesn't model
        const ids = (a.tiers ?? []).map((t) => t.modifierId).filter((x): x is string => Boolean(x));
        const newTiers = buildAffixTiers(a, template);
        const key = `${kind}|${template}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.slots.includes(slot)) existing.slots.push(slot);
          existing.modifierIds = [...new Set([...(existing.modifierIds ?? []), ...ids])];
          const seenTierIds = new Set((existing.tiers ?? []).map((t) => t.modifierId));
          existing.tiers = [...(existing.tiers ?? []), ...newTiers.filter((t) => !seenTierIds.has(t.modifierId))];
        } else {
          const name = affixName(template);
          byKey.set(key, {
            id: `${idFromName(name)}-${kind}`,
            name,
            kind,
            modifiers,
            slots: [slot],
            modifierIds: [...new Set(ids)],
            tiers: newTiers
          });
        }
      }
    }
  }
  return disambiguateAffixIds([...byKey.values()]);
}

/**
 * Distinct templates can normalise to the same readable name -- affixName()
 * strips +/-/#/% symbols, so e.g. "+# Max Life" (flat) and "+#% Max Life"
 * (percentage) both become "Max Life", and "+#% additional damage" /
 * "-#% additional damage" both become the same name too. Confirmed live: id
 * collisions on `max-life-prefix` and `beams-additional-damage-suffix`
 * (each duplicated). Since indexDataset keys affixes by id in a Map, a
 * collision silently shadows one entry entirely. Appends a stable numeric
 * suffix to every id beyond the first sharing a base id (iteration order is
 * deterministic given the bundle's own key order, so this is reproducible
 * across regens).
 */
function disambiguateAffixIds(affixes: Affix[]): Affix[] {
  const seen = new Map<string, number>();
  for (const affix of affixes) {
    const count = (seen.get(affix.id) ?? 0) + 1;
    seen.set(affix.id, count);
    if (count > 1) affix.id = `${affix.id}-${count}`;
  }
  return affixes;
}

/** uuid -> { name, implicit rawTexts } from the gear `-en` bundle. */
function indexGearEn(en: unknown): Map<string, { name: string; texts: string[] }> {
  const map = new Map<string, { name: string; texts: string[] }>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      const v = val as { name?: unknown; implicits?: { rawText?: string }[] };
      if (typeof v.name === 'string' && Array.isArray(v.implicits)) {
        map.set(key, { name: v.name, texts: v.implicits.map((i) => i.rawText ?? '').filter(Boolean) });
      } else {
        walk(val);
      }
    }
  };
  walk(en);
  return map;
}

/** Gear from `-master` (slot + tlidbId) joined with `-en` (name + mod text). */
export function mapGearFromMaster(gearMaster: unknown, gearEn: unknown): GearBase[] {
  const enIndex = indexGearEn(gearEn);
  const byId = new Map<string, GearBase>();
  for (const section of Object.values(gearMaster as Record<string, GearSection>)) {
    const slot = section.category ? CATEGORY_SLOT[section.category] : undefined;
    if (!slot) continue;
    for (const item of section.baseItems ?? []) {
      if (!item.id) continue;
      const en = enIndex.get(item.id);
      if (!en) continue;
      const id = idFromName(en.name);
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        name: en.name,
        slot,
        implicit: parseModifiers(en.texts.join('\n')),
        ...(item.tlidbId != null ? { tlidbId: String(item.tlidbId) } : {})
      });
    }
  }
  return [...byId.values()];
}

/** Fetch gear `-master` + `-en` and map to GearBase[] (with tlidbId). */
export async function scrapeGear(overrides: Partial<ScrapeConfig> = {}): Promise<GearBase[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  const [master, en] = await Promise.all([
    fetchBundleRaw('gear-master', cfg),
    fetchBundle('gear', cfg)
  ]);
  return mapGearFromMaster(master, en);
}

/** Fetch gear `-master` and extract the rollable affix pool. */
export async function scrapeAffixes(overrides: Partial<ScrapeConfig> = {}): Promise<Affix[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapAffixes(await fetchBundleRaw('gear-master', cfg));
}

export async function scrapeLegendaries(overrides: Partial<ScrapeConfig> = {}): Promise<GearBase[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapLegendaries(await fetchBundle('legendaries', cfg));
}

export async function scrapeHeroTraits(overrides: Partial<ScrapeConfig> = {}): Promise<Talent[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapHeroTraits(await fetchBundle('hero-trait', cfg));
}

// ------------------- Void Chart + Talent Tree (progression graphs) ----------
// Unlike everything above, these bundles expose the *real* tree graph (node
// positions and edges) -- something no HTML scrape of tlidb.com can recover,
// since that site's pages don't expose connectivity, only a flat node list.
// Kept as reference data (Dataset.voidCharts / .talentTrees), not yet wired
// into Build/collectModifiers: these are account-wide meta-progression
// unlocks, not a per-build loadout choice like gear/skills/talents.

interface VoidChartEffectRaw {
  displayString?: string;
}
interface VoidChartNodeRaw {
  id: string;
  tlidbId?: string;
  type?: string;
  name?: string;
  description?: string;
  icon?: string;
  position?: { x: number; y: number };
  connections?: string[];
  effects?: VoidChartEffectRaw[];
}
interface VoidChartTreeRaw {
  id?: string;
  name?: string;
  nodes?: VoidChartNodeRaw[];
}

/** Map the Void Chart bundle (voidchart-en: one key per season/category, e.g.
 * "war", "vorax", "aeterna") into one ProgressionTree per sub-tree. Modifiers
 * are best-effort parsed from each effect's displayString with the same text
 * engine used everywhere else -- effects aren't tagged with a StatKey, just a
 * game-internal id/category, so there's no direct mapping to reach for. */
export function mapVoidChart(bundle: unknown): ProgressionTree[] {
  const trees: ProgressionTree[] = [];
  for (const [key, raw] of Object.entries(bundle as Record<string, VoidChartTreeRaw>)) {
    if (!raw || !Array.isArray(raw.nodes)) continue;
    const nodes: ProgressionNode[] = raw.nodes.map((n) => ({
      id: n.id,
      ...(n.tlidbId != null ? { tlidbId: n.tlidbId } : {}),
      ...(n.type != null ? { type: n.type } : {}),
      ...(n.name ? { name: n.name } : {}),
      ...(n.description ? { description: n.description } : {}),
      ...(n.icon != null ? { icon: n.icon } : {}),
      connections: n.connections ?? [],
      ...(n.position != null ? { position: n.position } : {}),
      modifiers: parseModifiers((n.effects ?? []).map((e) => e.displayString ?? '').join('\n'))
    }));
    trees.push({ id: raw.id ?? key, name: raw.name ?? key, nodes });
  }
  return trees;
}

export async function scrapeVoidCharts(overrides: Partial<ScrapeConfig> = {}): Promise<ProgressionTree[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapVoidChart(await fetchBundle('voidchart', cfg));
}

interface TalentTreeModRaw {
  description?: string;
}
interface TalentTreeNodeRaw {
  id: string;
  tlidbId?: string;
  type?: string;
  icon?: string;
  svgPosition?: { cx: number; cy: number };
  maxPoints?: number;
  ancestor?: string | null;
  predecessors?: { guid: string; tlidbId?: string }[];
  mods?: TalentTreeModRaw[];
}
interface TalentTreeRaw {
  id?: string;
  tlidbId?: string;
  icon?: string;
  nodes?: TalentTreeNodeRaw[];
}
interface TalentTreeBundleEntry {
  tree?: TalentTreeRaw;
}

/** Map the talent-tree bundle (one key per hero archetype / "god", e.g.
 * "talent-tree/warrior/master") into one ProgressionTree per archetype.
 * Same idea as mapVoidChart but the graph is expressed as ancestor +
 * predecessors instead of a flat connections list -- normalised into one
 * adjacency list on the shared ProgressionNode shape. */
export function mapTalentTrees(bundle: unknown): ProgressionTree[] {
  const trees: ProgressionTree[] = [];
  for (const [key, entry] of Object.entries(bundle as Record<string, TalentTreeBundleEntry>)) {
    const tree = entry?.tree;
    if (!tree || !Array.isArray(tree.nodes)) continue;
    const nodes: ProgressionNode[] = tree.nodes.map((n) => {
      const connections = [...(n.ancestor ? [n.ancestor] : []), ...(n.predecessors ?? []).map((p) => p.guid)];
      return {
        id: n.id,
        ...(n.tlidbId != null ? { tlidbId: n.tlidbId } : {}),
        ...(n.type != null ? { type: n.type } : {}),
        ...(n.icon != null ? { icon: n.icon } : {}),
        connections,
        ...(n.maxPoints != null ? { maxPoints: n.maxPoints } : {}),
        ...(n.svgPosition != null ? { position: { x: n.svgPosition.cx, y: n.svgPosition.cy } } : {}),
        modifiers: parseModifiers((n.mods ?? []).map((m) => m.description ?? '').join('\n'))
      };
    });
    trees.push({
      id: tree.id ?? key,
      name: tree.tlidbId ?? key,
      ...(tree.icon ? { icon: tree.icon } : {}),
      nodes
    });
  }
  return trees;
}

export async function scrapeTalentTrees(overrides: Partial<ScrapeConfig> = {}): Promise<ProgressionTree[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapTalentTrees(await fetchBundleRaw('talent-tree-master', cfg));
}

// --------------------------- Pact Spirit -------------------------------------
// pactspirit-master has the mechanics (typeId, rarity, per-node effects with
// clean sign/value/unit/text -- no template needed, unlike gear/memory
// affixes); pactspirit-en has the name/description the master bundle lacks
// entirely. Joined by the shared `id`.

interface PactSpiritEffectRaw {
  sign?: string;
  value?: number;
  unit?: string;
  text?: string;
}
interface PactSpiritNodeRaw {
  nodeId: number;
  nodeType?: string;
  nextNode?: number | null;
  effects?: PactSpiritEffectRaw[];
}
interface PactSpiritRaw {
  id: string;
  typeId?: string;
  rarity?: string;
  iconUrl?: string;
  nodes?: PactSpiritNodeRaw[];
}
interface PactSpiritMasterRaw {
  types?: { id: string; code: string }[];
  pactspirits?: PactSpiritRaw[];
}
interface PactSpiritEnEntry {
  name?: string;
  description?: string;
}

function effectsToText(effects: PactSpiritEffectRaw[] | undefined): string {
  return (effects ?? [])
    .map((e) => `${e.sign ?? ''}${e.value ?? ''}${e.unit ?? ''} ${e.text ?? ''}`.trim())
    .join('\n');
}

/** Map pactspirit master+en into real PactSpirit[] (replacing the 4-entry
 * hand-seeded placeholder with all 166 real pact spirits). */
export function mapPactSpirits(master: unknown, en: unknown): PactSpirit[] {
  const masterData = (Object.values(master as Record<string, PactSpiritMasterRaw>)[0] ?? {}) as PactSpiritMasterRaw;
  const enData = (Object.values(en as Record<string, { pactspirits?: Record<string, PactSpiritEnEntry> }>)[0] ??
    {}) as { pactspirits?: Record<string, PactSpiritEnEntry> };
  const typeCodeById = new Map((masterData.types ?? []).map((t) => [t.id, t.code]));

  return (masterData.pactspirits ?? []).map((raw) => {
    const meta = enData.pactspirits?.[raw.id];
    const nodes = (raw.nodes ?? []).map((n) => ({
      nodeId: n.nodeId,
      ...(n.nodeType != null ? { nodeType: n.nodeType } : {}),
      nextNode: n.nextNode ?? null,
      modifiers: parseModifiers(effectsToText(n.effects))
    }));
    const modifiers = nodes.flatMap((n) => n.modifiers);
    const typeCode = raw.typeId ? typeCodeById.get(raw.typeId) : undefined;
    return {
      id: raw.id,
      name: meta?.name ?? raw.id,
      ...(meta?.description ? { description: meta.description } : {}),
      modifiers,
      nodes,
      ...(typeCode != null ? { typeCode } : {}),
      ...(raw.rarity ? { rarity: raw.rarity } : {}),
      ...(raw.iconUrl ? { iconUrl: raw.iconUrl } : {})
    };
  });
}

export async function scrapePactSpirits(overrides: Partial<ScrapeConfig> = {}): Promise<PactSpirit[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  const [master, en] = await Promise.all([
    fetchBundleRaw('pactspirit-master', cfg),
    fetchBundle('pactspirit', cfg)
  ]);
  return mapPactSpirits(master, en);
}

// --------------------------- Hero Memory (Memory Revival) --------------------
// hero-memory-master has 5 tiered/weighted affix pools (baseStats,
// fixedAffixes, randomAffixes, revivedAffixes, specialRandomAffixes) in the
// same modifierId/tier/level/weight shape as gear affixes, plus a 6th
// category (revivedAffixLunarPhases) of fixed named effects with no tiers at
// all. The 5 tiered pools have NO descriptionTemplate in -master (unlike gear)
// -- the template lives in -en, joined by id, same pattern as mapAffixes.

interface MemoryTierValueRaw {
  value?: number | null;
  valueMin?: number;
  valueMax?: number;
}
interface MemoryTierRaw {
  tier: number;
  value?: number | null;
  valueMax?: number;
  level?: number;
  weight: number;
  values?: MemoryTierValueRaw[];
}
interface MemoryAffixRaw {
  id: string;
  modifierId?: string;
  tiers?: MemoryTierRaw[];
  name?: string;
  description?: string;
}
interface MemoryEnEntry {
  description?: string;
  template?: string;
  rawText?: string;
}
interface HeroMemoryMasterRaw {
  baseStats?: MemoryAffixRaw[];
  fixedAffixes?: MemoryAffixRaw[];
  randomAffixes?: MemoryAffixRaw[];
  revivedAffixes?: MemoryAffixRaw[];
  specialRandomAffixes?: MemoryAffixRaw[];
  revivedAffixLunarPhases?: { id: string; name?: string; description?: string }[];
}

/** Fill a hero-memory tier's own numeric value(s) into its -en template
 * ("+#% Skill Area"). Tolerates the tier-value shapes seen across
 * hero-memory's pools: a flat value, or a nested `values` array (compound
 * affixes bundling more than one stat into one tier/template). */
function fillMemoryTemplate(template: string, tier: MemoryTierRaw): string {
  const slots: MemoryTierValueRaw[] = tier.values && tier.values.length > 0 ? tier.values : [tier];
  let i = 0;
  return template.replace(/#/g, () => {
    const v = slots[i++];
    if (!v) return '0';
    if (v.valueMax != null) return String(v.valueMax);
    if (v.value != null) return String(v.value);
    return '0';
  });
}

/** Each raw entry becomes its own MemoryAffix with whatever tiers it carries
 * (samples show one tier per entry rather than gear's multi-tier-per-affix
 * shape, so no cross-entry grouping is attempted). */
function mapMemoryAffixList(
  rawList: MemoryAffixRaw[] | undefined,
  en: Record<string, MemoryEnEntry> | undefined
): MemoryAffix[] {
  return (rawList ?? []).map((raw) => {
    const meta = en?.[raw.id];
    const name = meta?.description ?? raw.name ?? raw.id;
    const tiers: AffixTier[] = (raw.tiers ?? []).map((t) => ({
      tier: String(t.tier),
      weight: t.weight ?? 0,
      ...(t.level != null ? { levelRequirement: t.level } : {}),
      ...(raw.modifierId != null ? { modifierId: raw.modifierId } : {}),
      modifiers: parseModifiers(meta?.template ? fillMemoryTemplate(meta.template, t) : meta?.rawText ?? raw.description ?? '')
    }));
    return {
      id: raw.id,
      name,
      modifiers: tiers[0]?.modifiers ?? (raw.description ? parseModifiers(raw.description) : []),
      ...(raw.modifierId != null ? { modifierIds: [raw.modifierId] } : {}),
      ...(tiers.length > 0 ? { tiers } : {})
    };
  });
}

/** Map hero-memory master+en into the 5 weighted affix pools plus the 6th
 * category of fixed named "Lunar Phase" memories (mapped onto the existing
 * MemoryRevival shape, replacing the 3-entry hand-seeded placeholder). */
export function mapHeroMemory(
  master: unknown,
  en: unknown
): { pools: MemoryAffixPools; revivedMemories: MemoryRevival[] } {
  const masterData = (Object.values(master as Record<string, HeroMemoryMasterRaw>)[0] ?? {}) as HeroMemoryMasterRaw;
  const enData = (Object.values(en as Record<string, Record<string, Record<string, MemoryEnEntry>>>)[0] ??
    {}) as Record<string, Record<string, MemoryEnEntry>>;

  const pools: MemoryAffixPools = {
    baseStats: mapMemoryAffixList(masterData.baseStats, enData.baseStats),
    fixedAffixes: mapMemoryAffixList(masterData.fixedAffixes, enData.fixedAffixes),
    randomAffixes: mapMemoryAffixList(masterData.randomAffixes, enData.randomAffixes),
    revivedAffixes: mapMemoryAffixList(masterData.revivedAffixes, enData.revivedAffixes),
    specialRandomAffixes: mapMemoryAffixList(masterData.specialRandomAffixes, enData.specialRandomAffixes)
  };

  const revivedMemories: MemoryRevival[] = (masterData.revivedAffixLunarPhases ?? []).map((raw) => ({
    id: raw.id,
    name: raw.name ?? raw.id,
    ...(raw.description ? { description: raw.description } : {}),
    modifiers: raw.description ? parseModifiers(raw.description) : []
  }));

  return { pools, revivedMemories };
}

export async function scrapeHeroMemory(
  overrides: Partial<ScrapeConfig> = {}
): Promise<{ pools: MemoryAffixPools; revivedMemories: MemoryRevival[] }> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  const [master, en] = await Promise.all([
    fetchBundleRaw('hero-memory-master', cfg),
    fetchBundle('hero-memory', cfg)
  ]);
  return mapHeroMemory(master, en);
}

// ------------------------------- Vorax ---------------------------------------
// SS13's extra "limb" equipment slot. Same craft-affix-tier and legendary-mod
// shapes as regular gear, but keyed by `limb` instead of gear category, and
// worn in addition to normal gear rather than instead of it -- kept as
// separate VoraxAffix/VoraxLegendary types rather than reusing Affix/GearBase
// (whose GearSlot union doesn't have "digits"/"waist" as extra slots).
// Unlike gear/memory affixes, vorax-en already has each tier's/mod's fully
// filled rawText (no template + fillTemplate step needed).

interface VoraxCraftTierRaw {
  id: string;
  tier?: string;
  modifierId?: string;
  levelRequirement?: number;
  weight?: number;
}
interface VoraxCraftAffixRaw {
  id: string;
  limb?: string;
  descriptionTemplate?: string;
  tiers?: VoraxCraftTierRaw[];
}
interface VoraxCraftTierEnRaw {
  id: string;
  rawText?: string;
}
interface VoraxCraftAffixEnRaw {
  tiers?: VoraxCraftTierEnRaw[];
}
interface VoraxLegendaryModRaw {
  id: string;
  modifierId?: string;
}
interface VoraxLegendaryRaw {
  id: string;
  limb?: string;
  icon?: string;
  mods?: VoraxLegendaryModRaw[];
}
interface VoraxLegendaryModEnRaw {
  id: string;
  normalRawText?: string;
  corrodedRawText?: string;
}
interface VoraxLegendaryEnRaw {
  name?: string;
  mods?: VoraxLegendaryModEnRaw[];
}
interface VoraxMasterRaw {
  // Unlike gear-master (dicts keyed by section), vorax-master's craftAffixes
  // and legendaries are plain arrays, each entry carrying its own `id`.
  craftAffixes?: VoraxCraftAffixRaw[];
  legendaries?: VoraxLegendaryRaw[];
}
interface VoraxEnRaw {
  craftAffixes?: Record<string, VoraxCraftAffixEnRaw>;
  legendaries?: Record<string, VoraxLegendaryEnRaw>;
}

/** Map vorax master+en into craft affixes (weighted tiers, for a crafting-odds
 * simulator) and legendaries (with normal + corroded mutation variants). */
export function mapVorax(master: unknown, en: unknown): { affixes: VoraxAffix[]; legendaries: VoraxLegendary[] } {
  const masterData = (Object.values(master as Record<string, VoraxMasterRaw>)[0] ?? {}) as VoraxMasterRaw;
  const enData = (Object.values(en as Record<string, VoraxEnRaw>)[0] ?? {}) as VoraxEnRaw;

  const affixes: VoraxAffix[] = (masterData.craftAffixes ?? []).map((raw) => {
    const enTiers = new Map((enData.craftAffixes?.[raw.id]?.tiers ?? []).map((t) => [t.id, t.rawText]));
    const tiers: AffixTier[] = (raw.tiers ?? []).map((t) => ({
      tier: t.tier ?? '?',
      weight: t.weight ?? 0,
      ...(t.levelRequirement != null ? { levelRequirement: t.levelRequirement } : {}),
      ...(t.modifierId != null ? { modifierId: t.modifierId } : {}),
      modifiers: parseModifiers(enTiers.get(t.id) ?? '')
    }));
    // Top-level `modifiers` must be a tier a player can actually craft --
    // weight 0 means disabled/unobtainable (same convention as regular gear
    // affixes' topTier()), and it isn't always tiers[0]. Falls back to the
    // literal first tier only if none are craftable, so the affix doesn't
    // lose its modifiers entirely in that edge case.
    const craftableTier = tiers.find((t) => t.weight > 0) ?? tiers[0];
    return {
      id: raw.id,
      limb: raw.limb ?? 'unknown',
      modifiers: craftableTier?.modifiers ?? [],
      ...(tiers.length > 0 ? { tiers } : {})
    };
  });

  const legendaries: VoraxLegendary[] = (masterData.legendaries ?? []).map((raw) => {
    const enLeg = enData.legendaries?.[raw.id];
    const enModsById = new Map((enLeg?.mods ?? []).map((m) => [m.id, m]));
    const modifiers = (raw.mods ?? []).flatMap((m) => parseModifiers(enModsById.get(m.id)?.normalRawText ?? ''));
    const corrodedModifiers = (raw.mods ?? []).flatMap((m) => parseModifiers(enModsById.get(m.id)?.corrodedRawText ?? ''));
    return {
      id: raw.id,
      limb: raw.limb ?? 'unknown',
      ...(raw.icon ? { icon: raw.icon } : {}),
      modifiers,
      ...(corrodedModifiers.length > 0 ? { corrodedModifiers } : {})
    };
  });

  return { affixes, legendaries };
}

export async function scrapeVorax(
  overrides: Partial<ScrapeConfig> = {}
): Promise<{ affixes: VoraxAffix[]; legendaries: VoraxLegendary[] }> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  const [master, en] = await Promise.all([fetchBundleRaw('vorax-master', cfg), fetchBundle('vorax', cfg)]);
  return mapVorax(master, en);
}

// --------------------------------- Kismet ------------------------------------
// Unlike gear/vorax/memory affixes, kismet-master already carries its own
// effect text (sign/valueMin/valueMax/unit/text) directly -- no separate -en
// bundle/template-fill step needed, same shape as pactspirit's node effects.
// ~40% of entries (74/192 in the SS13 sample) have no effects at all -- kept
// as an empty modifiers list rather than skipped, same as every other
// best-effort category. No `name` field exists in the scraped data.

interface KismetEffectRaw {
  sign?: string;
  valueMin?: number;
  valueMax?: number;
  unit?: string;
  text?: string;
}
interface KismetRaw {
  id: string;
  iconUrl?: string;
  rarity?: string;
  type?: string;
  effects?: KismetEffectRaw[];
}
interface KismetMasterRaw {
  kismets?: KismetRaw[];
}

/** `text` already embeds its own unit as a leading token (e.g. "% Fire
 * Resistance", not just "Fire Resistance") -- confirmed against the real
 * scrape, unlike pactspirit's clean-prose effect text. Appending `unit`
 * separately would double it up ("18% % Fire Resistance"), breaking every
 * regex in parseModifiers that expects "<number>% <word>". */
function kismetEffectsToText(effects: KismetEffectRaw[] | undefined): string {
  return (effects ?? [])
    .map((e) => `${e.sign ?? ''}${e.valueMax ?? e.valueMin ?? ''}${e.text ?? ''}`.trim())
    .join('\n');
}

export function mapKismet(bundle: unknown): Kismet[] {
  const data = (Object.values(bundle as Record<string, KismetMasterRaw>)[0] ?? {}) as KismetMasterRaw;
  return (data.kismets ?? []).map((raw) => ({
    id: raw.id,
    ...(raw.iconUrl != null ? { iconUrl: raw.iconUrl } : {}),
    ...(raw.rarity != null ? { rarity: raw.rarity } : {}),
    ...(raw.type != null ? { type: raw.type } : {}),
    modifiers: parseModifiers(kismetEffectsToText(raw.effects))
  }));
}

export async function scrapeKismet(overrides: Partial<ScrapeConfig> = {}): Promise<Kismet[]> {
  const cfg: ScrapeConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapKismet(await fetchBundleRaw('kismet-master', cfg));
}
