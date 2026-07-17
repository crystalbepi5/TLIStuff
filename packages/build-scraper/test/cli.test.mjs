import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNotSeedDir } from '../dist/cli.js';

// cli.ts writes raw scraped arrays with no hand-curated-fixture merge (unlike
// scripts/regen-seed.mjs). Writing straight to the checked-in seed directory
// would silently discard the seed-hand/ entries the test suite depends on --
// this guard turns that footgun into a loud failure instead.

test('assertNotSeedDir throws for a path ending in build-data/src/seed', () => {
  assert.throws(() => assertNotSeedDir('../build-data/src/seed'), /regen-seed\.mjs/);
  assert.throws(() => assertNotSeedDir('/home/user/TLIStuff/packages/build-data/src/seed'), /regen-seed\.mjs/);
});

test('assertNotSeedDir allows any other output directory', () => {
  assert.doesNotThrow(() => assertNotSeedDir('scraped'));
  assert.doesNotThrow(() => assertNotSeedDir('../build-data/src/seed-hand'));
  assert.doesNotThrow(() => assertNotSeedDir('/tmp/some-other-dir'));
});
