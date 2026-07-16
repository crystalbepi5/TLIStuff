import test from 'node:test';
import assert from 'node:assert/strict';
import { totalManaCost } from '../dist/index.js';

const skill = { id: 'x', name: 'X', tags: [], baseDamage: {}, baseRate: 1, baseCritRate: 5, supportSlots: 3, manaCost: 10 };

test('totalManaCost with no supports is just the skill\'s own mana cost', () => {
  assert.equal(totalManaCost(skill, []), 10);
});

test('totalManaCost multiplies by each support\'s manaMultiplier in turn (130 -> x1.3)', () => {
  const support = { id: 's', name: 'S', modifiers: [], requiresTags: [], manaMultiplier: 130 };
  assert.equal(totalManaCost(skill, [support]), 13);
});

test('totalManaCost stacks multiple supports multiplicatively', () => {
  const a = { id: 'a', name: 'A', modifiers: [], requiresTags: [], manaMultiplier: 130 };
  const b = { id: 'b', name: 'B', modifiers: [], requiresTags: [], manaMultiplier: 150 };
  assert.equal(totalManaCost(skill, [a, b]), 10 * 1.3 * 1.5);
});

test('totalManaCost treats a support with no manaMultiplier as x1.0 (no change)', () => {
  const support = { id: 's', name: 'S', modifiers: [], requiresTags: [] };
  assert.equal(totalManaCost(skill, [support]), 10);
});

test('totalManaCost treats a skill with no manaCost as 0', () => {
  const noCostSkill = { ...skill, manaCost: undefined };
  assert.equal(totalManaCost(noCostSkill, []), 0);
});

test('totalManaCost ignores undefined entries (an unresolved support id)', () => {
  assert.equal(totalManaCost(skill, [undefined]), 10);
});
