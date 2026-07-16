import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchRoot } from '../dist/findGameLogPath.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'torchlight-companion-findlog-'));
}

test('searchRoot finds Saved/Logs/UE_game.log under a case-insensitively "torchlight"-named install dir', () => {
  const root = tempDir();
  try {
    const logsDir = join(root, 'Torchlight Infinite', 'Saved', 'Logs');
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, 'UE_game.log');
    writeFileSync(logPath, 'hello\n');

    assert.deepEqual(searchRoot(root), [logPath]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('searchRoot descends through non-matching directories to find a nested match (Proton-style prefix)', () => {
  const root = tempDir();
  try {
    // steamapps/compatdata/<appid>/pfx/drive_c/users/steamuser/AppData/Local/TorchlightInfinite/Saved/Logs
    const logsDir = join(root, '2379430', 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'Local', 'TorchlightInfinite', 'Saved', 'Logs');
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, 'UE_game.log');
    writeFileSync(logPath, 'hello\n');

    assert.deepEqual(searchRoot(root), [logPath]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('searchRoot ignores directories that do not mention "torchlight" and finds nothing', () => {
  const root = tempDir();
  try {
    mkdirSync(join(root, 'Some Other Game', 'Saved', 'Logs'), { recursive: true });
    writeFileSync(join(root, 'Some Other Game', 'Saved', 'Logs', 'UE_game.log'), 'hello\n');

    assert.deepEqual(searchRoot(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('searchRoot finds multiple installs (e.g. Steam + a second copy) so the caller can pick the newest', () => {
  const root = tempDir();
  try {
    const oldLogsDir = join(root, 'Torchlight Infinite', 'Saved', 'Logs');
    const newLogsDir = join(root, 'TorchlightInfiniteBackup', 'Saved', 'Logs');
    mkdirSync(oldLogsDir, { recursive: true });
    mkdirSync(newLogsDir, { recursive: true });
    const oldLog = join(oldLogsDir, 'UE_game.log');
    const newLog = join(newLogsDir, 'UE_game.log');
    writeFileSync(oldLog, 'old\n');
    writeFileSync(newLog, 'new\n');
    const old = new Date(Date.now() - 60_000);
    utimesSync(oldLog, old, old);

    const found = searchRoot(root).sort();
    assert.deepEqual(found, [newLog, oldLog].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('searchRoot returns [] for a root that does not exist', () => {
  assert.deepEqual(searchRoot('/no/such/directory/at/all'), []);
});
