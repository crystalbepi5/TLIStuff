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
  mapVorax,
  mapKismet
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

test('mapLegendaries derives slot from the bundle key path and parses normalRawText', () => {
  const bundle = {
    'legendaries/boots/dex_boots/i18n/en': {
      items: {
        u: {
          name: 'Frostroot Greaves',
          mods: [{ normalRawText: '+40 Max Life' }, { normalRawText: '+24% Cold Resistance' }]
        }
      }
    }
  };
  const legs = mapLegendaries(bundle);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].slot, 'boots'); // from the "boots" path segment, not the name
  // order follows rule order (resistance rule precedes the life rule)
  assert.deepEqual(legs[0].implicit, [
    { stat: 'coldResist', op: 'flat', value: 24 },
    { stat: 'life', op: 'flat', value: 40 }
  ]);
});

test('mapLegendaries uses the real slot even when the item name would misdirect a name-based guess', () => {
  // Confirmed real false positives of the old name-regex approach: "Devouring
  // Tide" contains "ring" as a substring (misclassified as a ring), and
  // shield items had no matching keyword (silently defaulted to 'weapon').
  const bundle = {
    'legendaries/one_handed/dagger/i18n/en': {
      items: { u1: { name: 'Devouring Tide', mods: [{ normalRawText: '+10% Attack Speed' }] } }
    },
    'legendaries/shield/str_shield/i18n/en': {
      items: { u2: { name: 'Bastion Ward', mods: [{ normalRawText: '+300 Armor' }] } }
    }
  };
  const legs = mapLegendaries(bundle);
  assert.equal(legs.find((l) => l.name === 'Devouring Tide').slot, 'weapon');
  assert.equal(legs.find((l) => l.name === 'Bastion Ward').slot, 'offhand');
});

test('mapLegendaries resolves "trinket" categories from their sub-path (belt/necklace/ring/spirit_ring)', () => {
  const bundle = {
    'legendaries/trinket/belt/i18n/en': { items: { u1: { name: 'Iron Cinch', mods: [{ normalRawText: '+40 Max Life' }] } } },
    'legendaries/trinket/necklace/i18n/en': { items: { u2: { name: 'Sun Choker', mods: [{ normalRawText: '+40 Max Life' }] } } },
    'legendaries/trinket/ring/i18n/en': { items: { u3: { name: 'Loop of Ash', mods: [{ normalRawText: '+40 Max Life' }] } } },
    'legendaries/trinket/spirit_ring/i18n/en': { items: { u4: { name: 'Spirit Loop', mods: [{ normalRawText: '+40 Max Life' }] } } }
  };
  const legs = mapLegendaries(bundle);
  assert.equal(legs.find((l) => l.name === 'Iron Cinch').slot, 'belt');
  assert.equal(legs.find((l) => l.name === 'Sun Choker').slot, 'amulet');
  assert.equal(legs.find((l) => l.name === 'Loop of Ash').slot, 'ring');
  assert.equal(legs.find((l) => l.name === 'Spirit Loop').slot, 'ring');
});

