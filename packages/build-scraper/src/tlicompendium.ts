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
  SkillLevelEntry,
  SupportSkill,
  Talent
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

const SLOT_KEYWORDS: [RegExp, GearSlot][] = [
  [/boots|greaves|stride|treads|sabatons/i, 'boots'],
  [/glove|gauntlet|grip|fist|knuckle|hand/i, 'gloves'],
  [/helm|hood|mask|crown|visage|circlet|cap/i, 'helmet'],
  [/belt|girdle|sash|waist|buckle/i, 'belt'],
  [/amulet|necklace|pendant|choker|collar/i, 'amulet'],
  [/ring|band|loop|signet/i, 'ring'],
  [/armor|armour|vest|robe|plate|garb|cloak|mantle|shroud|carapace|chest/i, 'chest']
];

/** Best-effort slot from a legendary's name (the bundle has no slot field). */
function inferSlot(name: string): GearSlot {
  for (const [re, slot] of SLOT_KEYWORDS) if (re.test(name)) return slot;
  return 'weapon';
}

/** Map the `legendaries` bundle to GearBase[]. NOTE: legendaries carry no slot
 * field, so slot is inferred from the name — imperfect and documented. */
export function mapLegendaries(bundle: unknown): GearBase[] {
  const byId = new Map<string, GearBase>();
  for (const raw of leaves(bundle)) {
    const e = raw as unknown as LegendaryLeaf;
    if (!Array.isArray(e.mods)) continue; // skip label-only leaves
    const text = e.mods.map((m) => stripHtml(m.normalRawText ?? '')).join('\n');
    const id = idFromName(e.name);
    if (!byId.has(id)) {
      byId.set(id, { id, name: e.name, slot: inferSlot(e.name), implicit: parseModifiers(text) });
    }
  }
  return [...byId.values()];
}

interface TraitLeaf {
  name: string;
  tiers?: { level?: number; description?: string }[];
}

/** Map the `hero-trait` bundle to Talent[] (heroId unknown at leaf → 'any'). */
export function mapHeroTraits(bundle: unknown): Talent[] {
  const byId = new Map<string, Talent>();
  for (const raw of leaves(bundle)) {
    const e = raw as unknown as TraitLeaf;
    if (!Array.isArray(e.tiers) || e.tiers.length === 0) continue;
    const top = e.tiers[e.tiers.length - 1]; // highest tier
    const text = stripHtml(top?.description ?? '');
    const id = idFromName(e.name);
    if (!byId.has(id)) {
      byId.set(id, { id, name: e.name, heroId: 'any', modifiers: parseModifiers(text) });
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
        ...(levelScaling ? { levelScaling } : {})
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
  belt: 'belt',
  waist: 'belt'
};

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

/** Highest-roll tier of a craft affix (used for the top-level `modifiers`). */
function topTier(a: CraftAffix): RawAffixTier | undefined {
  return (a.tiers ?? [])
    .slice()
    .sort((x, y) => (y.values?.[0]?.maxValue ?? 0) - (x.values?.[0]?.maxValue ?? 0))[0];
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
  return [...byKey.values()];
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
