import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tailLogFile } from '../dist/logTailer.js';

function tempLogPath() {
  return join(mkdtempSync(join(tmpdir(), 'torchlight-companion-log-')), 'test.log');
}

function waitFor(predicate, timeoutMs = 3000, intervalMs = 20) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

test('tailLogFile only reports lines appended after it starts, not pre-existing content', async () => {
  const path = tempLogPath();
  writeFileSync(path, 'pre-existing line 1\npre-existing line 2\n');

  const seen = [];
  const handle = tailLogFile(path, (line) => seen.push(line), 50);
  try {
    appendFileSync(path, 'new line 1\n');
    await waitFor(() => seen.length >= 1);
    assert.deepEqual(seen, ['new line 1']);
  } finally {
    handle.stop();
    rmSync(path, { force: true });
  }
});

test('tailLogFile picks up multiple lines appended across separate writes', async () => {
  const path = tempLogPath();
  writeFileSync(path, '');

  const seen = [];
  const handle = tailLogFile(path, (line) => seen.push(line), 50);
  try {
    appendFileSync(path, 'line a\n');
    await waitFor(() => seen.length >= 1);
    appendFileSync(path, 'line b\nline c\n');
    await waitFor(() => seen.length >= 3);
    assert.deepEqual(seen, ['line a', 'line b', 'line c']);
  } finally {
    handle.stop();
    rmSync(path, { force: true });
  }
});

test('tailLogFile buffers a partial line until it is terminated by a newline', async () => {
  const path = tempLogPath();
  writeFileSync(path, '');

  const seen = [];
  const handle = tailLogFile(path, (line) => seen.push(line), 50);
  try {
    appendFileSync(path, 'incomplete-line-no-newline-yet');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(seen, []);

    appendFileSync(path, ' now-complete\n');
    await waitFor(() => seen.length >= 1);
    assert.deepEqual(seen, ['incomplete-line-no-newline-yet now-complete']);
  } finally {
    handle.stop();
    rmSync(path, { force: true });
  }
});

test('tailLogFile restarts from the beginning when the file is truncated (log rotation)', async () => {
  const path = tempLogPath();
  writeFileSync(path, 'a'.repeat(100) + '\n');

  const seen = [];
  const handle = tailLogFile(path, (line) => seen.push(line), 50);
  try {
    // Truncate to simulate a fresh game session's log replacing the old one.
    writeFileSync(path, 'fresh line after rotation\n');
    await waitFor(() => seen.length >= 1);
    assert.deepEqual(seen, ['fresh line after rotation']);
  } finally {
    handle.stop();
    rmSync(path, { force: true });
  }
});

test('stop() prevents any further lines from being reported', async () => {
  const path = tempLogPath();
  writeFileSync(path, '');

  const seen = [];
  const handle = tailLogFile(path, (line) => seen.push(line), 50);
  handle.stop();
  appendFileSync(path, 'should never be seen\n');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(seen, []);
  rmSync(path, { force: true });
});
