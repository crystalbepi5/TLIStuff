// Ingestion pipeline: tlidb.com (Torchlight: Infinite Wiki) -> build-data Dataset.
//
// tlidb is a server-rendered ASP.NET/Bootstrap site. Every entity lives at
// `/en/<Slug>` as an HTML card; category pages (`/en/Active_Skill`, …) list the
// slugs; `/i18n/autocomplete_en.json` is the master index of every entity keyed
// by type. This module: enumerates slugs from a category page -> fetches each
// entity page (polite + on-disk cache) -> parses the card -> maps to build-data.
//
// NOTE: tlidb currently carries up to the live season (SS12 at time of writing);
// SS13 "Afterlight" content appears here only after it goes live in-game.

import { parse, HTMLElement } from 'node-html-parser';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActiveSkill, DamageTag, Element } from '@torchlight-companion/build-data';

export const BASE_URL = 'https://tlidb.com';

export interface TlidbConfig {
  /** Milliseconds between live requests (politeness). Default 400. */
  delayMs: number;
  /** Directory for the on-disk HTML cache. Default '.tlidb-cache'. */
  cacheDir: string;
  /** Cap the number of entities fetched (for testing). 0 = no cap. */
  limit: number;
  userAgent: string;
}

export const DEFAULT_CONFIG: TlidbConfig = {
  delayMs: 400,
  cacheDir: '.tlidb-cache',
  limit: 0,
  userAgent: 'torchlight-companion-scraper/0.1 (+github build planner)'
};

// --------------------------- fetch (cache + rate-limit) -------------------------

let lastFetchAt = 0;

