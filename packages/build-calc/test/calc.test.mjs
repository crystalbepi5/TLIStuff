import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDataset, indexDataset } from '@torchlight-companion/build-data';
import {
  aggregate,
  applyAggregate,
  computeDamage,
  computeDefense,
  evaluateBuild,
  MAX_PACT_SPIRITS
} from '../dist/index.js';

/** Minimal valid build with all modifier-source lists empty. */
function baseBuild(overrides = {}) {
  return {
    id: 'b',
    name: 'B',
    heroId: 'selina-tide-whisper',
    activeSkillId: 'dance-of-the-deep',
    supportIds: [],
    gear: [],
    talentIds: [],
    pactSpiritIds: [],
    memoryIds: [],
    extraModifiers: [],
    ...overrides
  };
}

test('aggregate sorts modifiers into flat / increased / more buckets', () => {
  const mods = [
    { stat: 'increasedFire', op: 'flat', value: 10 },
    { stat: 'increasedFire', op: 'increased', value: 30 },
    { stat: 'increasedFire', op: 'increased', value: 20 },
    { stat: 'increasedFire', op: 'more', value: 0.5 }
  ];
  const agg = aggregate(mods, 'increasedFire');
  assert.equal(agg.flat, 10);
  assert.equal(agg.increased, 50);
  assert.equal(agg.more, 1.5);
  // (base 100 + flat 10) * (1 + 0.5) * 1.5 = 247.5
  assert.equal(applyAggregate(100, agg), 247.5);
});

test('computeDamage: increased sums and more multiplies', () => {
  const skill = {
    id: 's',
    name: 'S',
    tags: ['spell'],
    baseDamage: { fire: 100 },
    baseRate: 1,
    baseCritRate: 0,
    supportSlots: 5
  };
  // 100 * (1 + 100/100) * (1 + 0.5) = 300 average hit, no crit, rate 1 -> dps 300
  const result = computeDamage(skill, [
    { stat: 'increasedDamage', op: 'increased', value: 100 },
    { stat: 'moreDamage', op: 'more', value: 0.5 }
  ]);
  assert.equal(result.averageHit, 300);
  assert.equal(result.critRate, 0);
  assert.equal(result.rate, 1);
  assert.equal(result.dps, 300);
});

test('computeDamage: crit factor and attack speed', () => {
  const skill = {
    id: 's',
    name: 'S',
    tags: ['attack'],
    baseDamage: { physical: 100 },
    baseRate: 2,
    baseCritRate: 100,
    supportSlots: 5
  };
  // crit 100%, crit multi 1.5 -> factor 1.5; attack speed +50% -> rate 3
  const result = computeDamage(skill, [
    { stat: 'increasedAttackSpeed', op: 'increased', value: 50 }
  ]);
  assert.equal(result.critRate, 100);
  assert.equal(result.critMultiplier, 1.5);
  assert.equal(result.rate, 3);
  // 100 * 1.5 (crit) * 3 (rate) = 450
  assert.equal(result.dps, 450);
});

test('computeDamage: increasedElemental applies to elements but not physical', () => {
  const skill = {
    id: 's',
    name: 'S',
    tags: ['spell'],
    baseDamage: { fire: 100, physical: 100 },
    baseRate: 1,
    baseCritRate: 0,
    supportSlots: 5
  };
  const result = computeDamage(skill, [
    { stat: 'increasedElemental', op: 'increased', value: 100 }
  ]);
  assert.equal(result.perElement.fire, 200);
  assert.equal(result.perElement.physical, 100);
  assert.equal(result.averageHit, 300);
});

test('computeDefense: resistances cap and health pool', () => {
  const def = computeDefense([
    { stat: 'life', op: 'flat', value: 1000 },
    { stat: 'increasedLife', op: 'increased', value: 20 },
    { stat: 'energyShield', op: 'flat', value: 500 },
    { stat: 'fireResist', op: 'flat', value: 90 },
    { stat: 'coldResist', op: 'flat', value: 50 }
  ]);
  assert.equal(def.life, 1200); // 1000 * 1.2
  assert.equal(def.energyShield, 500);
  assert.equal(def.healthPool, 1700);
  assert.equal(def.resists.fire, 75); // capped from 90
  assert.equal(def.resists.cold, 50);
});

test('evaluateBuild: Selina + Dance of the Deep produces positive dps, no fatal warnings', () => {
  const index = indexDataset(seedDataset);
  const build = baseBuild({
    name: 'Cold Selina',
    supportIds: ['elemental-boost', 'concentrated-effect', 'arcane-surge', 'deadly-aim'],
    gear: [
      { slot: 'weapon', baseId: 'tidecaller-staff', affixIds: ['of-frost'] },
      { slot: 'chest', baseId: 'silk-robe', affixIds: ['of-vitality', 'resolute'] }
    ],
    talentIds: ['selina-deep-current', 'generic-lethality'],
    pactSpiritIds: ['leviathan'],
    memoryIds: ['awakened-tide']
  });
  const report = evaluateBuild(build, index);
  assert.ok(report.damage.dps > 0, 'expected positive dps');
  assert.ok(report.defense.healthPool > 0, 'expected positive health pool');
  assert.deepEqual(report.warnings, []);
});

test('evaluateBuild: tag-mismatched support is dropped with a warning', () => {
  const index = indexDataset(seedDataset);
  const build = baseBuild({ supportIds: ['swift-strikes'] }); // requires 'attack', skill is spell
  const report = evaluateBuild(build, index);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /swift strikes/i);
});

test('evaluateBuild: talents, pact spirits and memories all raise dps', () => {
  const index = indexDataset(seedDataset);
  const bare = evaluateBuild(baseBuild(), index);
  const withProgression = evaluateBuild(
    baseBuild({
      talentIds: ['selina-undertow'], // +12% more
      pactSpiritIds: ['leviathan'], // +20% elemental
      memoryIds: ['awakened-ruin'] // +10% more
    }),
    index
  );
  assert.ok(withProgression.damage.dps > bare.damage.dps, 'progression should increase dps');
});

test("evaluateBuild: another hero's talent is ignored with a warning", () => {
  const index = indexDataset(seedDataset);
  // Gemma's talent on a Selina build.
  const report = evaluateBuild(baseBuild({ talentIds: ['gemma-molten-core'] }), index);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /another hero/i);
});

test('evaluateBuild: pact spirits beyond the cap are ignored with a warning', () => {
  const index = indexDataset(seedDataset);
  const tooMany = ['leviathan', 'emberwing', 'stoneguard', 'voltaic-sprite'];
  assert.ok(tooMany.length > MAX_PACT_SPIRITS);
  const report = evaluateBuild(baseBuild({ pactSpiritIds: tooMany }), index);
  assert.ok(
    report.warnings.some((w) => /pact spirits bound/i.test(w)),
    'expected a pact-spirit cap warning'
  );
});
