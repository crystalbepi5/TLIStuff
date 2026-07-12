import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeShareCode,
  decodeShareCode,
  extractCode,
  importBuildCode,
  normalizeBuild
} from '../dist/index.js';

function sampleBuild(overrides = {}) {
  return normalizeBuild({
    id: 'b',
    name: 'Cold Selena',
    heroId: 'selena-tide-whisper',
    activeSkillId: 'dance-of-the-deep',
    supportIds: ['channeled-depths'],
    talentIds: ['selena-red-shoes'],
    pactSpiritIds: ['icemirror'],
    divinityIds: ['nk-small-damage'],
    ...overrides
  });
}

test('native share code round-trips', () => {
  const build = sampleBuild();
  const decoded = decodeShareCode(encodeShareCode(build));
  assert.deepEqual(decoded, build);
});

test('decodeShareCode backfills missing fields from a bare build payload', () => {
  const bare = { heroId: 'x', activeSkillId: 'y' };
  const code = Buffer.from(JSON.stringify(bare), 'utf-8').toString('base64');
  const build = decodeShareCode(code);
  assert.deepEqual(build.supportIds, []);
  assert.deepEqual(build.talentIds, []);
  assert.deepEqual(build.pactSpiritIds, []);
  assert.deepEqual(build.divinityIds, []);
});

test('importBuildCode accepts a native code', () => {
  const result = importBuildCode(encodeShareCode(sampleBuild()));
  assert.equal(result.ok, true);
  assert.equal(result.format, 'native');
  assert.equal(result.build.heroId, 'selena-tide-whisper');
});

test('importBuildCode rejects garbage with a discriminated error', () => {
  const result = importBuildCode('not a real code!!!');
  assert.equal(result.ok, false);
  assert.match(result.error, /Unrecognised build code/);
});

test('importBuildCode detects external planners and reports they need a sample', () => {
  const compendium = importBuildCode('https://tlicompendium.com/en/build-planner#build=abc123');
  assert.equal(compendium.ok, false);
  assert.match(compendium.error, /Compendium/i);

  const pob = importBuildCode('https://tlipob.com/#code=xyz');
  assert.equal(pob.ok, false);
  assert.match(pob.error, /Torchlight of Building/i);
});

test('extractCode pulls the code from hash, query, or path', () => {
  assert.equal(extractCode('https://x.com/plan#build=HASHCODE'), 'HASHCODE');
  assert.equal(extractCode('https://x.com/plan?code=QUERYCODE'), 'QUERYCODE');
  assert.equal(extractCode('https://x.com/build/PATHCODE'), 'PATHCODE');
  assert.equal(extractCode('  RAWCODE  '), 'RAWCODE');
});
