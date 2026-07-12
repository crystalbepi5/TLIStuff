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
  const selena = index.hero('selena-tide-whisper');
  assert.ok(selena, 'expected Selena hero to exist');
  assert.equal(selena.season, 'SS13');
  assert.ok(index.activeSkill('dance-of-the-deep'), 'expected Dance of the Deep');
});

test('index resolves talents, pact spirits and divinity nodes', () => {
  const index = indexDataset(seedDataset);
  assert.ok(index.talent('selena-red-shoes'), 'expected a Selena talent');
  assert.ok(index.pactSpirit('icemirror'), 'expected the Icemirror pact spirit');
  const divinity = index.divinity('nk-small-damage');
  assert.ok(divinity, 'expected a Nether King divinity node');
  assert.equal(divinity.season, 'SS13');
});
