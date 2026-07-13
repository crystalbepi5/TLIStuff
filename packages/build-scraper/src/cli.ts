// CLI: assemble the full build-data dataset from all sources and write seed JSON.
//
//   node dist/cli.js [--out DIR] [--limit N] [--delay MS]
//   pnpm --filter @torchlight-companion/build-scraper scrape -- --out ../build-data/src/seed
//
// Sources:
//   - skills (active + support)         -> tlidb.com   (scrape.ts)
//   - gear + legendaries -> gearBases   -> tlicompendium.com (tlicompendium.ts)
//   - hero traits        -> talents     -> tlicompendium.com
//   - heroes / affixes / pact spirits / divinity   -> kept from the hand-curated
//     seed (no clean source yet)
//
// Writes one JSON file per scraped category to --out (default ./scraped), so you
// can review before promoting into packages/build-data/src/seed. It does NOT
// touch the hand-curated categories.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedDataset, validateDataset, type Dataset } from '@torchlight-companion/build-data';
import type { TlidbConfig } from './scrape.js';
import {
  scrapeSkillsFromBundles,
  scrapeGear,
  scrapeLegendaries,
  scrapeHeroTraits
} from './tlicompendium.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

async function main(): Promise<void> {
  const outDir = arg('out', 'scraped');
  const cfg: Partial<TlidbConfig> = {
    limit: Number(arg('limit', '0')),
    delayMs: Number(arg('delay', '400'))
  };

  console.error('[scrape] tlicompendium: skills (master+en)…');
  const { active: skills, support: supports } = await scrapeSkillsFromBundles(cfg);
  console.error('[scrape] tlicompendium: gear…');
  const gear = await scrapeGear(cfg);
  console.error('[scrape] tlicompendium: legendaries…');
  const legendaries = await scrapeLegendaries(cfg);
  console.error('[scrape] tlicompendium: hero traits…');
  const traits = await scrapeHeroTraits(cfg);

  const gearBases = [...gear, ...legendaries];
  const talents = traits.length > 0 ? traits : seedDataset.talents;

  // A full dataset for validation (hand-curated categories fill the gaps).
  const dataset: Dataset = {
    meta: {
      source: 'scrape',
      generatedAt: new Date().toISOString(),
      note: 'tlicompendium: skills/gear/legendaries/talents; heroes/affixes/pactspirits/memories from hand-curated seed'
    },
    heroes: seedDataset.heroes,
    activeSkills: skills,
    supportSkills: supports,
    affixes: seedDataset.affixes,
    gearBases,
    talents,
    pactSpirits: seedDataset.pactSpirits,
    memories: seedDataset.memories
  };

  mkdirSync(outDir, { recursive: true });
  const write = (file: string, data: unknown) =>
    writeFileSync(join(outDir, file), JSON.stringify(data, null, 2) + '\n');
  write('activeSkills.json', skills);
  write('supportSkills.json', supports);
  write('gearBases.json', gearBases);
  write('talents.json', talents);

  const withMods = (arr: { modifiers?: unknown[]; implicit?: unknown[] }[]) =>
    arr.filter((x) => (x.modifiers ?? x.implicit ?? []).length > 0).length;

  console.error('\n[done] wrote to ' + outDir + '/');
  console.error(`  activeSkills : ${skills.length}`);
  console.error(`  supportSkills: ${supports.length} (${withMods(supports)} with modifiers)`);
  console.error(`  gearBases    : ${gearBases.length} (${withMods(gearBases)} with modifiers)`);
  console.error(`  talents      : ${talents.length} (${withMods(talents)} with modifiers)`);

  const problems = validateDataset(dataset);
  const damageless = problems.filter((p) => /no base damage/.test(p)).length;
  console.error(
    `[validate] ${problems.length} notes (${damageless} are no-damage utility skills — expected)`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
