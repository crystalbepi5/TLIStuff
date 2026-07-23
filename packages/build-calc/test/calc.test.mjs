import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDataset, indexDataset } from '@torchlight-companion/build-data';
import {
  aggregate,
  applyAggregate,
  computeDamage,
  computeDefense,
  evaluateBuild,
  MAX_PACT_SPIRITS
} from '../dist/index.js';

/** Minimal valid build with all modifier-source lists empty. */
function baseBuild(overrides = {}) {
  return {
    id: 'b',
    name: 'B',
    heroId: 'selina-tide-whisper',
    activeSkillId: 'dance-of-the-deep',
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

test('aggregate sorts modifiers into flat / increased / more buckets', () => {
  const mods = [
    { stat: 'increasedFire', op: 'flat', value: 10 },
    { stat: 'increasedFire', op: 'increased', value: 30 },
    { stat: 'increasedFire', op: 'increased', value: 20 },
    { stat: 'increasedFire', op: 'more', value: 0.5 }
  ];
  const agg = aggregate(mods, 'increasedFire');
  assert.equal(agg.flat, 10);
  assert.equal(agg.increased, 50);
  assert.equal(agg.more, 1.5);
  // (base 100 + flat 10) * (1 + 0.5) * 1.5 = 247.5
  assert.equal(applyAggregate(100, agg), 247.5);
});

test('computeDamage: increased sums and more multiplies', () => {
  const skill = {
    id: 's',
    name: 'S',
    tags: ['spell'],
    baseDamage: { fire: 100 },
    baseRate: 1,
    baseCritRate: 0,
    supportSlots: 5
  };
  // 100 * (1 + 100/100) * (1 + 0.5) = 300 average hit, no crit, rate 1 -> dps 300
  const result = computeDamage(skill, [
    { stat: 'increasedDamage', op: 'increased', value: 100 },
    { stat: 'moreDamage', op: 'more', value: 0.5 }
  ]);
  assert.equal(result.averageHit, 300);
  assert.equal(result.critRate, 0);
  assert.equal(result.rate, 1);
  assert.equal(result.dps, 300);
});

test('computeDamage: crit factor and attack speed', () => {
  const skill = {
    id: 's',
    name: 'S',
    tags: ['attack'],
    baseDamage: { physical: 100 },
    baseRate: 2,
    baseCritRate: 100,
    supportSlots: 5
  };
  // crit 100%, crit multi 1.5 -> factor 1.5; attack speed +50% -> rate 3
  const result = computeDamage(skill, [
    { stat: 'increasedAttackSpeed', op: 'increased', value: 50 }
  ]);
  assert.equal(result.critRate, 100);
  assert.equal(result.critMultiplier, 1.5);
  assert.equal(result.rate, 3);
  // 100 * 1.5 (crit) * 3 (rate) = 450
  assert.equal(result.dps, 450);
});

test('computeDamage: increasedElemental applies to elements but not physical', () => {
  const skill = {
    id: 's',
    name: 'S',
    tags: ['spell'],
    baseDamage: { fire: 100, physical: 100 },
    baseRate: 1,
    baseCritRate: 0,
    supportSlots: 5
  };
  const result = computeDamage(skill, [
    { stat: 'increasedElemental', op: 'increased', value: 100 }
  ]);
  assert.equal(result.perElement.fire, 200);
  assert.equal(result.perElement.physical, 100);
  assert.equal(result.averageHit, 300);
});

test('computeDefense: resistances cap and health pool', () => {
  const def = computeDefense([
    { stat: 'life', op: 'flat', value: 1000 },
    { stat: 'increasedLife', op: 'increased', value: 20 },
    { stat: 'energyShield', op: 'flat', value: 500 },
    { stat: 'fireResist', op: 'flat', value: 90 },
    { stat: 'coldResist', op: 'flat', value: 50 }
  ]);
  assert.equal(def.life, 1200); // 1000 * 1.2
  assert.equal(def.energyShield, 500);
  assert.equal(def.healthPool, 1700);
  assert.equal(def.resists.fire, 75); // capped from 90
  assert.equal(def.resists.cold, 50);
});

test('evaluateBuild: Selina + Dance of the Deep produces positive dps, no fatal warnings', () => {
  const index = indexDataset(seedDataset);
  const build = baseBuild({
    name: 'Cold Selina',
    supportIds: ['elemental-boost', 'concentrated-effect', 'arcane-surge', 'deadly-aim'],
    gear: [
      { slot: 'weapon', baseId: 'tidecaller-staff', affixIds: ['of-frost'] },
      { slot: 'chest', baseId: 'silk-robe', affixIds: ['of-vitality', 'resolute'] }
    ],
    talentIds: ['selina-deep-current', 'generic-lethality'],
    pactSpiritIds: ['leviathan'],
    memoryIds: ['awakened-tide']
  });
  const report = evaluateBuild(build, index);
  assert.ok(report.damage.dps > 0, 'expected positive dps');
  assert.ok(report.defense.healthPool > 0, 'expected positive health pool');
  assert.deepEqual(report.warnings, []);
});

test('evaluateBuild: tag-mismatched support is dropped with a warning', () => {
  const index = indexDataset(seedDataset);
  const build = baseBuild({ supportIds: ['swift-strikes'] }); // requires 'attack', skill is spell
  const report = evaluateBuild(build, index);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /swift strikes/i);
});

test('evaluateBuild: a support whose cannotSupport conflicts with the active skill is dropped with a warning, not silently applied', () => {
  const index = indexDataset(seedDataset);
  // Real scraped data: Spell Tangle has cannotSupport ['Channeled', 'Sentry',
  // 'Summon'] and a +15.5% moreDamage modifier; the default build's active
  // skill (dance-of-the-deep) is tagged 'channelled'.
  const bare = evaluateBuild(baseBuild(), index);
  const withConflict = evaluateBuild(baseBuild({ supportIds: ['spell-tangle'] }), index);
  assert.equal(withConflict.damage.dps, bare.damage.dps, 'the conflicting support must not affect dps');
  assert.ok(withConflict.warnings.some((w) => /spell tangle/i.test(w) && /cannot support/i.test(w)));
});

test('evaluateBuild: talents, pact spirits and memories all raise dps', () => {
  const index = indexDataset(seedDataset);
  const bare = evaluateBuild(baseBuild(), index);
  const withProgression = evaluateBuild(
    baseBuild({
      talentIds: ['selina-undertow'], // +12% more
      pactSpiritIds: ['leviathan'], // +20% elemental
      memoryIds: ['awakened-ruin'] // +10% more
    }),
    index
  );
  assert.ok(withProgression.damage.dps > bare.damage.dps, 'progression should increase dps');
});

test("evaluateBuild: another hero's talent is ignored with a warning", () => {
  const index = indexDataset(seedDataset);
  // Gemma's talent on a Selina build.
  const report = evaluateBuild(baseBuild({ talentIds: ['gemma-molten-core'] }), index);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /another hero/i);
});