/** Fetch `BASE_URL + path`, caching the body on disk and rate-limiting live hits. */
export async function fetchPath(path: string, cfg: TlidbConfig): Promise<string> {
  const cacheFile = join(cfg.cacheDir, encodeURIComponent(path) + '.cache');
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');

  const wait = cfg.delayMs - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();

  const res = await fetch(BASE_URL + path, { headers: { 'user-agent': cfg.userAgent } });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status} ${res.statusText}`);
  const body = await res.text();
  mkdirSync(cfg.cacheDir, { recursive: true });
  writeFileSync(cacheFile, body);
  return body;
}

// ------------------------------- enumeration ---------------------------------

/**
 * Entity slugs linked from a category page. Category pages link each entity as
 * a bare relative slug (`href="Aimed_Shot"`); `allowed` (the autocomplete index)
 * filters out season/nav links, keeping only real entities.
 */
export function extractSlugs(categoryHtml: string, allowed: Set<string>): string[] {
  const root = parse(categoryHtml);
  const slugs = new Set<string>();
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (!href || /[:/#?]/.test(href)) continue; // skip absolute/nav/anchor links
    if (allowed.has(href)) slugs.add(href);
  }
  return [...slugs];
}

/** Values from `/i18n/autocomplete_en.json` whose `desc` is in `descTypes`. */
export async function indexSlugs(descTypes: string[], cfg: TlidbConfig): Promise<Set<string>> {
  const raw = await fetchPath('/i18n/autocomplete_en.json', cfg);
  const entries = JSON.parse(raw) as { value: string; desc: string }[];
  const want = new Set(descTypes);
  return new Set(entries.filter((e) => want.has(e.desc)).map((e) => e.value));
}

// ------------------------------- parsing -------------------------------------

const ELEMENT_TAGS: Record<string, Element> = {
  Physical: 'physical',
  Fire: 'fire',
  Cold: 'cold',
  Lightning: 'lightning',
  Erosion: 'erosion'
};

const DAMAGE_TAGS: Record<string, DamageTag> = {
  Attack: 'attack',
  Spell: 'spell',
  Melee: 'melee',
  Area: 'area',
  Projectile: 'projectile',
  Channeled: 'channelled',
  Channelled: 'channelled'
};

export interface ParsedSkill {
  slug: string;
  name: string;
  version: string | undefined;
  elements: Element[];
  rawTags: string[];
  tags: DamageTag[];
  stats: Record<string, string>;
  /** Spell base-damage range (min,max) if the card shows one. */
  damageRange: [number, number] | undefined;
  /** "% weapon damage" effectiveness for attack skills. */
  effectiveness: number | undefined;
  castSeconds: number | undefined;
}

function toNumber(s: string): number {
  return Number(s.replace(/,/g, ''));
}

/** Parse a tlidb skill entity page. Returns null if no skill card is present. */
export function parseSkill(slug: string, html: string): ParsedSkill | null {
  const root = parse(html);
  const pane = root.querySelector('.tab-pane'); // first tab = the skill itself
  const card = pane?.querySelector('.card.ui_item'); // first card = current version
  if (!card) return null;

  const name = card.querySelector('.card-title')?.text.trim() || slug.replace(/_/g, ' ');
  const version = card.querySelector('.item_ver')?.text.trim() || undefined;

  const rawTags = card.querySelectorAll('.tag.tlborder').map((t) => t.text.trim());
  const elements = rawTags.map((t) => ELEMENT_TAGS[t]).filter((e): e is Element => Boolean(e));
  const tags = rawTags.map((t) => DAMAGE_TAGS[t]).filter((t): t is DamageTag => Boolean(t));

  const stats: Record<string, string> = {};
  for (const row of card.querySelectorAll('.d-flex.justify-content-center')) {
    const valNode = row.querySelector('.ps-2');
    const elems = row.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);
    const labelNode = elems.find((n) => !n.classList.contains('ps-2'));
    if (valNode && labelNode) {
      const label = labelNode.text.trim().replace(/:$/, '');
      if (label) stats[label] = valNode.text.trim();
    }
  }

  const castRaw = stats['Cast Speed'];
  const castSeconds = castRaw ? Number.parseFloat(castRaw) || undefined : undefined;
  const effRaw = stats['Effectiveness of added damage'];
  const effMatch = effRaw ? effRaw.match(/([\d.]+)/) : null;
  const effectiveness = effMatch?.[1] ? Number.parseFloat(effMatch[1]) : undefined;

  let damageRange: [number, number] | undefined;
  for (const mod of card.querySelectorAll('.explicitMod .text-mod')) {
    const m = mod.text.trim().match(/^([\d,]+)\s*-\s*([\d,]+)$/);
    if (m?.[1] && m[2]) {
      damageRange = [toNumber(m[1]), toNumber(m[2])];
      break;
    }
  }

  return { slug, name, version, elements, rawTags, tags, stats, damageRange, effectiveness, castSeconds };
}

// ------------------------------- mapping -------------------------------------

function slugToId(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Map a parsed skill to the build-data `ActiveSkill` shape. Base damage is a
 * best-effort single number: spells use the mid of their damage range; attacks
 * use their "% weapon damage" effectiveness as a relative proxy (documented
 * approximation — the calculator's model is simplified).
 */
export function mapActiveSkill(p: ParsedSkill): ActiveSkill {
  const element: Element = p.elements[0] ?? 'physical';
  let base = 0;
  if (p.damageRange) base = Math.round((p.damageRange[0] + p.damageRange[1]) / 2);
  else if (p.effectiveness) base = Math.round(p.effectiveness);

  const baseDamage: Partial<Record<Element, number>> = {};
  if (base > 0) baseDamage[element] = base;

  const baseRate = p.castSeconds && p.castSeconds > 0 ? Number((1 / p.castSeconds).toFixed(3)) : 1;

  return {
    id: slugToId(p.slug),
    name: p.name,
    tags: p.tags,
    baseDamage,
    baseRate,
    baseCritRate: 5,
    supportSlots: 5,
    ...(p.version ? { season: p.version } : {})
  };
}

// ------------------------------ orchestration --------------------------------

/** Scrape every active skill listed on tlidb's Active Skill category page. */
export async function scrapeActiveSkills(
  overrides: Partial<TlidbConfig> = {}
): Promise<{ skills: ActiveSkill[]; skipped: string[] }> {
  const cfg: TlidbConfig = { ...DEFAULT_CONFIG, ...overrides };
  const allowed = await indexSlugs(['Skill'], cfg);
  const catHtml = await fetchPath('/en/Active_Skill', cfg);
  let slugs = extractSlugs(catHtml, allowed);
  if (cfg.limit > 0) slugs = slugs.slice(0, cfg.limit);

  const skills: ActiveSkill[] = [];
  const skipped: string[] = [];
  for (const slug of slugs) {
    try {
      const parsed = parseSkill(slug, await fetchPath(`/en/${slug}`, cfg));
      if (parsed) skills.push(mapActiveSkill(parsed));
      else skipped.push(slug);
    } catch (err) {
      skipped.push(`${slug} (${err instanceof Error ? err.message : err})`);
    }
  }
  return { skills, skipped };
}
