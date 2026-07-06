import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRepository } from '../dist/index.js';

function tempDbPath() {
  return join(mkdtempSync(join(tmpdir(), 'torchlight-companion-db-')), 'test.db');
}

test('a fresh repository starts with an empty loot feed', () => {
  const repo = new SqliteRepository(tempDbPath());
  try {
    const snapshot = repo.getLootFeedSnapshot();
    assert.deepEqual(snapshot.recentEvents, []);
    assert.equal(snapshot.netWorth, 0);
    assert.equal('activeRun' in snapshot, false);
  } finally {
    repo.close();
  }
});

test('upsertLootEvent then listRecentLootEvents round trips a real event', () => {
  const repo = new SqliteRepository(tempDbPath());
  try {
    repo.upsertLootEvent({
      id: 'evt_1', configBaseId: 1001, quantity: 1, pageId: 0, slotId: 5,
      estimatedValue: 12.5, pickedUpAt: '2026-07-06T00:00:00.000Z'
    });
    const events = repo.listRecentLootEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].configBaseId, 1001);
    assert.equal(events[0].estimatedValue, 12.5);
    assert.equal('mapRunId' in events[0], false);
  } finally {
    repo.close();
  }
});

test('listRecentLootEvents filters by sinceIso and orders newest first', () => {
  const repo = new SqliteRepository(tempDbPath());
  try {
    repo.upsertLootEvent({ id: 'evt_a', configBaseId: 1, quantity: 1, pageId: 0, slotId: 0, pickedUpAt: '2026-07-06T00:00:00.000Z' });
    repo.upsertLootEvent({ id: 'evt_b', configBaseId: 2, quantity: 1, pageId: 0, slotId: 1, pickedUpAt: '2026-07-06T00:01:00.000Z' });
    repo.upsertLootEvent({ id: 'evt_c', configBaseId: 3, quantity: 1, pageId: 0, slotId: 2, pickedUpAt: '2026-07-06T00:02:00.000Z' });

    const all = repo.listRecentLootEvents();
    assert.deepEqual(all.map((e) => e.id), ['evt_c', 'evt_b', 'evt_a']);

    const sinceB = repo.listRecentLootEvents('2026-07-06T00:00:30.000Z');
    assert.deepEqual(sinceB.map((e) => e.id), ['evt_c', 'evt_b']);
  } finally {
    repo.close();
  }
});

test('computeNetWorth sums estimated values and ignores events with no known price', () => {
  const repo = new SqliteRepository(tempDbPath());
  try {
    repo.upsertLootEvent({ id: 'evt_1', configBaseId: 1, quantity: 1, pageId: 0, slotId: 0, estimatedValue: 10, pickedUpAt: '2026-07-06T00:00:00.000Z' });
    repo.upsertLootEvent({ id: 'evt_2', configBaseId: 2, quantity: 1, pageId: 0, slotId: 1, pickedUpAt: '2026-07-06T00:01:00.000Z' });
    repo.upsertLootEvent({ id: 'evt_3', configBaseId: 3, quantity: 1, pageId: 0, slotId: 2, estimatedValue: 5.5, pickedUpAt: '2026-07-06T00:02:00.000Z' });
    assert.equal(repo.computeNetWorth(), 15.5);
  } finally {
    repo.close();
  }
});

test('getActiveMapRun returns undefined when no run is active, and the most recent active run otherwise', () => {
  const repo = new SqliteRepository(tempDbPath());
  try {
    assert.equal(repo.getActiveMapRun(), undefined);
    repo.upsertMapRun({ id: 'run_1', status: 'completed', startedAt: '2026-07-06T00:00:00.000Z', endedAt: '2026-07-06T00:05:00.000Z', totalValue: 20 });
    assert.equal(repo.getActiveMapRun(), undefined);
    repo.upsertMapRun({ id: 'run_2', status: 'active', startedAt: '2026-07-06T00:10:00.000Z', totalValue: 0 });
    const active = repo.getActiveMapRun();
    assert.equal(active.id, 'run_2');
    assert.equal('endedAt' in active, false);
  } finally {
    repo.close();
  }
});

test('latestPriceForItem returns the most recent observed price for a configBaseId', () => {
  const repo = new SqliteRepository(tempDbPath());
  try {
    assert.equal(repo.latestPriceForItem(999), undefined);
    repo.upsertPriceEntry({ id: 'price_1', configBaseId: 999, price: 3.2, observedAt: '2026-07-06T00:00:00.000Z' });
    repo.upsertPriceEntry({ id: 'price_2', configBaseId: 999, price: 4.1, observedAt: '2026-07-06T00:05:00.000Z' });
    assert.equal(repo.latestPriceForItem(999), 4.1);
  } finally {
    repo.close();
  }
});

test('data persists across separate SqliteRepository instances pointed at the same file', () => {
  const path = tempDbPath();
  new SqliteRepository(path).upsertLootEvent({ id: 'evt_1', configBaseId: 1, quantity: 1, pageId: 0, slotId: 0, estimatedValue: 7, pickedUpAt: '2026-07-06T00:00:00.000Z' });
  const reopened = new SqliteRepository(path);
  try {
    assert.equal(reopened.computeNetWorth(), 7);
  } finally {
    reopened.close();
  }
});

test('getLootFeedSnapshot reflects an active run and recent events together', () => {
  const repo = new SqliteRepository(tempDbPath());
  try {
    repo.upsertMapRun({ id: 'run_1', status: 'active', startedAt: '2026-07-06T00:00:00.000Z', totalValue: 0 });
    repo.upsertLootEvent({ id: 'evt_1', configBaseId: 1, quantity: 1, pageId: 0, slotId: 0, mapRunId: 'run_1', estimatedValue: 9, pickedUpAt: '2026-07-06T00:01:00.000Z' });
    const snapshot = repo.getLootFeedSnapshot();
    assert.equal(snapshot.activeRun.id, 'run_1');
    assert.equal(snapshot.netWorth, 9);
    assert.equal(snapshot.recentEvents.length, 1);
    assert.equal(snapshot.recentEvents[0].mapRunId, 'run_1');
  } finally {
    repo.close();
  }
});
