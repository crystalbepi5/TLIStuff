import test from 'node:test';
import assert from 'node:assert/strict';
import type { Build } from '@torchlight-companion/build-data';
import {
  createPlannerState,
  plannerReducer,
  MAX_HISTORY,
  type PlannerState
} from '../src/planner/context/plannerReducer.ts';

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

test('PATCH applies a plain-object patch and records history', () => {
  const state = createPlannerState(baseBuild());
  const next = plannerReducer(state, { type: 'PATCH', patch: { name: 'Renamed' } });
  assert.equal(next.build.name, 'Renamed');
  assert.equal(next.past.length, 1);
  assert.equal(next.past[0]?.name, 'New Build');
  assert.equal(next.future.length, 0);
});

test('PATCH accepts a function patch computed from the current build', () => {
  const state = createPlannerState(baseBuild({ talentIds: ['t1'] }));
  const next = plannerReducer(state, {
    type: 'PATCH',
    patch: (b) => ({ talentIds: [...b.talentIds, 't2'] })
  });
  assert.deepEqual(next.build.talentIds, ['t1', 't2']);
});

test('PATCH is a no-op (no history entry) when the patch changes nothing', () => {
  const state = createPlannerState(baseBuild({ name: 'Same' }));
  const next = plannerReducer(state, { type: 'PATCH', patch: { name: 'Same' } });
  assert.equal(next, state); // same reference — bailed out before creating history
  assert.equal(next.past.length, 0);
});

test('PATCH collapses rapid same-groupKey edits into a single history entry', () => {
  let state = createPlannerState(baseBuild({ name: '' }));
  const now = 1_000;
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'A' }, groupKey: 'buildName', now });
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'Ab' }, groupKey: 'buildName', now: now + 100 });
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'Abc' }, groupKey: 'buildName', now: now + 200 });
  assert.equal(state.build.name, 'Abc');
  assert.equal(state.past.length, 1); // one entry for the whole typing burst
  assert.equal(state.past[0]?.name, ''); // pointing back to before typing started
});

test('PATCH starts a new history entry once the debounce window elapses', () => {
  let state = createPlannerState(baseBuild({ name: '' }));
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'A' }, groupKey: 'buildName', now: 0 });
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'B' }, groupKey: 'buildName', now: 10_000 });
  assert.equal(state.past.length, 2);
});

test('PATCH starts a new history entry when the groupKey differs', () => {
  let state = createPlannerState(baseBuild({ name: '', heroId: 'hero-a' }));
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'A' }, groupKey: 'buildName', now: 0 });
  state = plannerReducer(state, { type: 'PATCH', patch: { heroId: 'hero-b' }, groupKey: 'hero', now: 50 });
  assert.equal(state.past.length, 2);
});

test('UNDO steps back one entry and REDO steps forward again', () => {
  let state = createPlannerState(baseBuild({ name: 'v1' }));
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'v2' } });
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'v3' } });

  state = plannerReducer(state, { type: 'UNDO' });
  assert.equal(state.build.name, 'v2');
  state = plannerReducer(state, { type: 'UNDO' });
  assert.equal(state.build.name, 'v1');

  state = plannerReducer(state, { type: 'REDO' });
  assert.equal(state.build.name, 'v2');
  state = plannerReducer(state, { type: 'REDO' });
  assert.equal(state.build.name, 'v3');
});

test('UNDO with empty history is a no-op', () => {
  const state = createPlannerState(baseBuild());
  const next = plannerReducer(state, { type: 'UNDO' });
  assert.equal(next, state);
});

test('REDO with empty future is a no-op', () => {
  const state = createPlannerState(baseBuild());
  const next = plannerReducer(state, { type: 'REDO' });
  assert.equal(next, state);
});

test('a new PATCH after UNDO clears the redo future (no stale branches)', () => {
  let state = createPlannerState(baseBuild({ name: 'v1' }));
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'v2' } });
  state = plannerReducer(state, { type: 'UNDO' });
  assert.equal(state.future.length, 1);
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'v1-alt' } });
  assert.equal(state.future.length, 0);
  assert.equal(state.build.name, 'v1-alt');
});

test('LOAD_BUILD hard-replaces the build and resets undo/redo history', () => {
  let state = createPlannerState(baseBuild({ name: 'v1' }));
  state = plannerReducer(state, { type: 'PATCH', patch: { name: 'v2' } });
  const imported = baseBuild({ id: 'imported', name: 'Imported build' });
  state = plannerReducer(state, { type: 'LOAD_BUILD', build: imported });
  assert.equal(state.build.name, 'Imported build');
  assert.equal(state.past.length, 0);
  assert.equal(state.future.length, 0);
});

test('history is capped at MAX_HISTORY entries', () => {
  let state: PlannerState = createPlannerState(baseBuild({ name: 'v0' }));
  for (let i = 1; i <= MAX_HISTORY + 20; i++) {
    state = plannerReducer(state, { type: 'PATCH', patch: { name: `v${i}` }, now: i * 10_000 });
  }
  assert.equal(state.past.length, MAX_HISTORY);
});
