import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

test('desktop build artifact exists', async () => {
  await access(new URL('../dist/main.js', import.meta.url));
  assert.ok(true);
});