test('evaluateBuild: pact spirits beyond the cap are ignored with a warning', () => {
  const index = indexDataset(seedDataset);
  const tooMany = ['leviathan', 'emberwing', 'stoneguard', 'voltaic-sprite'];
  assert.ok(tooMany.length > MAX_PACT_SPIRITS);
  const report = evaluateBuild(baseBuild({ pactSpiritIds: tooMany }), index);
  assert.ok(
    report.warnings.some((w) => /pact spirits bound/i.test(w)),
    'expected a pact-spirit cap warning'
  );
});

// Real ids from the scraped seed data (not hand-fixtures) -- see
// packages/build-data/src/seed/voraxAffixes.json / voraxLegendaries.json.
const VORAX_LEGENDARY_HEAD = 'f9be5c29-e9dc-51a3-969e-0da4cc61389b'; // +50 armor
const VORAX_AFFIX_HEAD_MORE_DAMAGE = 'e01068c9-558e-5ac9-bea4-3a15d4bdbc15'; // +8% more damage

test('evaluateBuild: Vorax legendary + affix modifiers are folded in', () => {
  const index = indexDataset(seedDataset);
  const bare = evaluateBuild(baseBuild(), index);
  const withVorax = evaluateBuild(
    baseBuild({
      voraxGear: [{ limb: 'head', legendaryId: VORAX_LEGENDARY_HEAD, affixIds: [VORAX_AFFIX_HEAD_MORE_DAMAGE] }]
    }),
    index
  );
  assert.ok(withVorax.defense.armor > bare.defense.armor, 'vorax legendary armor should apply');
  assert.ok(withVorax.damage.dps > bare.damage.dps, 'vorax affix more-damage should apply');
});

test('evaluateBuild: a Vorax legendary id looked up under the wrong limb is reported as unknown', () => {
  // VoraxLegendary.id is NOT unique across limbs in the real scrape (the same
  // legendary effect can spawn on more than one compatible limb, e.g. head
  // and neck, as separate entries sharing an id) -- the index is keyed on
  // (limb, id) together, so the right id under the wrong limb must not
  // silently resolve to a different limb's entry.
  const index = indexDataset(seedDataset);
  const report = evaluateBuild(
    baseBuild({ voraxGear: [{ limb: 'chest', legendaryId: VORAX_LEGENDARY_HEAD, affixIds: [] }] }),
    index
  );
  assert.ok(report.warnings.some((w) => /unknown vorax legendary/i.test(w)));
});

