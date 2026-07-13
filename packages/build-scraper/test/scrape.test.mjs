import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModifiers } from '../dist/index.js';

// The text -> Modifier[] engine that the tlicompendium mappers run over effect
// text and affix templates.

test('parseModifiers maps common effect phrasings to modifiers', () => {
  assert.deepEqual(parseModifiers('deals +32%~36% additional damage'), [
    { stat: 'moreDamage', op: 'more', value: 0.34 }
  ]);
  assert.deepEqual(parseModifiers('10.3% additional Cold Damage for the supported skill'), [
    { stat: 'moreDamage', op: 'more', value: 0.103 }
  ]);
  assert.deepEqual(parseModifiers('Adds 20 - 24 Fire Damage'), [
    { stat: 'addedFire', op: 'flat', value: 22 }
  ]);
  assert.deepEqual(parseModifiers('+24% Cold Resistance'), [
    { stat: 'coldResist', op: 'flat', value: 24 }
  ]);
  assert.deepEqual(parseModifiers('+25% Critical Strike Damage'), [
    { stat: 'critDamage', op: 'flat', value: 25 }
  ]);
  assert.deepEqual(parseModifiers('+330 Max Life'), [{ stat: 'life', op: 'flat', value: 330 }]);
});

test('parseModifiers dedupes effects repeated across summary + detail blocks', () => {
  const mods = parseModifiers('+5% additional damage\n... details ...\n+5% additional damage');
  assert.equal(mods.length, 1);
});

test('parseModifiers ignores unmodelled mechanics', () => {
  assert.deepEqual(parseModifiers('+1 Multistrike count; +13% Duration'), []);
});
