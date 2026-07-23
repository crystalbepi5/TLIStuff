import test from 'node:test';
import assert from 'node:assert/strict';
import { marginalGearAnalysis } from '../dist/index.js';

const skill = {
  id: 'jab',
  name: 'Jab',
  tags: ['attack'],
  baseDamage: { physical: 100 },
  baseRate: 1,
  baseCritRate: 5,
  supportSlots: 5
};

const bootsBase = { id: 'boots-base', name: 'Boots Base', slot: 'boots', implicit: [] };

function fakeIndex(affixesById) {
  return {
    hero: () => ({ id: 'h', name: 'H', baseModifiers: [] }),
    activeSkill: () => skill,
    supportSkill: () => undefined,
    gearBase: () => bootsBase,
    affix: (id) => affixesById.get(id),
    talent: () => undefined,
    pactSpirit: () => undefined,
    memory: () => undefined,
    voraxAffix: () => undefined,
    voraxLegendary: () => undefined,
    talentTreeNode: () => undefined,
    voidChartNode: () => undefined
  };
}

function baseBuild(overrides = {}) {
  return {
    id: 'b',
    name: 'B',
    heroId: 'h',
    activeSkillId: 'jab',
    supportIds: [],
    gear: [],
    voraxGear: [],
    talentIds: [],
    talentTreeNodeIds: [],
    voidChartNodeIds: [],
    pactSpiritIds: [],
    memoryIds: [],
    extraModifiers: [],
    ...overrides
  };
}

const weakLife = { id: 'weak-life', name: 'Weak Life', kind: 'prefix', modifiers: [{ stat: 'life', op: 'flat', value: 50 }], slots: ['boots'] };
const strongDamage = {
  id: 'strong-damage',
  name: 'Strong Damage',
  kind: 'suffix',
  modifiers: [{ stat: 'increasedDamage', op: 'increased', value: 50 }],
  slots: ['boots']
};
const otherSlotOnly = { id: 'ring-only', name: 'Ring Only', kind: 'prefix', modifiers: [{ stat: 'life', op: 'flat', value: 999 }], slots: ['ring'] };

test('marginalGearAnalysis suggests swapping to a strictly better affix, ranked by DPS gain', () => {
  const affixesById = new Map([
    ['weak-life', weakLife],
    ['strong-damage', strongDamage],
    ['ring-only', otherSlotOnly]
  ]);
  const index = fakeIndex(affixesById);
  const build = baseBuild({ gear: [{ slot: 'boots', baseId: 'boots-base', affixIds: ['weak-life'] }] });
  const pool = [weakLife, strongDamage, otherSlotOnly];

  const suggestions = marginalGearAnalysis(build, index, pool);
  assert.equal(suggestions.length, 1); // ring-only isn't a candidate (wrong slot)
  const [top] = suggestions;
  assert.equal(top.slot, 'boots');
  assert.equal(top.fromAffixId, 'weak-life');
  assert.equal(top.toAffixId, 'strong-damage');
  assert.ok(top.gain > 0);
  assert.ok(top.dps > 100); // base skill damage is 100/hit at rate 1
});

test('marginalGearAnalysis returns [] when no candidate swap improves DPS', () => {
  const affixesById = new Map([['weak-life', weakLife]]);
  const index = fakeIndex(affixesById);
  // Only one candidate valid for the slot, and it's already equipped -- no swap possible.
  const build = baseBuild({ gear: [{ slot: 'boots', baseId: 'boots-base', affixIds: ['weak-life'] }] });
  assert.deepEqual(marginalGearAnalysis(build, index, [weakLife]), []);
});

test('marginalGearAnalysis never mutates the input build', () => {
  const affixesById = new Map([
    ['weak-life', weakLife],
    ['strong-damage', strongDamage]
  ]);
  const index = fakeIndex(affixesById);
  const build = baseBuild({ gear: [{ slot: 'boots', baseId: 'boots-base', affixIds: ['weak-life'] }] });
  const before = JSON.parse(JSON.stringify(build));
  marginalGearAnalysis(build, index, [weakLife, strongDamage]);
  assert.deepEqual(build, before);
});

test('marginalGearAnalysis respects the limit and sorts by descending gain', () => {
  const rungs = ['t1', 't2', 't3'].map((id, i) => ({
    id,
    name: id,
    kind: 'suffix',
    modifiers: [{ stat: 'increasedDamage', op: 'increased', value: (i + 1) * 10 }],
    slots: ['boots']
  }));
  const affixesById = new Map(rungs.map((a) => [a.id, a]));
  const index = fakeIndex(affixesById);
  const build = baseBuild({ gear: [{ slot: 'boots', baseId: 'boots-base', affixIds: ['t1'] }] });

  const suggestions = marginalGearAnalysis(build, index, rungs, 1);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].toAffixId, 't3'); // biggest gain
});
