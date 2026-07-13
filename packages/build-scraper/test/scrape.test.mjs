import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSkill, mapActiveSkill, extractSlugs, parseModifiers } from '../dist/index.js';

// Offline tests against saved tlidb fixtures — no network. The live scrape is
// exercised separately (scrapeActiveSkills), which hits tlidb.com.

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parseSkill extracts a spell skill (Flame Jet) from a real tlidb page', () => {
  const p = parseSkill('Flame_Jet', fixture('Flame_Jet.html'));
  assert.ok(p, 'expected a parse result');
  assert.equal(p.name, 'Flame Jet');
  assert.deepEqual(p.elements, ['fire']);
  assert.ok(p.tags.includes('spell') && p.tags.includes('area'));
  assert.ok(p.damageRange, 'expected a spell damage range');
  assert.ok(p.castSeconds && p.castSeconds > 0);
});

test('mapActiveSkill produces a valid ActiveSkill with mid-range base damage', () => {
  const skill = mapActiveSkill(parseSkill('Flame_Jet', fixture('Flame_Jet.html')));
  assert.equal(skill.id, 'flame-jet');
  assert.equal(skill.name, 'Flame Jet');
  assert.ok(skill.baseDamage.fire && skill.baseDamage.fire > 0, 'expected fire base damage');
  assert.ok(skill.baseRate > 0);
  assert.ok(Array.isArray(skill.tags));
});

test('parseModifiers maps common tlidb effect phrasings to modifiers', () => {
  // "additional damage" (generic) and element-specific "additional X damage" -> more
  assert.deepEqual(parseModifiers('deals +32%~36% additional damage'), [
    { stat: 'moreDamage', op: 'more', value: 0.34 }
  ]);
  assert.deepEqual(parseModifiers('10.3% additional Cold Damage for the supported skill'), [
    { stat: 'moreDamage', op: 'more', value: 0.103 }
  ]);
  // added flat element damage, resistances, crit
  assert.deepEqual(parseModifiers('Adds 20 - 24 Fire Damage'), [
    { stat: 'addedFire', op: 'flat', value: 22 }
  ]);
  assert.deepEqual(parseModifiers('+24% Cold Resistance'), [
    { stat: 'coldResist', op: 'flat', value: 24 }
  ]);
  assert.deepEqual(parseModifiers('+25% Critical Strike Damage'), [
    { stat: 'critDamage', op: 'flat', value: 25 }
  ]);
});

test('parseModifiers dedupes effects repeated in Simple + Details blocks', () => {
  const mods = parseModifiers('+5% additional damage\n... details ...\n+5% additional damage');
  assert.equal(mods.length, 1);
});

test('parseModifiers ignores unmodelled mechanics', () => {
  // multistrike count, duration, conversion — no calc stat, so no modifier
  assert.deepEqual(parseModifiers('+1 Multistrike count; +13% Duration'), []);
});

test('extractSlugs pulls entity slugs from a category page, filtered by the index', () => {
  const allowed = new Set(['Flame_Jet', 'Aimed_Shot', 'Blizzard']);
  const slugs = extractSlugs(fixture('Active_Skill.html'), allowed);
  // Only allowed slugs survive; season/nav links are dropped.
  assert.ok(slugs.includes('Aimed_Shot'));
  assert.ok(slugs.every((s) => allowed.has(s)));
});
