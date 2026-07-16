import test from 'node:test';
import assert from 'node:assert/strict';
import { pickAffixTier, craftableTiers, affixTierOdds, pickSkillLevel, availableLevels } from '../dist/index.js';

const lifeAffix = {
  id: 'max-life-prefix',
  name: 'Max Life',
  kind: 'prefix',
  modifiers: [{ stat: 'life', op: 'flat', value: 372 }], // top tier
  slots: ['boots'],
  tiers: [
    { tier: '0+', weight: 0, modifiers: [{ stat: 'life', op: 'flat', value: 372 }] },
    { tier: '1', weight: 100, modifiers: [{ stat: 'life', op: 'flat', value: 220 }] },
    { tier: '2', weight: 200, modifiers: [{ stat: 'life', op: 'flat', value: 154 }] }
  ]
};

test('pickAffixTier returns a specific tier\'s own modifiers', () => {
  assert.deepEqual(pickAffixTier(lifeAffix, '2'), [{ stat: 'life', op: 'flat', value: 154 }]);
});

test('pickAffixTier falls back to the top-tier modifiers when no tier is given or the tier is unknown', () => {
  assert.deepEqual(pickAffixTier(lifeAffix), lifeAffix.modifiers);
  assert.deepEqual(pickAffixTier(lifeAffix, 'nonexistent'), lifeAffix.modifiers);
});

test('pickAffixTier falls back gracefully for an affix with no tiers data at all', () => {
  const noTiers = { ...lifeAffix, tiers: undefined };
  assert.deepEqual(pickAffixTier(noTiers, '1'), noTiers.modifiers);
});

test('pickAffixTier disambiguates by modifierId when the same tier label appears more than once (real mapAffixes unions subtypes this way)', () => {
  const unioned = {
    ...lifeAffix,
    tiers: [
      { tier: '1', modifierId: 'boots-t1', weight: 100, modifiers: [{ stat: 'life', op: 'flat', value: 220 }] },
      { tier: '1', modifierId: 'gloves-t1', weight: 80, modifiers: [{ stat: 'life', op: 'flat', value: 180 }] }
    ]
  };
  // Bare tier label is ambiguous -- returns whichever comes first (documented, not ideal).
  assert.deepEqual(pickAffixTier(unioned, '1'), [{ stat: 'life', op: 'flat', value: 220 }]);
  // modifierId picks the exact row regardless of array order.
  assert.deepEqual(pickAffixTier(unioned, '1', 'gloves-t1'), [{ stat: 'life', op: 'flat', value: 180 }]);
  assert.deepEqual(pickAffixTier(unioned, '1', 'boots-t1'), [{ stat: 'life', op: 'flat', value: 220 }]);
});

test('pickAffixTier falls back to top-tier modifiers when modifierId is given but not found', () => {
  assert.deepEqual(pickAffixTier(lifeAffix, undefined, 'nonexistent'), lifeAffix.modifiers);
});

test('craftableTiers excludes weight-0 (disabled) tiers', () => {
  const craftable = craftableTiers(lifeAffix);
  assert.equal(craftable.length, 2);
  assert.ok(craftable.every((t) => t.weight > 0));
});

test('affixTierOdds computes each tier\'s share of total weight, excluding disabled tiers', () => {
  const odds = affixTierOdds(lifeAffix);
  assert.equal(odds.length, 2);
  const t1 = odds.find((o) => o.tier === '1');
  const t2 = odds.find((o) => o.tier === '2');
  assert.equal(t1.chance, 100 / 300);
  assert.equal(t2.chance, 200 / 300);
});

test('affixTierOdds returns [] for an affix with no craftable tiers', () => {
  assert.deepEqual(affixTierOdds({ ...lifeAffix, tiers: [] }), []);
});

const skillWithScaling = {
  id: 'leap-attack',
  name: 'Leap Attack',
  tags: ['attack'],
  baseDamage: { physical: 228 },
  baseRate: 1,
  baseCritRate: 5,
  supportSlots: 5,
  levelScaling: [
    { level: 1, modifiers: [{ stat: 'increasedDamage', op: 'increased', value: 10.5 }] },
    { level: 20, modifiers: [{ stat: 'increasedDamage', op: 'increased', value: 20 }] },
    { level: 40, modifiers: [{ stat: 'increasedDamage', op: 'increased', value: 30 }] }
  ]
};

test('pickSkillLevel returns the exact level entry when present', () => {
  assert.deepEqual(pickSkillLevel(skillWithScaling, 20), [{ stat: 'increasedDamage', op: 'increased', value: 20 }]);
});

test('pickSkillLevel clamps to the nearest available level (levelScaling is sparse)', () => {
  // 15 is closer to 20 than to 1
  assert.deepEqual(pickSkillLevel(skillWithScaling, 15), [{ stat: 'increasedDamage', op: 'increased', value: 20 }]);
  // 5 is closer to 1 than to 20
  assert.deepEqual(pickSkillLevel(skillWithScaling, 5), [{ stat: 'increasedDamage', op: 'increased', value: 10.5 }]);
});

test('pickSkillLevel falls back to modifiers for a support skill with no levelScaling', () => {
  const support = { id: 'x', name: 'X', modifiers: [{ stat: 'moreDamage', op: 'more', value: 0.2 }], requiresTags: [] };
  assert.deepEqual(pickSkillLevel(support, 20), support.modifiers);
  assert.deepEqual(pickSkillLevel(support), support.modifiers); // no level given -> same fallback
});

test('pickSkillLevel falls back to [] for an active skill with no levelScaling (its baseline is baseDamage, not a Modifier list)', () => {
  const active = { id: 'x', name: 'X', tags: [], baseDamage: { physical: 100 }, baseRate: 1, baseCritRate: 5, supportSlots: 5 };
  assert.deepEqual(pickSkillLevel(active, 20), []);
});

test('availableLevels lists every level a skill has scaling data for', () => {
  assert.deepEqual(availableLevels(skillWithScaling), [1, 20, 40]);
  assert.deepEqual(availableLevels({}), []);
});
