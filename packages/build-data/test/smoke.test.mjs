import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDataset, indexDataset, validateDataset } from '../dist/index.js';

test('seed dataset validates cleanly', () => {
  const problems = validateDataset(seedDataset);
  assert.deepEqual(problems, [], `unexpected problems: ${problems.join(', ')}`);
});

test('seed dataset is marked as seed provenance', () => {
  assert.equal(seedDataset.meta.source, 'seed');
});

test('index resolves the SS13 hero and skill', () => {
  const index = indexDataset(seedDataset);
  const selina = index.hero('selina-tide-whisper');
  assert.ok(selina, 'expected Selina hero to exist');
  assert.equal(selina.season, 'SS13');
  assert.ok(index.activeSkill('dance-of-the-deep'), 'expected Dance of the Deep');
});

test('index resolves talents, pact spirits and memories', () => {
  const index = indexDataset(seedDataset);
  assert.ok(index.talent('selina-deep-current'), 'expected a Selina talent');
  assert.ok(index.pactSpirit('leviathan'), 'expected the Leviathan pact spirit');
  const memory = index.memory('awakened-tide');
  assert.ok(memory, 'expected an SS13 memory');
  assert.equal(memory.season, 'SS13');
});
