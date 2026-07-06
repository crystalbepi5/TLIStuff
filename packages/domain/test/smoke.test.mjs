import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

test('domain package build artifact exists', async () => {
  await access(new URL('../dist/index.js', import.meta.url));
  assert.ok(true);
});