test('mapLegendaries skips sections whose category has no known slot', () => {
  const bundle = {
    'legendaries/mystery_category/x/i18n/en': {
      items: { u: { name: 'Unknowable Thing', mods: [{ normalRawText: '+40 Max Life' }] } }
    }
  };
  assert.deepEqual(mapLegendaries(bundle), []);
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
  // Top-level modifiers must reflect the best tier a player can actually
  // craft (weight > 0) -- the disabled 0+ tier rolls higher (372) but is
  // unobtainable, so tier '1' (250, weight 100) is the correct "top" here.
  assert.deepEqual(life.modifiers, [{ stat: 'life', op: 'flat', value: 250 }]);
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

test('mapAffixes falls back to considering every tier (even weight-0) only when none are craftable, so the affix keeps its modifiers instead of losing them', () => {
  const gearMaster = {
    'gear/boots/str_boots/master': {
      category: 'boots',
      craftPrefix: [
        {
          descriptionTemplate: '+# Max Life',
          tiers: [{ tier: '0+', modifierId: '1', weight: 0, values: [{ maxValue: 372 }] }]
        }
      ]
    }
  };
  const affixes = mapAffixes(gearMaster);
  const life = affixes.find((a) => a.name === 'Max Life');
  assert.ok(life);
  assert.deepEqual(life.modifiers, [{ stat: 'life', op: 'flat', value: 372 }]);
});

test('mapAffixes recomputes top-level modifiers across every merged slot, not just the first slot encountered', () => {
  // Confirmed real bug: the same craft-affix template merges across gear
  // subtypes/slots by (kind, template), but the top-level `modifiers` was
  // only ever set from whichever slot's section was processed *first* and
  // never revisited on merge -- e.g. boots' craftable top (+220) silently
  // won even though the same merged affix has a craftable weapon tier at
  // +330, undercounting weapon builds using it.
  const gearMaster = {
    'gear/boots/str_boots/master': {
      category: 'boots',
      craftPrefix: [
        { descriptionTemplate: '+# Max Life', tiers: [{ tier: '1', modifierId: 'boots-1', weight: 100, values: [{ maxValue: 220 }] }] }
      ]
    },
    'gear/weapon/sword/master': {
      category: 'one_handed',
      craftPrefix: [
        { descriptionTemplate: '+# Max Life', tiers: [{ tier: '1', modifierId: 'weapon-1', weight: 100, values: [{ maxValue: 330 }] }] }
      ]
    }
  };
  const affixes = mapAffixes(gearMaster);
  const life = affixes.find((a) => a.name === 'Max Life');
  assert.ok(life);
  assert.deepEqual(life.slots.slice().sort(), ['boots', 'weapon']);
  // Regardless of which section was processed first, the recorded top-level
  // modifiers must be the best across ALL merged slots (330, not 220).
  assert.deepEqual(life.modifiers, [{ stat: 'life', op: 'flat', value: 330 }]);
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

test('mapAffixes disambiguates ids when distinct templates normalise to the same name (confirmed live: max-life-prefix and beams-additional-damage-suffix each collided)', () => {
  const gearMaster = {
    'gear/boots/str_boots/master': {
      category: 'boots',
      craftPrefix: [
        // "+# Max Life" (flat) and "+#% Max Life" (percentage) both strip to
        // the name "Max Life" -- same kind, same name, genuinely different
        // affixes.
        { descriptionTemplate: '+# Max Life', tiers: [{ tier: '0', modifierId: 'A', weight: 100, values: [{ maxValue: 330 }] }] },
        { descriptionTemplate: '+#% Max Life', tiers: [{ tier: '0', modifierId: 'B', weight: 100, values: [{ maxValue: 16 }] }] }
      ]
    }
  };
  const affixes = mapAffixes(gearMaster);
  const lifeAffixes = affixes.filter((a) => a.name === 'Max Life');
  assert.equal(lifeAffixes.length, 2);
  const ids = lifeAffixes.map((a) => a.id);
  assert.equal(new Set(ids).size, 2, 'ids must be unique so indexDataset can resolve both');
  assert.deepEqual(
    lifeAffixes.map((a) => a.modifiers).sort((x, y) => x[0].value - y[0].value),
    [
      [{ stat: 'increasedLife', op: 'increased', value: 16 }],
      [{ stat: 'life', op: 'flat', value: 330 }]
    ]
  );
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

test('mapSkills maps the raw "Summon" tag to the minion DamageTag, so cannotSupport Summon bans are enforceable', () => {
  // Confirmed real bug: real summon actives (e.g. "Summon Machine Guard")
  // carry a raw "Summon" tag, but it had no DamageTag mapping -- so no
  // summon skill's own `tags` ever contained 'minion', which meant
  // collectModifiers's cannotSupport check (which already normalises
  // 'Summon' -> 'minion' on the support side) could never actually trigger.
  const master = {
    'skill/Active/master': {
      category: 'Active',
      skills: [{ id: 'u1', tags: ['Spell', 'Summon', 'Persistent'] }]
    }
  };
  const en = { 'skill/Active/i18n/en': { u1: { name: 'Summon Machine Guard' } } };
  const { active } = mapSkills(master, en);
  assert.deepEqual(active[0].tags.slice().sort(), ['minion', 'spell']);
});

test('mapSkills sets requiresSkillId from skillTag for Magnificent/Noble supports, but not the generic Support category', () => {
  const master = {
    'skill/Active/master': {
      category: 'Active',
      skills: [{ id: 'u1', tags: ['Spell'] }]
    },
    'skill/Magnificent_Support/master': {
      category: 'Magnificent_Support',
      skills: [{ id: 'u2', tags: ['Support'], skillTag: 'Frost Nova' }]
    },
    'skill/Support/master': {
      category: 'Support',
      skills: [{ id: 'u3', tags: ['Support'] }]
    }
  };
  const en = {
    'skill/Active/i18n/en': { u1: { name: 'Frost Nova' } },
    'skill/Magnificent_Support/i18n/en': { u2: { name: 'Frost Nova (Magnificent)', description: '+10% additional damage' } },
    'skill/Support/i18n/en': { u3: { name: 'Generic Support', description: '+5% additional damage' } }
  };
  const { support } = mapSkills(master, en);
  const magnificent = support.find((s) => s.name === 'Frost Nova (Magnificent)');
  const generic = support.find((s) => s.name === 'Generic Support');
  assert.equal(magnificent.requiresSkillId, 'frost-nova');
  assert.equal('requiresSkillId' in generic, false);
});

test('mapHeroTraits scopes each trait to its real owning hero and uses the highest tier, stripping HTML markup', () => {
  const bundle = {
    'hero-trait/i18n/en': {
      heroes: {
        'hero-uuid-1': {
          characterName: 'Rehan',
          traits: {
            'trait-uuid-1': {
              name: 'Fury',
              tiers: [
                { level: 1, description: '<span class="text-mod">10</span>% additional damage' },
                { level: 5, description: '<span class="text-mod">78</span>% additional damage' }
              ]
            }
          }
        },
        'hero-uuid-2': {
          characterName: 'Gemma',
          traits: {
            'trait-uuid-2': { name: 'Molten Core', tiers: [{ level: 1, description: '+50 Max Life' }] }
          }
        }
      }
    }
  };
  const talents = mapHeroTraits(bundle);
  assert.equal(talents.length, 2);
  const fury = talents.find((t) => t.name === 'Fury');
  const molten = talents.find((t) => t.name === 'Molten Core');
  assert.equal(fury.heroId, 'rehan');
  assert.deepEqual(fury.modifiers, [{ stat: 'moreDamage', op: 'more', value: 0.78 }]);
  assert.equal(molten.heroId, 'gemma');
});

test('mapHeroTraits falls back to heroId "any" when a hero entry has no characterName', () => {
  const bundle = {
    k: {
      heroes: {
        'hero-uuid-1': {
          traits: { 'trait-uuid-1': { name: 'Mystery Trait', tiers: [{ level: 1, description: '+10% damage' }] } }
        }
      }
    }
  };
  const talents = mapHeroTraits(bundle);
  assert.equal(talents[0].heroId, 'any');
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

test('mapVorax skips a disabled (weight-0) first tier when picking the top-level modifiers, same as gear affixes', () => {
  const master = {
    k: {
      craftAffixes: [
        {
          id: 'affix-2',
          limb: 'chest',
          tiers: [
            { id: 't0plus', tier: '0+', modifierId: 'm0', weight: 0 }, // disabled -- listed first, but not craftable
            { id: 't1', tier: '1', modifierId: 'm1', weight: 100 }
          ]
        }
      ]
    }
  };
  const en = {
    k: {
      craftAffixes: {
        'affix-2': {
          tiers: [
            { id: 't0plus', rawText: '+372 Max Life' },
            { id: 't1', rawText: '+250 Max Life' }
          ]
        }
      }
    }
  };
  const { affixes } = mapVorax(master, en);
  assert.deepEqual(affixes[0].modifiers, [{ stat: 'life', op: 'flat', value: 250 }]);
});

test('mapVorax falls back to the first tier when none are craftable, so the affix keeps its modifiers', () => {
  const master = {
    k: { craftAffixes: [{ id: 'affix-3', limb: 'chest', tiers: [{ id: 't0plus', tier: '0+', modifierId: 'm0', weight: 0 }] }] }
  };
  const en = { k: { craftAffixes: { 'affix-3': { tiers: [{ id: 't0plus', rawText: '+372 Max Life' }] } } } };
  const { affixes } = mapVorax(master, en);
  assert.deepEqual(affixes[0].modifiers, [{ stat: 'life', op: 'flat', value: 372 }]);
});

// --------------------------------- mapKismet ---------------------------------

test('mapKismet parses effect text already present in the master bundle (no -en join needed), preferring valueMax over valueMin', () => {
  const bundle = {
    'kismet/master': {
      kismets: [
        {
          id: 'k-1',
          iconUrl: 'k1.png',
          rarity: 'Rare',
          type: 'Micro',
          effects: [{ sign: '+', valueMin: 14, valueMax: 18, unit: '%', text: '% Fire Resistance' }]
        }
      ]
    }
  };
  const kismets = mapKismet(bundle);
  assert.equal(kismets.length, 1);
  assert.deepEqual(kismets[0], {
    id: 'k-1',
    iconUrl: 'k1.png',
    rarity: 'Rare',
    type: 'Micro',
    modifiers: [{ stat: 'fireResist', op: 'flat', value: 18 }]
  });
});

test('mapKismet keeps an empty modifiers list for a kismet with no published effect (a real, common case -- ~40% of the real SS13 pool)', () => {
  const bundle = {
    k: { kismets: [{ id: 'k-2', rarity: 'Rare', type: 'Micro', effects: [] }] }
  };
  const kismets = mapKismet(bundle);
  assert.deepEqual(kismets[0].modifiers, []);
});

test('mapKismet falls back to valueMin when a kismet has no valueMax (single fixed value, not a range)', () => {
  const bundle = {
    k: {
      kismets: [
        { id: 'k-3', rarity: 'Epic', type: 'Medium', effects: [{ sign: '+', valueMin: 25, unit: '%', text: '% Fire Resistance' }] }
      ]
    }
  };
  const kismets = mapKismet(bundle);
  assert.deepEqual(kismets[0].modifiers, [{ stat: 'fireResist', op: 'flat', value: 25 }]);
});