test('evaluateBuild: unknown vorax affix/legendary ids are reported, not silently dropped', () => {
  const index = indexDataset(seedDataset);
  const report = evaluateBuild(
    baseBuild({ voraxGear: [{ limb: 'head', legendaryId: 'nonexistent', affixIds: ['nonexistent-affix'] }] }),
    index
  );
  assert.ok(report.warnings.some((w) => /unknown vorax legendary/i.test(w)));
  assert.ok(report.warnings.some((w) => /unknown vorax affix/i.test(w)));
});

test('evaluateBuild: Talent Tree and Void Chart node modifiers are folded in', () => {
  const index = indexDataset(seedDataset);
  const bare = evaluateBuild(baseBuild(), index);
  // Real node from talentTrees.json carrying +9% increasedDamage.
  const nodeId = '4c2624fe-947f-5dfe-9ada-460175de6770';
  const withNode = evaluateBuild(baseBuild({ talentTreeNodeIds: [nodeId] }), index);
  assert.ok(withNode.damage.dps > bare.damage.dps, 'talent tree node modifier should apply');
});

test('evaluateBuild: unknown progression-tree node ids are reported, not silently dropped', () => {
  const index = indexDataset(seedDataset);
  const report = evaluateBuild(
    baseBuild({ talentTreeNodeIds: ['nonexistent-node'], voidChartNodeIds: ['nonexistent-node-2'] }),
    index
  );
  assert.ok(report.warnings.some((w) => /unknown talent tree node/i.test(w)));
  assert.ok(report.warnings.some((w) => /unknown void chart node/i.test(w)));
});

// A minimal hand-rolled index (not the real seedDataset) isolates this
// specific behaviour: SupportSkill.requiresSkillId is populated only for the
// game's Magnificent/Noble Support categories (every entry in both carries
// a skillTag naming one specific active skill; no other category ever
// does), and it needs its own check separate from requiresTags since a tag
// list can't express "only this one exact skill".
function fakeIndex({ skills, supports }) {
  const skillMap = new Map(skills.map((s) => [s.id, s]));
  const supportMap = new Map(supports.map((s) => [s.id, s]));
  return {
    hero: () => ({ id: 'h', name: 'H', baseModifiers: [] }),
    activeSkill: (id) => skillMap.get(id),
    supportSkill: (id) => supportMap.get(id),
    gearBase: () => undefined,
    affix: () => undefined,
    talent: () => undefined,
    pactSpirit: () => undefined,
    memory: () => undefined,
    voraxAffix: () => undefined,
    voraxLegendary: () => undefined,
    talentTreeNode: () => undefined,
    voidChartNode: () => undefined
  };
}

test('evaluateBuild: a support scoped to a specific skill (requiresSkillId) is dropped with a warning on any other skill', () => {
  const focusedShot = {
    id: 'focused-shot',
    name: 'Focused Shot',
    tags: ['attack'],
    baseDamage: { physical: 100 },
    baseRate: 1,
    baseCritRate: 5,
    supportSlots: 5
  };
  const otherSkill = { ...focusedShot, id: 'other-skill', name: 'Other Skill' };
  const magnificentSupport = {
    id: 'focused-shot-magnificent-1',
    name: 'Focused Shot (Magnificent)',
    modifiers: [{ stat: 'moreDamage', op: 'more', value: 0.5 }],
    requiresTags: [],
    requiresSkillId: 'focused-shot'
  };
  const index = fakeIndex({ skills: [focusedShot, otherSkill], supports: [magnificentSupport] });

  const onWrongSkill = evaluateBuild(
    baseBuild({ activeSkillId: 'other-skill', supportIds: ['focused-shot-magnificent-1'] }),
    index
  );
  assert.ok(onWrongSkill.warnings.some((w) => /requires 'focused-shot' to be socketed\/active/.test(w)));
  assert.equal(onWrongSkill.modifiers.some((m) => m.stat === 'moreDamage'), false);

  const onRightSkill = evaluateBuild(
    baseBuild({ activeSkillId: 'focused-shot', supportIds: ['focused-shot-magnificent-1'] }),
    index
  );
  assert.equal(onRightSkill.warnings.length, 0);
  assert.ok(onRightSkill.modifiers.some((m) => m.stat === 'moreDamage' && m.value === 0.5));
});

