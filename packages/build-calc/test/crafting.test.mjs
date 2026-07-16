import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticOdds, monteCarloOdds } from '../dist/index.js';

// Modeled on the Max Life boots affix fixture used in tiers.test.mjs:
// tiers with real differentiated weights (100 and 200), one of which is the
// "target".
const pool = [
  { tier: '1', weight: 100, modifierId: 'A', modifiers: [] },
  { tier: '2', weight: 200, modifierId: 'B', modifiers: [] },
  { tier: '3', weight: 700, modifierId: 'C', modifiers: [] }
];

test('analyticOdds computes chance as the matching tier(s) share of total pool weight', () => {
  const matches = pool.filter((t) => t.tier === '1');
  const odds = analyticOdds(pool, matches);
  assert.equal(odds.poolSize, 3);
  assert.equal(odds.totalWeight, 1000);
  assert.equal(odds.matchingWeight, 100);
  assert.equal(odds.chancePerCraft, 0.1);
  assert.equal(odds.expectedAttempts, 10);
  assert.equal(odds.isFlatPool, false);
});

test('analyticOdds supports matching more than one tier at once (e.g. "tier 1 or better")', () => {
  const matches = pool.filter((t) => t.tier === '1' || t.tier === '2');
  const odds = analyticOdds(pool, matches);
  assert.equal(odds.matchingWeight, 300);
  assert.equal(odds.chancePerCraft, 0.3);
});

test('analyticOdds returns Infinity expectedAttempts and 0 chance when nothing matches', () => {
  const odds = analyticOdds(pool, []);
  assert.equal(odds.chancePerCraft, 0);
  assert.equal(odds.expectedAttempts, Infinity);
});

test('analyticOdds flags a flat (all-equal-weight) pool the same way the Python tool does', () => {
  const flatPool = [
    { tier: '1', weight: 1, modifierId: 'X', modifiers: [] },
    { tier: '2', weight: 1, modifierId: 'Y', modifiers: [] }
  ];
  assert.equal(analyticOdds(flatPool, [flatPool[0]]).isFlatPool, true);
  assert.equal(analyticOdds(pool, [pool[0]]).isFlatPool, false);
});

test('monteCarloOdds with a fixed seed is deterministic and its avgAttempts roughly matches 1/chance', () => {
  const matches = pool.filter((t) => t.tier === '1');
  const mc = monteCarloOdds(pool, matches, 5000, 42);
  assert.equal(mc.trials, 5000);
  // Each trial re-rolls until it hits the target (or the 100k safety valve),
  // so with a nonzero true chance hitRate is ~1 (it's a "did we eventually
  // hit" check, same as the Python tool) -- avgAttempts is the metric that
  // actually estimates 1/chance (10, here), and a fixed seed makes the exact
  // value reproducible rather than flaky.
  assert.equal(mc.hitRate, 1);
  assert.ok(Math.abs(mc.avgAttempts - 10) < 1.5, `avgAttempts ${mc.avgAttempts} too far from 10`);

  const mcAgain = monteCarloOdds(pool, matches, 5000, 42);
  assert.equal(mc.hitRate, mcAgain.hitRate);
  assert.equal(mc.avgAttempts, mcAgain.avgAttempts);
});

test('monteCarloOdds returns hitRate 1 and low avgAttempts when the whole pool matches', () => {
  const mc = monteCarloOdds(pool, pool, 500, 7);
  assert.equal(mc.hitRate, 1);
  assert.equal(mc.avgAttempts, 1);
});

test('monteCarloOdds returns hitRate 0 for a target with no matches, capped by the attempt safety valve', () => {
  const mc = monteCarloOdds(pool, [], 10, 1);
  assert.equal(mc.hitRate, 0);
  assert.equal(mc.avgAttempts, Infinity);
});
