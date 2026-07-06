import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('local-agent build artifact exists', async () => {
  await access(new URL('../dist/index.js', import.meta.url));
  assert.ok(true);
});

const testDir = mkdtempSync(join(tmpdir(), 'torchlight-companion-agent-'));
process.env.DATABASE_PATH = join(testDir, 'test.db');
const logPath = join(testDir, 'UE_game.log');
writeFileSync(logPath, '');
process.env.TORCHLIGHT_LOG_PATH = logPath;
process.env.LOCAL_AGENT_PORT = '47771';
const baseUrl = 'http://127.0.0.1:47771/api/v1';

// Importing the server module starts it listening and starts the tailer as side effects
// (matches local-agent's existing top-level behavior).
const { server } = await import('../dist/index.js');

test.after(() => {
  // server.close() alone waits for every open socket to end gracefully — an SSE connection
  // is deliberately long-lived (keep-alive, never calls res.end()), so a still-open test
  // client can make close() hang indefinitely. closeAllConnections() force-terminates any
  // lingering sockets so the test process actually exits.
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
});

test('GET /health returns ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('GET /loot/recent returns an empty snapshot before any loot has been seen', async () => {
  const res = await fetch(`${baseUrl}/loot/recent`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.data.recentEvents, []);
  assert.equal(body.data.netWorth, 0);
  assert.equal('activeRun' in body.data, false);
});

test('unknown routes return 404', async () => {
  const res = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(res.status, 404);
});

test('appending a real inventory pickup line to the watched log file produces a loot event visible via /loot/recent', async () => {
  appendFileSync(logPath, '[2026.07.06-12.00.00:000][100]LogInventory: Display: PageId=0 SlotId=1 ConfigBaseId=5001 Count=1\n');

  const deadline = Date.now() + 3000;
  let found;
  while (Date.now() < deadline && !found) {
    const body = await fetch(`${baseUrl}/loot/recent`).then((r) => r.json());
    found = body.data.recentEvents.find((e) => e.configBaseId === 5001);
    if (!found) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(found, 'expected a loot event for configBaseId 5001 to appear');
  assert.equal(found.quantity, 1);
  assert.equal(found.pageId, 0);
  assert.equal(found.slotId, 1);
});

test('GET /loot/events resolves immediately (headers must be flushed, not held until the first write)', async () => {
  const t0 = Date.now();
  const controller = new AbortController();
  const streamRes = await fetch(`${baseUrl}/loot/events`, { signal: controller.signal });
  const elapsed = Date.now() - t0;
  controller.abort();
  assert.equal(streamRes.status, 200);
  // Regression guard for a real bug: without res.flushHeaders(), Node holds the response
  // headers until the first res.write() — on an otherwise-idle SSE connection that meant the
  // client's fetch() didn't resolve until the 15s heartbeat forced a write. Generous bound
  // (well under 15000ms) so this fails loudly if the flush regresses, without being flaky.
  assert.ok(elapsed < 2000, `expected fetch() to resolve quickly, took ${elapsed}ms`);
});

test('GET /loot/events streams a real SSE frame for a loot pickup as it happens', async () => {
  const controller = new AbortController();
  const streamRes = await fetch(`${baseUrl}/loot/events`, { signal: controller.signal });
  assert.equal(streamRes.status, 200);
  assert.match(streamRes.headers.get('content-type'), /text\/event-stream/);

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let received = '';

  const readUntilFrame = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
      if (received.includes('"configBaseId":6002')) break;
    }
  })();

  // Give the SSE connection a moment to register its listener before the log line lands.
  await new Promise((resolve) => setTimeout(resolve, 100));
  appendFileSync(logPath, '[2026.07.06-12.00.01:000][101]LogInventory: Display: PageId=0 SlotId=2 ConfigBaseId=6002 Count=1\n');

  await Promise.race([
    readUntilFrame,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for SSE frame')), 3000))
  ]);

  controller.abort();
  assert.match(received, /^id: \d+\ndata: /m);
  assert.match(received, /"configBaseId":6002/);
});
