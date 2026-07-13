// Alternative (preferred) source: tlicompendium.com structured JSON data bundles.
//
// One bundle per category (gear, legendaries, hero-trait, pactspirit, …) at
// `/data-bundles/SS12.5-<name>-en.json`. Bundles are deeply nested maps; the
// leaf entries carry `name` + structured fields. This is far cleaner than the
// tlidb HTML scrape for gear/affixes/progression, which is why those categories
// source from here. Skills stay on tlidb (scrape.ts) — its cards expose clean
// element/tag chips these bundles don't.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ActiveSkill,
  Affix,
  DamageTag,
  Element,
  GearBase,
  GearSlot,
  SupportSkill,
  Talent
} from '@torchlight-companion/build-data';
import { DEFAULT_CONFIG, parseModifiers, type TlidbConfig } from './scrape.js';

export const BUNDLE_BASE = 'https://tlicompendium.com/data-bundles';
export const DATA_VERSION = 'SS12.5';

/** Fetch a `<version>-<name>-en.json` bundle, cached on disk. */
export async function fetchBundle(name: string, cfg: TlidbConfig): Promise<unknown> {
  const file = `${DATA_VERSION}-${name}-en.json`;
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

interface MasterSkill {
  id: string;
  tags?: string[];
  castSpeed?: string;
  effectivenessOfAddedDamage?: string;
}

/** Map uuid -> { name, description } from an `-en` skill/gear bundle. */
function indexEnById(enBundle: unknown): Map<string, { name: string; description: string | undefined }> {
  const map = new Map<string, { name: string; description: string | undefined }>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (val && typeof val === 'object' && typeof (val as { name?: unknown }).name === 'string') {
        const v = val as { name: string; description?: string };
        map.set(key, { name: v.name, description: v.description });
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

/** Map the skill `-master` + `-en` bundles into active and support skills. */
export function mapSkills(
  master: unknown,
  en: unknown
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

      if (!isActive) {
        support.push({ id, name, modifiers: parseModifiers(meta?.description ?? ''), requiresTags: [] });
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
        season: DATA_VERSION
      });
    }
  }
  return { active, support };
}

/** Fetch the skill `-master` + `-en` bundles and map them. */
export async function scrapeSkillsFromBundles(
  overrides: Partial<TlidbConfig> = {}
): Promise<{ active: ActiveSkill[]; support: SupportSkill[] }> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  const [master, en] = await Promise.all([
    fetchBundleRaw('skill-master', cfg),
    fetchBundle('skill', cfg)
  ]);
  return mapSkills(master, en);
}

/** Fetch a `-master` bundle (same as fetchBundle but the master variant name is
 * passed literally, e.g. `skill-master`). */
async function fetchBundleRaw(fullName: string, cfg: TlidbConfig): Promise<unknown> {
  const file = `${DATA_VERSION}-${fullName}.json`;
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
interface AffixTier {
  modifierId?: string;
  values?: AffixValue[];
}
interface CraftAffix {
  descriptionTemplate?: string;
  tiers?: AffixTier[];
}
interface GearSection {
  category?: string;
  baseItems?: { id?: string; tlidbId?: string | number; implicits?: unknown[] }[];
  craftPrefix?: CraftAffix[];
  craftSuffix?: CraftAffix[];
}

/** Fill a "+# Max Life" template with the (max) roll values, in order. */
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

/** Highest-roll tier of a craft affix. */
function topTier(a: CraftAffix): AffixTier | undefined {
  return (a.tiers ?? [])
    .slice()
    .sort((x, y) => (y.values?.[0]?.maxValue ?? 0) - (x.values?.[0]?.maxValue ?? 0))[0];
}

/**
 * Map gear-master's craftPrefix/craftSuffix into the Affix pool. Dedupes by
 * (kind, stat template), unions slots + modifier ids across gear subtypes, and
 * keeps only affixes whose stat the calculator models. modifierIds are retained
 * so a future loot parser can map a dropped roll back to the affix.
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
        const key = `${kind}|${template}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.slots.includes(slot)) existing.slots.push(slot);
          existing.modifierIds = [...new Set([...(existing.modifierIds ?? []), ...ids])];
        } else {
          const name = affixName(template);
          byKey.set(key, {
            id: `${idFromName(name)}-${kind}`,
            name,
            kind,
            modifiers,
            slots: [slot],
            modifierIds: [...new Set(ids)]
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
export async function scrapeGear(overrides: Partial<TlidbConfig> = {}): Promise<GearBase[]> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  const [master, en] = await Promise.all([
    fetchBundleRaw('gear-master', cfg),
    fetchBundle('gear', cfg)
  ]);
  return mapGearFromMaster(master, en);
}

/** Fetch gear `-master` and extract the rollable affix pool. */
export async function scrapeAffixes(overrides: Partial<TlidbConfig> = {}): Promise<Affix[]> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapAffixes(await fetchBundleRaw('gear-master', cfg));
}

export async function scrapeLegendaries(overrides: Partial<TlidbConfig> = {}): Promise<GearBase[]> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapLegendaries(await fetchBundle('legendaries', cfg));
}

export async function scrapeHeroTraits(overrides: Partial<TlidbConfig> = {}): Promise<Talent[]> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapHeroTraits(await fetchBundle('hero-trait', cfg));
}
