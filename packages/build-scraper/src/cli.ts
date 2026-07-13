// CLI: assemble the build-data dataset from tlicompendium bundles and write JSON.
//
//   node dist/cli.js [--out DIR] [--limit N] [--delay MS] [--version SSxx]
//   pnpm --filter @torchlight-companion/build-scraper scrape -- --out ../build-data/src/seed
//
// Sources (all tlicompendium.com):
//   - skills (active + support), gear + legendaries -> gearBases, affixes,
//     hero traits -> talents
//   - heroes / pact spirits / memories -> kept from the hand-curated seed
//
// By default it resolves the newest season from the manifest, so it picks up a
// new season (e.g. SS13) automatically; pass --version to pin one. Writes one
// JSON file per scraped category to --out (default ./scraped).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedDataset, validateDataset, type Dataset } from '@torchlight-companion/build-data';
import { DEFAULT_CONFIG, type ScrapeConfig } from './scrape.js';
import {
  resolveLatestVersion,
  scrapeSkillsFromBundles,
  scrapeGear,
  scrapeAffixes,
  scrapeLegendaries,
  scrapeHeroTraits
} from './tlicompendium.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

async function main(): Promise<void> {
  const outDir = arg('out', 'scraped');
  const cfg: Partial<ScrapeConfig> = {
    limit: Number(arg('limit', '0')),
    delayMs: Number(arg('delay', '400'))
  };

  const pinned = arg('version', '');
  cfg.version = pinned || (await resolveLatestVersion({ ...DEFAULT_CONFIG, ...cfg }));
  console.error(`[scrape] season: ${cfg.version}${pinned ? ' (pinned)' : ' (latest)'}`);

  console.error('[scrape] tlicompendium: skills (master+en)…');
  const { active: skills, support: supports } = await scrapeSkillsFromBundles(cfg);
  console.error('[scrape] tlicompendium: gear (master+en)…');
  const gear = await scrapeGear(cfg);
  console.error('[scrape] tlicompendium: affixes (craft prefix/suffix)…');
  const affixes = await scrapeAffixes(cfg);
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
    affixes: affixes.length > 0 ? affixes : seedDataset.affixes,
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
  write('affixes.json', affixes);
  write('gearBases.json', gearBases);
  write('talents.json', talents);

  const withMods = (arr: { modifiers?: unknown[]; implicit?: unknown[] }[]) =>
    arr.filter((x) => (x.modifiers ?? x.implicit ?? []).length > 0).length;

  console.error('\n[done] wrote to ' + outDir + '/');
  console.error(`  activeSkills : ${skills.length}`);
  console.error(`  supportSkills: ${supports.length} (${withMods(supports)} with modifiers)`);
  console.error(`  affixes      : ${affixes.length} (prefix/suffix, with value ranges + modifier ids)`);
  console.error(`  gearBases    : ${gearBases.length} (${withMods(gearBases)} with modifiers; tlidbId attached)`);
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
