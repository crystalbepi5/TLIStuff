import test from 'node:test';
import assert from 'node:assert/strict';
import type { Build } from '@torchlight-companion/build-data';
import { decodeEnvelope, encodeEnvelope, SCHEMA_VERSION } from '../src/planner/context/persistence.ts';

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

test('encodeEnvelope / decodeEnvelope round-trips a build', () => {
  const build = baseBuild({ name: 'Round trip' });
  const raw = encodeEnvelope(build, 'equipment');
  const decoded = decodeEnvelope(raw);
  assert.ok(decoded);
  assert.equal(decoded?.schemaVersion, SCHEMA_VERSION);
  assert.equal(decoded?.activeSection, 'equipment');
  assert.deepEqual(decoded?.build, build);
});

test('decodeEnvelope returns undefined for malformed JSON', () => {
  assert.equal(decodeEnvelope('{not json'), undefined);
});

test('decodeEnvelope returns undefined for non-object JSON', () => {
  assert.equal(decodeEnvelope('42'), undefined);
  assert.equal(decodeEnvelope('null'), undefined);
  assert.equal(decodeEnvelope('"a string"'), undefined);
});

test('decodeEnvelope returns undefined when the build field is missing', () => {
  assert.equal(decodeEnvelope(JSON.stringify({ schemaVersion: 1, updatedAt: 0 })), undefined);
});

test('decodeEnvelope rejects an envelope from a newer, unknown schema version', () => {
  const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, updatedAt: 0, build: baseBuild() });
  assert.equal(decodeEnvelope(raw), undefined);
});

test('decodeEnvelope accepts an older schema version (forward migration seam)', () => {
  const raw = JSON.stringify({ schemaVersion: 0, updatedAt: 0, build: baseBuild() });
  const decoded = decodeEnvelope(raw);
  assert.ok(decoded);
  assert.equal(decoded?.build.name, 'New Build');
});
