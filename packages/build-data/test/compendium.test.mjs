import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseCompendiumExport,
  isCompendiumExport,
  parseModifierLine,
  importBuildCode
} from '../dist/index.js';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/compendium-pharma.json', import.meta.url), 'utf-8')
);

/** Find the first modifier matching a stat (and optional op) in a list. */
function find(mods, stat, op) {
  return mods.find((m) => m.stat === stat && (op ? m.op === op : true));
}

test('parseModifierLine maps common affix text to modifiers', () => {
  assert.deepEqual(parseModifierLine('+32% Lightning Resistance'), [
    { stat: 'lightningResist', op: 'flat', value: 32 }
  ]);
  assert.deepEqual(parseModifierLine('+40% Spell Damage'), [
    { stat: 'increasedSpell', op: 'increased', value: 40 }
  ]);
  assert.deepEqual(parseModifierLine('Adds 84 - 113 Fire Damage to Spells'), [
    { stat: 'addedFire', op: 'flat', value: 98.5 }
  ]);
  assert.deepEqual(parseModifierLine('+30 % additional Spell Damage'), [
    { stat: 'increasedSpell', op: 'increased', value: 30 }
  ]);
  // "Spell Critical Strike Damage" must map to critDamage, NOT increasedSpell.
  assert.deepEqual(parseModifierLine('+109% Spell Critical Strike Damage'), [
    { stat: 'critDamage', op: 'flat', value: 109 }
  ]);
});

test('parseModifierLine ignores resistance penetration and unmodelled text', () => {
  assert.deepEqual(parseModifierLine('+19% Elemental and Erosion Resistance Penetration'), []);
  assert.deepEqual(parseModifierLine('+50% Movement Speed'), []);
  assert.deepEqual(parseModifierLine('+7% Sealed Mana Compensation'), []);
});

test('isCompendiumExport recognises the fixture', () => {
  assert.equal(isCompendiumExport(fixture), true);
  assert.equal(isCompendiumExport({ foo: 1 }), false);
});

test('parseCompendiumExport extracts gear + divinity stats from the real build', () => {
  const { build, warnings } = parseCompendiumExport(fixture);
  const mods = build.extraModifiers;

  assert.ok(mods.length > 10, `expected many modifiers, got ${mods.length}`);
  // Blank skill/hero — the export doesn't name them.
  assert.equal(build.activeSkillId, '');
  assert.equal(build.heroId, '');

  // Specific, verifiable stats from the fixture:
  assert.ok(find(mods, 'lightningResist', 'flat'), 'lightning resist from necklace');
  assert.ok(find(mods, 'fireResist', 'flat'), 'fire resist from boots');
  assert.ok(find(mods, 'increasedSpell', 'increased'), 'spell damage from wand + divinity');
  assert.ok(find(mods, 'increasedElemental', 'increased'), 'elemental damage from wand');
  assert.ok(find(mods, 'critDamage', 'flat'), 'crit damage from rings/wand');
  assert.ok(find(mods, 'addedFire', 'flat'), 'added fire from wand');
  assert.ok(find(mods, 'increasedProjectile', 'increased'), 'projectile damage from divinity');

  assert.match(warnings.join(' '), /opaque guids/i);
});

test('importBuildCode routes a pasted Compendium JSON string to the adapter', () => {
  const result = importBuildCode(JSON.stringify(fixture));
  assert.equal(result.ok, true);
  assert.equal(result.format, 'compendium');
  assert.ok(result.build.extraModifiers.length > 0);
});

test('parseCompendiumExport resolves hero-memories when given a data bundle', () => {
  // A minimal synthetic export + hero-memory dictionary (the guid->text bundle).
  const heroMemoryDict = {
    baseStats: { g1: { description: 'Max Life' } },
    fixedAffixes: { g2: { description: 'Cast Speed' } },
    randomAffixes: { g3: { description: 'Spell Damage' } }
  };
  const exp = {
    id: 'x',
    name: 'Synth',
    loadouts: {
      loadouts: [
        {
          hero: { heroId: 'Tester' },
          heroMemories: {
            equipped: { slot45: 'm1' },
            inventory: [
              {
                id: 'm1',
                baseStat: { guid: 'g1', value: 403, unit: null },
                fixedAffixes: [{ guid: 'g2', value: 30, unit: '%' }],
                randomAffixes: [{ guid: 'g3', value: 52, unit: '%' }]
              }
            ]
          },
          gear: { equipped: {}, inventory: [] },
          divinity: { inventory: [] }
        }
      ]
    }
  };

  const without = parseCompendiumExport(exp);
  assert.equal(without.build.extraModifiers.length, 0, 'no memories without the bundle');

  const withDict = parseCompendiumExport(exp, { heroMemoryDict });
  const mods = withDict.build.extraModifiers;
  assert.ok(mods.some((m) => m.stat === 'life' && m.value === 403), '+403 Max Life');
  assert.ok(mods.some((m) => m.stat === 'increasedCastSpeed' && m.value === 30), '+30% Cast Speed');
  assert.ok(mods.some((m) => m.stat === 'increasedSpell' && m.value === 52), '+52% Spell Damage');
  assert.match(withDict.warnings.join(' '), /hero-memories via the data bundle/i);
});
