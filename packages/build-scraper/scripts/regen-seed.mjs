// Regenerate build-data's seed from tlicompendium at the latest season.
//
//   node scripts/regen-seed.mjs [--version SSxx]
//
// Scrapes every category, merges the small hand-curated demo entries
// (seed-hand/, which the calc/data tests reference) in front of the fresh
// scraped data (dedup by id), and writes packages/build-data/src/seed/*.json.
// Deterministic + single-command, so a scheduled job can run it and open a PR
// when the dataset changes.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  resolveLatestVersion,
  scrapeSkillsFromBundles,
  scrapeGear,
  scrapeAffixes,
  scrapeLegendaries,
  scrapeHeroTraits,
  scrapeVoidCharts,
  scrapeTalentTrees,
  scrapePactSpirits,
  scrapeHeroMemory,
  scrapeVorax,
  scrapeKismet
} from '../dist/index.js';

const seedDir = fileURLToPath(new URL('../../build-data/src/seed/', import.meta.url));
const handDir = fileURLToPath(new URL('../../build-data/src/seed-hand/', import.meta.url));

const cfg = { ...DEFAULT_CONFIG };
const vIdx = process.argv.indexOf('--version');
cfg.version = vIdx >= 0 && process.argv[vIdx + 1] ? process.argv[vIdx + 1] : await resolveLatestVersion(cfg);
console.error(`[regen] season: ${cfg.version}`);

const { active, support } = await scrapeSkillsFromBundles(cfg);
const gear = await scrapeGear(cfg);
const affixes = await scrapeAffixes(cfg);
const legendaries = await scrapeLegendaries(cfg);
const talents = await scrapeHeroTraits(cfg);
const pactSpirits = await scrapePactSpirits(cfg);
const { pools: memoryAffixPools, revivedMemories } = await scrapeHeroMemory(cfg);
const voidCharts = await scrapeVoidCharts(cfg);
const talentTrees = await scrapeTalentTrees(cfg);
const { affixes: voraxAffixes, legendaries: voraxLegendaries } = await scrapeVorax(cfg);
const kismets = await scrapeKismet(cfg);

// Categories with a small hand-curated demo tier (kept first, real scraped
// data deduped behind it by id) so tests referencing fixed demo ids keep
// working even as the season's real data changes underneath them.
const withHandTier = {
  activeSkills: active,
  supportSkills: support,
  affixes,
  gearBases: [...gear, ...legendaries],
  talents,
  pactSpirits,
  memories: revivedMemories
};

for (const [name, arr] of Object.entries(withHandTier)) {
  const hand = JSON.parse(readFileSync(handDir + name + '.json', 'utf8'));
  const ids = new Set(hand.map((x) => x.id));
  const merged = [...hand, ...arr.filter((x) => !ids.has(x.id))];
  writeFileSync(seedDir + name + '.json', JSON.stringify(merged, null, 2) + '\n');
  console.error(`[regen] ${name}: ${hand.length} hand + ${arr.length} scraped -> ${merged.length}`);
}

// Reference-only categories (not yet wired into Build/collectModifiers, no
// demo id anything depends on) -- written straight from the scrape.
const scrapedOnly = { voidCharts, talentTrees, voraxAffixes, voraxLegendaries, kismets };
for (const [name, data] of Object.entries(scrapedOnly)) {
  writeFileSync(seedDir + name + '.json', JSON.stringify(data, null, 2) + '\n');
  console.error(`[regen] ${name}: ${data.length} scraped`);
}
writeFileSync(seedDir + 'memoryAffixPools.json', JSON.stringify(memoryAffixPools, null, 2) + '\n');
console.error(
  `[regen] memoryAffixPools: ${Object.values(memoryAffixPools).reduce((n, a) => n + a.length, 0)} affixes across ${Object.keys(memoryAffixPools).length} pools`
);

console.error('[regen] done — rebuild build-data + run tests, then PR if the seed changed.');
