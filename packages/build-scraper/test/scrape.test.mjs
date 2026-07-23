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

test('parseModifiers does not read "Critical Strike Damage Mitigation" (defensive) as the player\'s own crit damage', () => {
  assert.deepEqual(parseModifiers('100% Critical Strike Damage Mitigation'), []);
  // the real offensive stat still works
  assert.deepEqual(parseModifiers('+25% Critical Strike Damage'), [{ stat: 'critDamage', op: 'flat', value: 25 }]);
});

test('parseModifiers does not read "additional Damage ... taken" (defensive mitigation) as outgoing moreDamage', () => {
  // Real Vorax affix text seen this session -- was silently producing a
  // backwards-signed player damage penalty instead of being left unmodelled.
  assert.deepEqual(
    parseModifiers('-50% additional Damage Over Time taken when having at least 50000 Armor'),
    []
  );
  assert.deepEqual(parseModifiers('additional Damage taken reduced by 10%'), []);
  // plain outgoing "additional damage" still works
  assert.deepEqual(parseModifiers('deals +32%~36% additional damage'), [
    { stat: 'moreDamage', op: 'more', value: 0.34 }
  ]);
});

test('parseModifiers still reads "additional damage taken by ... enemies" as outgoing (offensive, not mitigation)', () => {
  // Real gear affix text: "taken" here means damage *enemies* take from you,
  // not damage you take -- excluding all "taken" phrasing dropped this real,
  // modelled affix entirely (mapAffixes filters out zero-modifier affixes).
  assert.deepEqual(parseModifiers('+15% additional damage taken by Nearby enemies'), [
    { stat: 'moreDamage', op: 'more', value: 0.15 }
  ]);
  // defensive "taken" (no "by ... enemies") still excluded
  assert.deepEqual(
    parseModifiers('-50% additional Damage Over Time taken when having at least 50000 Armor'),
    []
  );
});

test('parseModifiers tags "Adds ... Damage to Spells/Attacks" instead of applying it everywhere', () => {
  assert.deepEqual(parseModifiers('Adds 20-24 Cold Damage to Spells'), [
    { stat: 'addedCold', op: 'flat', value: 22, tags: ['spell'] }
  ]);
  assert.deepEqual(parseModifiers('Adds 5-9 Fire Damage to Attacks'), [
    { stat: 'addedFire', op: 'flat', value: 7, tags: ['attack'] }
  ]);
  // no qualifier -> untagged, applies everywhere (unchanged behaviour)
  assert.deepEqual(parseModifiers('Adds 20-24 Cold Damage'), [{ stat: 'addedCold', op: 'flat', value: 22 }]);
});

test('parseModifiers tags both "Attacks" and "Spells" when the real combined qualifier "to Attacks and Spells" is used', () => {
  // Real affix text (current seed): "Adds - Fire Damage to Attacks and
  // Spells" -- matching only the first name would wrongly tag it
  // 'attack'-only, hiding it from spell skills the text says it applies to.
  // Tag order isn't semantically meaningful (tagsAllow matches via .some()),
  // so compare sorted.
  const withBoth = (text) => {
    const mods = parseModifiers(text);
    return mods.map((m) => ({ ...m, tags: m.tags && [...m.tags].sort() }));
  };
  assert.deepEqual(withBoth('Adds 10-14 Fire Damage to Attacks and Spells'), [
    { stat: 'addedFire', op: 'flat', value: 12, tags: ['attack', 'spell'] }
  ]);
  assert.deepEqual(withBoth('Adds 10-14 Fire Damage to Spells and Attacks'), [
    { stat: 'addedFire', op: 'flat', value: 12, tags: ['attack', 'spell'] }
  ]);
});

test('parseModifiers splits a shared Attack/Cast/Movement Speed list into per-stat modifiers', () => {
  assert.deepEqual(
    parseModifiers('+18% Attack Speed, Cast Speed, and Movement Speed'),
    [
      { stat: 'increasedAttackSpeed', op: 'increased', value: 18 },
      { stat: 'increasedCastSpeed', op: 'increased', value: 18 }
    ]
  );
  // movement speed alone isn't modelled -- no StatKey for it
  assert.deepEqual(parseModifiers('+18% Movement Speed'), []);
  // a lone single speed type still works as before
  assert.deepEqual(parseModifiers('+12% Cast Speed'), [{ stat: 'increasedCastSpeed', op: 'increased', value: 12 }]);
});

test('parseModifiers does not credit minion-only damage as player increasedDamage', () => {
  // Real text pattern seen this session: a generic lowercase "damage" token
  // immediately preceding the capitalised "Minion Damage" qualifier.
  assert.deepEqual(parseModifiers('183% damage Minion Damage'), []);
  // plain unqualified "+90% damage" still works
  assert.deepEqual(parseModifiers('+90% damage'), [{ stat: 'increasedDamage', op: 'increased', value: 90 }]);
});
