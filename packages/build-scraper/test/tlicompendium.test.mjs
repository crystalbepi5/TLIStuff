import test from 'node:test';
import assert from 'node:assert/strict';
import { leaves, mapGear, mapLegendaries, mapHeroTraits } from '../dist/index.js';

// Small inline fixtures shaped like real tlicompendium bundles (which are
// deeply-nested maps of uuid -> entry). No network, no giant fixtures.

test('leaves recursively yields entries carrying a name, skipping wrappers', () => {
  const bundle = {
    'gear/boots/x/i18n/en': {
      sub: { 'uuid-1': { name: 'A' }, 'uuid-2': { name: 'B' } }
    }
  };
  assert.deepEqual([...leaves(bundle)].map((e) => e.name), ['A', 'B']);
});

test('mapGear maps slotType + implicit rawText to a GearBase', () => {
  const bundle = {
    'gear/boots/str/i18n/en': {
      s: {
        u1: {
          name: 'Iron Greaves',
          slotType: 'Feet',
          requiredLevel: '10',
          implicits: [{ rawText: '+329 gear Armor' }]
        }
      }
    }
  };
  const gear = mapGear(bundle);
  assert.equal(gear.length, 1);
  assert.deepEqual(gear[0], {
    id: 'iron-greaves',
    name: 'Iron Greaves',
    slot: 'boots',
    implicit: [{ stat: 'armor', op: 'flat', value: 329 }]
  });
});

test('mapGear skips entries with unknown/empty slot types', () => {
  const bundle = { k: { s: { u: { name: 'Mystery', slotType: '', implicits: [] } } } };
  assert.deepEqual(mapGear(bundle), []);
});

test('mapLegendaries infers slot from name and parses normalRawText', () => {
  const bundle = {
    k: {
      s: {
        u: {
          name: 'Frostroot Greaves',
          mods: [{ normalRawText: '+40 Max Life' }, { normalRawText: '+24% Cold Resistance' }]
        }
      }
    }
  };
  const legs = mapLegendaries(bundle);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].slot, 'boots'); // inferred from "Greaves"
  // order follows rule order (resistance rule precedes the life rule)
  assert.deepEqual(legs[0].implicit, [
    { stat: 'coldResist', op: 'flat', value: 24 },
    { stat: 'life', op: 'flat', value: 40 }
  ]);
});

test('mapHeroTraits uses the highest tier and strips HTML markup', () => {
  const bundle = {
    k: {
      s: {
        u: {
          name: 'Fury',
          tiers: [
            { level: 1, description: '<span class="text-mod">10</span>% additional damage' },
            { level: 5, description: '<span class="text-mod">78</span>% additional damage' }
          ]
        }
      }
    }
  };
  const talents = mapHeroTraits(bundle);
  assert.equal(talents.length, 1);
  assert.equal(talents[0].heroId, 'any');
  assert.deepEqual(talents[0].modifiers, [{ stat: 'moreDamage', op: 'more', value: 0.78 }]);
});
