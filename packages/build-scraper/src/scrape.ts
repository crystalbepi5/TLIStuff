// Ingestion pipeline: community Torchlight Infinite database -> build-data Dataset.
//
// ============================ READ THIS FIRST ============================
// This script CANNOT run inside the Claude Code web session that generated it:
// the session's egress policy blocks tli-hub.com / tlidb.com (HTTP 403 at the
// proxy). Run it on your own machine, where those hosts are reachable:
//
//     pnpm --filter @torchlight-companion/build-scraper build
//     node packages/build-scraper/dist/scrape.js > packages/build-data/src/seed/scraped.json
//
// The DOM/JSON *shape* of the target site is not verified here — the same
// honesty caveat the README makes about the log parser applies. The functions
// under "SITE-SPECIFIC MAPPING" are best-effort against how a Next.js data
// site is *typically* structured and must be checked against the real payload
// (log `nextData` once and adjust the maps). Everything above that line — the
// fetch, __NEXT_DATA__ extraction, assembly, and validation — is site-agnostic.
// =========================================================================

import type {
  ActiveSkill,
  Affix,
  Dataset,
  Divinity,
  GearBase,
  Hero,
  PactSpirit,
  SupportSkill,
  Talent
} from '@torchlight-companion/build-data';
import { validateDataset } from '@torchlight-companion/build-data';
import { pathToFileURL } from 'node:url';

export interface ScrapeConfig {
  /** Base URL of the community database, e.g. https://tli-hub.com */
  baseUrl: string;
  /** Paths (relative to baseUrl) whose __NEXT_DATA__ carries each category. */
  paths: {
    heroes: string;
    skills: string;
    supports: string;
    affixes: string;
    gearBases: string;
    talents: string;
    pactSpirits: string;
    divinities: string;
  };
  /** Optional User-Agent; some hosts reject the default. */
  userAgent?: string;
}

export const DEFAULT_CONFIG: ScrapeConfig = {
  baseUrl: 'https://tli-hub.com',
  paths: {
    heroes: '/database/heroes',
    skills: '/database/skills',
    supports: '/database/skills?type=support',
    affixes: '/database/affixes',
    gearBases: '/database/items',
    talents: '/database/talents',
    pactSpirits: '/database/pact-spirits',
    divinities: '/database/divinity'
  },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) torchlight-companion-scraper/0.1'
};

// --------------------------- SITE-AGNOSTIC CORE ---------------------------

export async function fetchPage(url: string, userAgent?: string): Promise<string> {
  const res = await fetch(url, {
    headers: userAgent ? { 'user-agent': userAgent } : {}
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Pull and parse the JSON embedded by Next.js in
 * `<script id="__NEXT_DATA__" type="application/json">...</script>`.
 * Returns the decoded object, or null if the marker isn't present (e.g. the
 * site isn't Next.js, or rendered the data differently).
 */
export function extractNextData(html: string): unknown | null {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match || match[1] === undefined) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Safe nested-property read: get(obj, 'props.pageProps.items'). */
export function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// ------------------------- SITE-SPECIFIC MAPPING --------------------------
// Everything below is UNVERIFIED against the live site. Log `nextData` from one
// page, inspect where the list actually lives, and fix `LIST_PATH` + each map.

/** Where the array of records tends to sit inside __NEXT_DATA__. */
const LIST_PATH = 'props.pageProps.items';

function asArray(nextData: unknown): Record<string, unknown>[] {
  const list = get(nextData, LIST_PATH);
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

/** Coerce a possibly-missing value to a finite number, defaulting to 0. */
function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function mapHero(raw: Record<string, unknown>): Hero {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    description: String(raw.description ?? ''),
    baseModifiers: [] // TODO: map raw trait modifiers -> Modifier[]
  };
}

function mapSkill(raw: Record<string, unknown>): ActiveSkill {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    tags: [], // TODO: map raw tag list -> DamageTag[]
    baseDamage: {}, // TODO: map raw base-damage table -> Partial<Record<Element, number>>
    baseRate: num(raw.baseRate ?? raw.attacksPerSecond),
    baseCritRate: num(raw.critRate ?? 5),
    supportSlots: num(raw.supportSlots ?? 5)
  };
}

function mapSupport(raw: Record<string, unknown>): SupportSkill {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    modifiers: [], // TODO
    requiresTags: []
  };
}

function mapAffix(raw: Record<string, unknown>): Affix {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    kind: raw.kind === 'prefix' ? 'prefix' : 'suffix',
    modifiers: [], // TODO
    slots: [] // TODO
  };
}

function mapGearBase(raw: Record<string, unknown>): GearBase {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    slot: 'weapon', // TODO: map raw slot
    implicit: [] // TODO
  };
}

function mapTalent(raw: Record<string, unknown>): Talent {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    heroId: raw.heroId ? String(raw.heroId) : 'any', // TODO: map raw hero scope
    modifiers: [] // TODO
  };
}

function mapPactSpirit(raw: Record<string, unknown>): PactSpirit {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    modifiers: [] // TODO
  };
}

function mapDivinity(raw: Record<string, unknown>): Divinity {
  return {
    id: String(raw.id ?? raw.slug ?? raw.name),
    name: String(raw.name ?? 'Unknown'),
    modifiers: [] // TODO
  };
}

// ------------------------------ ASSEMBLY ----------------------------------

export async function scrape(config: ScrapeConfig = DEFAULT_CONFIG): Promise<Dataset> {
  const page = async (path: string) => {
    const html = await fetchPage(config.baseUrl + path, config.userAgent);
    const nextData = extractNextData(html);
    if (nextData === null) {
      throw new Error(`no __NEXT_DATA__ found at ${path} — site shape changed?`);
    }
    return asArray(nextData);
  };

  const [heroes, skills, supports, affixes, gearBases, talents, pactSpirits, divinities] =
    await Promise.all([
      page(config.paths.heroes),
      page(config.paths.skills),
      page(config.paths.supports),
      page(config.paths.affixes),
      page(config.paths.gearBases),
      page(config.paths.talents),
      page(config.paths.pactSpirits),
      page(config.paths.divinities)
    ]);

  const dataset: Dataset = {
    meta: {
      source: 'scrape',
      generatedAt: new Date().toISOString(),
      note: `Scraped from ${config.baseUrl}`
    },
    heroes: heroes.map(mapHero),
    activeSkills: skills.map(mapSkill),
    supportSkills: supports.map(mapSupport),
    affixes: affixes.map(mapAffix),
    gearBases: gearBases.map(mapGearBase),
    talents: talents.map(mapTalent),
    pactSpirits: pactSpirits.map(mapPactSpirit),
    divinities: divinities.map(mapDivinity)
  };

  const problems = validateDataset(dataset);
  if (problems.length > 0) {
    // Warn but still emit — lets you diff partial output while fixing maps.
    for (const p of problems) console.error(`[validate] ${p}`);
  }
  return dataset;
}

// Run directly: `node dist/scrape.js` prints the dataset JSON to stdout.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  scrape()
    .then((dataset) => {
      process.stdout.write(JSON.stringify(dataset, null, 2) + '\n');
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