test('evaluateBuild: a signature support whose requiresSkillId names another *support* (not an active skill) is satisfied when that support is also socketed', () => {
  // Confirmed real: some scraped signature supports target another support
  // skill rather than an active skill (e.g. "Thunder Focus: Haste
  // (Magnificent)" requires 'thunder-focus', itself a support id). Comparing
  // only against build.activeSkillId meant these were always dropped, even
  // with the owning support socketed right alongside them.
  const anySkill = {
    id: 'any-skill',
    name: 'Any Skill',
    tags: ['spell'],
    baseDamage: { physical: 100 },
    baseRate: 1,
    baseCritRate: 5,
    supportSlots: 5
  };
  const thunderFocus = {
    id: 'thunder-focus',
    name: 'Thunder Focus',
    modifiers: [{ stat: 'increasedDamage', op: 'increased', value: 10 }],
    requiresTags: []
  };
  const thunderFocusHaste = {
    id: 'thunder-focus-haste-magnificent-1',
    name: 'Thunder Focus: Haste (Magnificent)',
    modifiers: [{ stat: 'moreDamage', op: 'more', value: 0.3 }],
    requiresTags: [],
    requiresSkillId: 'thunder-focus'
  };
  const index = fakeIndex({ skills: [anySkill], supports: [thunderFocus, thunderFocusHaste] });

  const withoutOwner = evaluateBuild(
    baseBuild({ activeSkillId: 'any-skill', supportIds: ['thunder-focus-haste-magnificent-1'] }),
    index
  );
  assert.ok(withoutOwner.warnings.some((w) => /requires 'thunder-focus' to be socketed\/active/.test(w)));
  assert.equal(withoutOwner.modifiers.some((m) => m.stat === 'moreDamage'), false);

  const withOwner = evaluateBuild(
    baseBuild({
      activeSkillId: 'any-skill',
      supportIds: ['thunder-focus', 'thunder-focus-haste-magnificent-1']
    }),
    index
  );
  assert.equal(withOwner.warnings.length, 0);
  assert.ok(withOwner.modifiers.some((m) => m.stat === 'moreDamage' && m.value === 0.3));
});

test('evaluateBuild: a gear affix merged across slots contributes its own slot-correct roll, not another slot\'s', () => {
  // Confirmed real bug (Codex, post-merge): recomputing an affix's top-level
  // `modifiers` as the best roll across every merged slot meant a lower-roll
  // slot (boots +220) got credited with a higher-roll slot's value (weapon
  // +330) whenever that affix was equipped there. collectModifiers must use
  // the piece's own slot to pick the correct tier.
  const anySkill = {
    id: 'any-skill',
    name: 'Any Skill',
    tags: ['spell'],
    baseDamage: { physical: 100 },
    baseRate: 1,
    baseCritRate: 5,
    supportSlots: 5
  };
  const bootsBase = { id: 'boots-base', name: 'Boots Base', slot: 'boots', implicit: [] };
  const weaponBase = { id: 'weapon-base', name: 'Weapon Base', slot: 'weapon', implicit: [] };
  const maxLife = {
    id: 'max-life-prefix',
    name: 'Max Life',
    kind: 'prefix',
    modifiers: [{ stat: 'life', op: 'flat', value: 330 }], // best-across-slots preview
    slots: ['boots', 'weapon'],
    tiers: [
      { tier: '1', modifierId: 'boots-1', weight: 100, slot: 'boots', modifiers: [{ stat: 'life', op: 'flat', value: 220 }] },
      { tier: '1', modifierId: 'weapon-1', weight: 100, slot: 'weapon', modifiers: [{ stat: 'life', op: 'flat', value: 330 }] }
    ]
  };
  const index = {
    hero: () => ({ id: 'h', name: 'H', baseModifiers: [] }),
    activeSkill: () => anySkill,
    supportSkill: () => undefined,
    gearBase: (id) => (id === 'boots-base' ? bootsBase : id === 'weapon-base' ? weaponBase : undefined),
    affix: () => maxLife,
    talent: () => undefined,
    pactSpirit: () => undefined,
    memory: () => undefined,
    voraxAffix: () => undefined,
    voraxLegendary: () => undefined,
    talentTreeNode: () => undefined,
    voidChartNode: () => undefined
  };

  const onBoots = evaluateBuild(
    baseBuild({ activeSkillId: 'any-skill', gear: [{ baseId: 'boots-base', slot: 'boots', affixIds: ['max-life-prefix'] }] }),
    index
  );
  assert.ok(onBoots.modifiers.some((m) => m.stat === 'life' && m.value === 220));
  assert.equal(onBoots.modifiers.some((m) => m.stat === 'life' && m.value === 330), false);

  const onWeapon = evaluateBuild(
    baseBuild({ activeSkillId: 'any-skill', gear: [{ baseId: 'weapon-base', slot: 'weapon', affixIds: ['max-life-prefix'] }] }),
    index
  );
  assert.ok(onWeapon.modifiers.some((m) => m.stat === 'life' && m.value === 330));
});
