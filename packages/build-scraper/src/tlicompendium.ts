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
import type { GearBase, GearSlot, Talent } from '@torchlight-companion/build-data';
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

/** Fetch + map a single category. Convenience for the CLI. */
export async function scrapeGear(overrides: Partial<TlidbConfig> = {}): Promise<GearBase[]> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapGear(await fetchBundle('gear', cfg));
}

export async function scrapeLegendaries(overrides: Partial<TlidbConfig> = {}): Promise<GearBase[]> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapLegendaries(await fetchBundle('legendaries', cfg));
}

export async function scrapeHeroTraits(overrides: Partial<TlidbConfig> = {}): Promise<Talent[]> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  return mapHeroTraits(await fetchBundle('hero-trait', cfg));
}
