import test from 'node:test';
import assert from 'node:assert/strict';
import {
  leaves,
  mapGear,
  mapGearFromMaster,
  mapAffixes,
  mapLegendaries,
  mapHeroTraits,
  mapSkills,
  buildLevelScaling,
  mapVoidChart,
  mapTalentTrees,
  mapPactSpirits,
  mapHeroMemory,
  mapVorax
} from '../dist/index.js';

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

test('mapAffixes extracts craft prefix/suffix with value range + modifier ids', () => {
  const gearMaster = {
    'gear/boots/str_boots/master': {
      category: 'boots',
      craftPrefix: [
        {
          descriptionTemplate: '+# Max Life',
          tiers: [
            { tier: '0+', modifierId: '104510080', levelRequirement: 100, weight: 0, values: [{ minValue: 330, maxValue: 372 }] },
            { tier: '1', modifierId: '104510000', levelRequirement: 86, weight: 100, values: [{ minValue: 200, maxValue: 250 }] }
          ]
        }
      ],
      craftSuffix: [
        { descriptionTemplate: '+#% Fire Resistance', tiers: [{ tier: '0', modifierId: '999', weight: 50, values: [{ maxValue: 46 }] }] }
      ]
    }
  };
  const affixes = mapAffixes(gearMaster);
  const life = affixes.find((a) => a.name === 'Max Life');
  assert.ok(life);
  assert.equal(life.kind, 'prefix');
  assert.deepEqual(life.modifiers, [{ stat: 'life', op: 'flat', value: 372 }]); // top tier, max roll
  assert.deepEqual(life.slots, ['boots']);
  assert.deepEqual(life.modifierIds, ['104510080', '104510000']); // all tiers, for loot cross-ref
  const fire = affixes.find((a) => a.name === 'Fire Resistance');
  assert.deepEqual(fire.modifiers, [{ stat: 'fireResist', op: 'flat', value: 46 }]);

  // Every tier is preserved with its own real weight + own parsed modifiers
  // (not just the top tier), for a crafting-odds simulator.
  assert.equal(life.tiers.length, 2);
  const [t0plus, t1] = life.tiers;
  assert.equal(t0plus.tier, '0+');
  assert.equal(t0plus.weight, 0); // disabled tier -- kept, not silently dropped
  assert.equal(t0plus.levelRequirement, 100);
  assert.deepEqual(t0plus.modifiers, [{ stat: 'life', op: 'flat', value: 372 }]);
  assert.equal(t1.tier, '1');
  assert.equal(t1.weight, 100);
  assert.deepEqual(t1.modifiers, [{ stat: 'life', op: 'flat', value: 250 }]); // its own range, not the top tier's
});

test('mapAffixes unions tiers (by modifierId) for the same affix across gear subtypes', () => {
  const gearMaster = {
    'gear/boots/str_boots/master': {
      category: 'boots',
      craftPrefix: [
        { descriptionTemplate: '+# Max Life', tiers: [{ tier: '0', modifierId: 'A', weight: 100, values: [{ maxValue: 300 }] }] }
      ]
    },
    'gear/boots/dex_boots/master': {
      category: 'boots',
      craftPrefix: [
        {
          descriptionTemplate: '+# Max Life',
          tiers: [
            { tier: '0', modifierId: 'A', weight: 100, values: [{ maxValue: 300 }] }, // duplicate id -> not double-counted
            { tier: '1', modifierId: 'B', weight: 50, values: [{ maxValue: 200 }] }
          ]
        }
      ]
    }
  };
  const affixes = mapAffixes(gearMaster);
  const life = affixes.find((a) => a.name === 'Max Life');
  assert.equal(life.tiers.length, 2);
  assert.deepEqual(life.tiers.map((t) => t.modifierId).sort(), ['A', 'B']);
});

