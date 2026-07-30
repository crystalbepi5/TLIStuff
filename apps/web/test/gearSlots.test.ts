import test from 'node:test';
import assert from 'node:assert/strict';
import type { Build, GearPiece } from '@torchlight-companion/build-data';
import { SLOT_INSTANCES, gearAt, setGearAt } from '../src/planner/equipment/gearSlots.ts';

function baseBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: 'draft',
    name: 'New Build',
    heroId: 'hero-a',
    activeSkillId: 'skill-a',
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

function ring(baseId: string): GearPiece {
  return { slot: 'ring', baseId, affixIds: [] };
}

test('SLOT_INSTANCES has exactly one instance per slot except two rings', () => {
  const bySlot = new Map<string, number>();
  for (const s of SLOT_INSTANCES) bySlot.set(s.slot, (bySlot.get(s.slot) ?? 0) + 1);
  for (const [slot, count] of bySlot) {
    assert.equal(count, slot === 'ring' ? 2 : 1, `unexpected instance count for ${slot}`);
  }
});

test('gearAt returns undefined for an empty slot', () => {
  const build = baseBuild();
  assert.equal(gearAt(build, 'weapon', 0), undefined);
  assert.equal(gearAt(build, 'ring', 0), undefined);
  assert.equal(gearAt(build, 'ring', 1), undefined);
});

test('setGearAt fills a single-instance slot and gearAt reads it back', () => {
  const build = baseBuild();
  const patch = setGearAt(build, 'weapon', 0, { slot: 'weapon', baseId: 'sword', affixIds: [] });
  const next = { ...build, ...patch };
  assert.equal(gearAt(next, 'weapon', 0)?.baseId, 'sword');
});

test('setGearAt addresses the two ring instances independently', () => {
  let build = baseBuild();
  build = { ...build, ...setGearAt(build, 'ring', 0, ring('ring-a')) };
  build = { ...build, ...setGearAt(build, 'ring', 1, ring('ring-b')) };

  assert.equal(gearAt(build, 'ring', 0)?.baseId, 'ring-a');
  assert.equal(gearAt(build, 'ring', 1)?.baseId, 'ring-b');
  assert.equal(build.gear.filter((g) => g.slot === 'ring').length, 2);
});

test('setGearAt replacing ring 1 does not disturb ring 2', () => {
  let build = baseBuild();
  build = { ...build, ...setGearAt(build, 'ring', 0, ring('ring-a')) };
  build = { ...build, ...setGearAt(build, 'ring', 1, ring('ring-b')) };
  build = { ...build, ...setGearAt(build, 'ring', 0, ring('ring-a2')) };

  assert.equal(gearAt(build, 'ring', 0)?.baseId, 'ring-a2');
  assert.equal(gearAt(build, 'ring', 1)?.baseId, 'ring-b');
});

test('setGearAt(null) removes only the targeted ring instance', () => {
  let build = baseBuild();
  build = { ...build, ...setGearAt(build, 'ring', 0, ring('ring-a')) };
  build = { ...build, ...setGearAt(build, 'ring', 1, ring('ring-b')) };
  build = { ...build, ...setGearAt(build, 'ring', 0, null) };

  assert.equal(gearAt(build, 'ring', 0)?.baseId, 'ring-b'); // ring-b shifted down to fill index 0
  assert.equal(build.gear.filter((g) => g.slot === 'ring').length, 1);
});

test('setGearAt never touches gear in other slots', () => {
  let build = baseBuild({ gear: [{ slot: 'helmet', baseId: 'cap', affixIds: ['a1'] }] });
  build = { ...build, ...setGearAt(build, 'weapon', 0, { slot: 'weapon', baseId: 'sword', affixIds: [] }) };

  assert.equal(gearAt(build, 'helmet', 0)?.baseId, 'cap');
  assert.deepEqual(gearAt(build, 'helmet', 0)?.affixIds, ['a1']);
});
