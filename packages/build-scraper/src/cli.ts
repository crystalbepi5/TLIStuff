// CLI: scrape tlidb and write dataset seed files.
//
//   node dist/cli.js [--out DIR] [--limit N] [--delay MS]
//
// Currently scrapes the two clean, high-value types — active skills and support
// skills — and writes them as build-data seed JSON. It does NOT overwrite the
// hand-curated seed; it writes to `--out` (default ./scraped) so you can review
// and promote the files deliberately. See TODOs in scrape.ts for the remaining
// types (talents, pact spirits, legendaries, affixes).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrapeActiveSkills, scrapeSupports, type TlidbConfig } from './scrape.js';

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

  console.error(`[scrape] active skills…`);
  const { skills, skipped: s1 } = await scrapeActiveSkills(cfg);
  console.error(`[scrape] support skills…`);
  const { supports, skipped: s2 } = await scrapeSupports(cfg);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'activeSkills.json'), JSON.stringify(skills, null, 2) + '\n');
  writeFileSync(join(outDir, 'supportSkills.json'), JSON.stringify(supports, null, 2) + '\n');

  const mappedSupports = supports.filter((s) => s.modifiers.length > 0).length;
  console.error(
    `\n[done] ${skills.length} active skills, ${supports.length} supports ` +
      `(${mappedSupports} with mapped modifiers) -> ${outDir}/`
  );
  if (s1.length || s2.length) {
    console.error(`[skipped] ${s1.length} skills, ${s2.length} supports (non-card or fetch errors)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