test('mapGearFromMaster joins tlidbId (master) with name + mods (en)', () => {
  const gearMaster = {
    'gear/boots/str/master': { category: 'boots', baseItems: [{ id: 'u1', tlidbId: '4000' }] }
  };
  const gearEn = {
    'gear/boots/str/i18n/en': {
      u1: { name: 'Iron Boots', slotType: 'Feet', implicits: [{ modifierId: '1', rawText: '+329 gear Armor' }] }
    }
  };
  const gear = mapGearFromMaster(gearMaster, gearEn);
  assert.equal(gear.length, 1);
  assert.deepEqual(gear[0], {
    id: 'iron-boots',
    name: 'Iron Boots',
    slot: 'boots',
    implicit: [{ stat: 'armor', op: 'flat', value: 329 }],
    tlidbId: '4000'
  });
});

test('mapSkills joins -master structure with -en names (active + support)', () => {
  const master = {
    'skill/Active/master': {
      category: 'Active',
      skills: [{ id: 'u1', tags: ['Cold', 'Spell', 'Area'], castSpeed: '0.5 s' }]
    },
    'skill/Support/master': {
      category: 'Support',
      skills: [{ id: 'u2', tags: ['Support'] }]
    }
  };
  const en = {
    'skill/Active/i18n/en': { u1: { name: 'Frost Nova', description: 'Deals 200-300 Cold Damage' } },
    'skill/Support/i18n/en': { u2: { name: 'More Damage', description: '+20% additional damage' } }
  };
  const { active, support } = mapSkills(master, en);
  assert.equal(active.length, 1);
  assert.equal(active[0].name, 'Frost Nova');
  assert.deepEqual(active[0].tags, ['spell', 'area']); // "Cold" is element, not a tag
  assert.deepEqual(active[0].baseDamage, { cold: 250 }); // mid of 200-300
  assert.equal(active[0].baseRate, 2); // 1 / 0.5s
  assert.equal(support.length, 1);
  assert.deepEqual(support[0].modifiers, [{ stat: 'moreDamage', op: 'more', value: 0.2 }]);
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

// ------------------------- buildLevelScaling ---------------------------------
// Fixtures shaped like real levelProgression/templateDescription/description
// found live on tlicompendium.com (see the function's own docs for why the
// algorithm works the way it does).

test('buildLevelScaling disambiguates a tie (two slots equal at the reference level) using position order once an earlier unique slot is consumed', () => {
  // Modeled on Leap Attack: value3 is constant at 20 across every level, and
  // value5 also happens to equal 20 at the reference level (20) -- a genuine
  // tie. The template still has a "#" for all three slots in this order:
  // value1 (228, unique -> consumed first), value3 ("up to # times"), value5
  // ("+#% damage per bonus"). Because extraction and matching both proceed
  // left-to-right, value1 being unmistakable lets value3 get correctly
  // consumed by the *second* placeholder, leaving value5 -- not value3 -- for
  // the third, even though value3 and value5 are numerically tied at level 20.
  const levelProgression = [
    { level: 1, value1: 130, value3: 20, value5: 10.5 },
    { level: 20, value1: 228, value3: 20, value5: 20 },
    { level: 40, value1: 228, value3: 20, value5: 30 }
  ];
  const templateDescription = 'Deals #% Weapon Attack Damage. Up to # time(s). +#% damage per bonus gained';
  const description = 'Deals 228% Weapon Attack Damage. Up to 20 time(s). +20% damage per bonus gained';
  const result = buildLevelScaling(levelProgression, templateDescription, description, '228%');
  assert.ok(result);
  assert.equal(result.length, 3);
  // Only value5's contribution is a recognised Modifier pattern; value1/value3
  // feed literal tooltip numbers ("Deals X%", "up to N times") that
  // parseModifiers doesn't treat as stat modifiers, same as the skill's own
  // baseDamage being tracked separately rather than as a Modifier.
  assert.deepEqual(
    result.map((r) => r.modifiers),
    [
      [{ stat: 'increasedDamage', op: 'increased', value: 10.5 }],
      [{ stat: 'increasedDamage', op: 'increased', value: 20 }],
      [{ stat: 'increasedDamage', op: 'increased', value: 30 }]
    ]
  );
});

test('buildLevelScaling handles the "N/D" fraction quirk and falls back to searching every row when there is no effectivenessOfAddedDamage hint (supports don\'t have that field)', () => {
  // Modeled on Multiple Projectiles: description snapshots at level 1 (not
  // the last level), and value1 at level 1 is literally the string "37/5".
  const levelProgression = [
    { level: 1, value1: '37/5' }, // 37/5 = 7.4
    { level: 2, value1: 7.8 },
    { level: 3, value1: 8.2 }
  ];
  const templateDescription = '#% additional damage for the supported skill';
  const description = '7.4% additional damage for the supported skill';
  const result = buildLevelScaling(levelProgression, templateDescription, description, undefined);
  assert.ok(result);
  assert.deepEqual(result[0].modifiers, [{ stat: 'moreDamage', op: 'more', value: 0.074 }]);
  assert.deepEqual(result[1].modifiers, [{ stat: 'moreDamage', op: 'more', value: 0.078 }]);
});

test('buildLevelScaling supports valueNMin/valueNMax pairs (range-damage spells)', () => {
  const levelProgression = [{ level: 1, value1Min: 592, value1Max: 1100 }];
  const templateDescription = 'Deals #-# Spell Damage';
  const description = 'Deals 592-1100 Spell Damage';
  const result = buildLevelScaling(levelProgression, templateDescription, description, undefined);
  assert.ok(result); // resolves (even though this particular text isn't itself a Modifier pattern)
  assert.equal(result.length, 1);
});

test('buildLevelScaling bails (returns undefined) rather than guess when the template is missing a placeholder the description actually varies by', () => {
  // Modeled on Ice Shot: description has a second "Explosion: Deals N%..."
  // line with no corresponding "#" anywhere in the template, so the literal
  // segments can never line up -- must not silently mis-map.
  const levelProgression = [{ level: 1, value1: 214, value2: 107 }];
  const templateDescription = 'Deals #% Weapon Attack Damage. Explosion: Converts 100% to Cold.';
  const description = 'Deals 313% Weapon Attack Damage. Explosion: Deals 157% Weapon Attack Damage. Converts 100% to Cold.';
  assert.equal(buildLevelScaling(levelProgression, templateDescription, description, '313%'), undefined);
});

test('buildLevelScaling returns undefined for skills with no levelProgression or no placeholders', () => {
  assert.equal(buildLevelScaling([], 'x', 'x', undefined), undefined);
  assert.equal(buildLevelScaling(undefined, 'x', 'x', undefined), undefined);
  // No "#" at all -> level-invariant text, nothing to add.
  assert.equal(
    buildLevelScaling([{ level: 1, value1: 5 }], 'Fixed text, no scaling', 'Fixed text, no scaling', undefined),
    undefined
  );
});

// ------------------------------ mapVoidChart ---------------------------------

test('mapVoidChart maps each sub-tree\'s nodes with real connections + position, best-effort parsing effect text', () => {
  const bundle = {
    'voidchart/war/en': {
      id: 'god-of-war',
      name: 'God of War',
      nodes: [
        {
          id: 'n1',
          tlidbId: 't1',
          type: 'minor',
          name: 'Vigor',
          description: 'Grants extra life',
          icon: 'icon.png',
          position: { x: 10, y: 20 },
          connections: ['n2'],
          effects: [{ displayString: '+50 Max Life' }]
        },
        { id: 'n2', connections: [], effects: [] }
      ]
    }
  };
  const trees = mapVoidChart(bundle);
  assert.equal(trees.length, 1);
  assert.equal(trees[0].id, 'god-of-war');
  assert.equal(trees[0].name, 'God of War');
  assert.equal(trees[0].nodes.length, 2);
  assert.deepEqual(trees[0].nodes[0], {
    id: 'n1',
    tlidbId: 't1',
    type: 'minor',
    name: 'Vigor',
    description: 'Grants extra life',
    icon: 'icon.png',
    connections: ['n2'],
    position: { x: 10, y: 20 },
    modifiers: [{ stat: 'life', op: 'flat', value: 50 }]
  });
  assert.deepEqual(trees[0].nodes[1], { id: 'n2', connections: [], modifiers: [] });
});

test('mapVoidChart skips entries with no nodes array', () => {
  assert.deepEqual(mapVoidChart({ k: { id: 'x' } }), []);
});

// ------------------------------ mapTalentTrees -------------------------------

test('mapTalentTrees normalises ancestor + predecessors into a shared connections adjacency list', () => {
  const bundle = {
    'talent-tree/warrior/master': {
      tree: {
        id: 'warrior',
        tlidbId: 'Warrior',
        icon: 'warrior.png',
        nodes: [
          {
            id: 'root',
            type: 'keystone',
            maxPoints: 1,
            svgPosition: { cx: 100, cy: 200 },
            ancestor: null,
            predecessors: [],
            mods: [{ description: '+20% additional damage' }]
          },
          {
            id: 'child',
            ancestor: 'root',
            predecessors: [{ guid: 'root' }, { guid: 'other' }],
            mods: []
          }
        ]
      }
    }
  };
  const trees = mapTalentTrees(bundle);
  assert.equal(trees.length, 1);
  assert.equal(trees[0].id, 'warrior');
  assert.equal(trees[0].name, 'Warrior');
  assert.equal(trees[0].icon, 'warrior.png');
  assert.deepEqual(trees[0].nodes[0], {
    id: 'root',
    type: 'keystone',
    connections: [],
    maxPoints: 1,
    position: { x: 100, y: 200 },
    modifiers: [{ stat: 'moreDamage', op: 'more', value: 0.2 }]
  });
  // ancestor + predecessors merged into one adjacency list (root de-duped by caller if needed)
  assert.deepEqual(trees[0].nodes[1].connections, ['root', 'root', 'other']);
});

test('mapTalentTrees skips entries with no tree.nodes', () => {
  assert.deepEqual(mapTalentTrees({ k: {} }), []);
  assert.deepEqual(mapTalentTrees({ k: { tree: {} } }), []);
});

// ------------------------------ mapPactSpirits -------------------------------

test('mapPactSpirits joins master (mechanics) + en (name/description) by shared id, flattening node effects into modifiers', () => {
  const master = {
    'pactspirit/master': {
      types: [{ id: 'type-1', code: 'combat' }],
      pactspirits: [
        {
          id: 'ps-1',
          typeId: 'type-1',
          rarity: 'legendary',
          iconUrl: 'ps1.png',
          nodes: [
            { nodeId: 1, nodeType: 'start', nextNode: 2, effects: [{ sign: '+', value: 30, unit: '%', text: 'increased damage' }] },
            { nodeId: 2, nodeType: 'end', nextNode: null, effects: [] }
          ]
        }
      ]
    }
  };
  const en = {
    'pactspirit/i18n/en': {
      pactspirits: { 'ps-1': { name: 'Ember Wisp', description: 'A fiery companion' } }
    }
  };
  const spirits = mapPactSpirits(master, en);
  assert.equal(spirits.length, 1);
  assert.deepEqual(spirits[0], {
    id: 'ps-1',
    name: 'Ember Wisp',
    description: 'A fiery companion',
    modifiers: [],
    nodes: [
      { nodeId: 1, nodeType: 'start', nextNode: 2, modifiers: [] },
      { nodeId: 2, nodeType: 'end', nextNode: null, modifiers: [] }
    ],
    typeCode: 'combat',
    rarity: 'legendary',
    iconUrl: 'ps1.png'
  });
});

test('mapPactSpirits falls back to the raw id as name when no en entry exists', () => {
  const master = { k: { pactspirits: [{ id: 'ps-2', nodes: [] }] } };
  const spirits = mapPactSpirits(master, {});
  assert.equal(spirits[0].name, 'ps-2');
  assert.deepEqual(spirits[0].modifiers, []);
});

// ------------------------------ mapHeroMemory --------------------------------

test('mapHeroMemory fills each tiered pool\'s -en template with the tier\'s own value(s) and maps lunar-phase memories', () => {
  const master = {
    'hero-memory/master': {
      baseStats: [
        {
          id: 'ms-1',
          modifierId: 'mod-1',
          tiers: [{ tier: 1, weight: 100, level: 1, value: 42 }]
        }
      ],
      revivedAffixLunarPhases: [{ id: 'lp-1', name: 'Full Moon', description: '+10% additional damage' }]
    }
  };
  const en = {
    'hero-memory/i18n/en': {
      baseStats: { 'ms-1': { template: '+#% Critical Strike Damage' } }
    }
  };
  const { pools, revivedMemories } = mapHeroMemory(master, en);
  assert.equal(pools.baseStats.length, 1);
  assert.deepEqual(pools.baseStats[0].tiers[0].modifiers, [{ stat: 'critDamage', op: 'flat', value: 42 }]);
  assert.deepEqual(pools.baseStats[0].modifierIds, ['mod-1']);
  assert.equal(pools.fixedAffixes.length, 0);
  assert.equal(revivedMemories.length, 1);
  assert.deepEqual(revivedMemories[0], {
    id: 'lp-1',
    name: 'Full Moon',
    description: '+10% additional damage',
    modifiers: [{ stat: 'moreDamage', op: 'more', value: 0.1 }]
  });
});

test('mapHeroMemory handles a compound tier (nested values[]) filling multiple template placeholders', () => {
  const master = {
    k: {
      randomAffixes: [
        { id: 'ra-1', tiers: [{ tier: 1, weight: 50, values: [{ valueMax: 12 }, { valueMax: 8 }] }] }
      ]
    }
  };
  const en = { k: { randomAffixes: { 'ra-1': { template: '+#% Fire Resistance and +#% Cold Resistance' } } } };
  const { pools } = mapHeroMemory(master, en);
  assert.deepEqual(pools.randomAffixes[0].tiers[0].modifiers, [
    { stat: 'fireResist', op: 'flat', value: 12 },
    { stat: 'coldResist', op: 'flat', value: 8 }
  ]);
});

// --------------------------------- mapVorax ----------------------------------

test('mapVorax joins master craftAffixes/legendaries (plain arrays keyed by their own id) with en tiers/mods by that id', () => {
  const master = {
    'vorax/master': {
      craftAffixes: [
        {
          id: 'affix-1',
          limb: 'head',
          tiers: [
            { id: 'tier-1', tier: '1', modifierId: 'm1', levelRequirement: 1, weight: 100 }
          ]
        }
      ],
      legendaries: [
        {
          id: 'leg-1',
          limb: 'head',
          icon: 'leg1.png',
          mods: [{ id: 'mod-1' }]
        }
      ]
    }
  };
  const en = {
    'vorax/i18n/en': {
      craftAffixes: {
        'affix-1': { tiers: [{ id: 'tier-1', rawText: '+40 Max Life' }] }
      },
      legendaries: {
        'leg-1': {
          name: 'Crown of Ash',
          mods: [{ id: 'mod-1', normalRawText: '+50 Armor', corrodedRawText: '+100 Armor' }]
        }
      }
    }
  };
  const { affixes, legendaries } = mapVorax(master, en);
  assert.equal(affixes.length, 1);
  assert.deepEqual(affixes[0].modifiers, [{ stat: 'life', op: 'flat', value: 40 }]);
  assert.equal(affixes[0].tiers.length, 1);
  assert.equal(affixes[0].tiers[0].modifierId, 'm1');

  assert.equal(legendaries.length, 1);
  assert.deepEqual(legendaries[0], {
    id: 'leg-1',
    limb: 'head',
    icon: 'leg1.png',
    modifiers: [{ stat: 'armor', op: 'flat', value: 50 }],
    corrodedModifiers: [{ stat: 'armor', op: 'flat', value: 100 }]
  });
});

test('mapVorax omits corrodedModifiers when the legendary has no corroded variant text', () => {
  const master = { k: { legendaries: [{ id: 'leg-2', mods: [{ id: 'mod-2' }] }] } };
  const en = { k: { legendaries: { 'leg-2': { mods: [{ id: 'mod-2', normalRawText: '+10 Armor' }] } } } };
  const { legendaries } = mapVorax(master, en);
  assert.deepEqual(legendaries[0].modifiers, [{ stat: 'armor', op: 'flat', value: 10 }]);
  assert.equal('corrodedModifiers' in legendaries[0], false);
});
