import { SqliteRepository } from '@torchlight-companion/db';
import type { LootEvent, PriceEntry } from '@torchlight-companion/domain';
import { diffInventorySnapshots, parseExchangeSearchPriceLine, parseInventorySlotLine, parseUELogLine, type InventorySlotState } from '@torchlight-companion/log-parser';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tailLogFile, type LogTailerHandle } from './logTailer.js';

const repository = new SqliteRepository();
const lootEvents = new EventEmitter();
lootEvents.setMaxListeners(0);

const now = () => new Date().toISOString();

// The collector's working memory: the last known state per inventory slot, used to diff each
// incoming slot-update line against. This is intentionally separate from packages/log-parser's
// pure diffInventorySnapshots — this map is the mutable "previous snapshot" side of that call.
const knownSlotState = new Map<string, InventorySlotState>();

function slotKey(state: Pick<InventorySlotState, 'pageId' | 'slotId'>): string {
  return `${state.pageId}:${state.slotId}`;
}

function handleLogLine(rawLine: string): void {
  const parsed = parseUELogLine(rawLine);
  if (!parsed) return;

  const slotUpdate = parseInventorySlotLine(parsed.message);
  if (slotUpdate) {
    const key = slotKey(slotUpdate);
    const previous = knownSlotState.get(key);
    const [delta] = diffInventorySnapshots(previous ? [previous] : [], [slotUpdate]);
    knownSlotState.set(key, slotUpdate);

    if (delta && delta.quantityDelta > 0) {
      const activeRun = repository.getActiveMapRun();
      const price = repository.latestPriceForItem(delta.configBaseId);
      const event: LootEvent = {
        id: `evt_${randomUUID()}`, configBaseId: delta.configBaseId, quantity: delta.quantityDelta,
        pageId: delta.pageId, slotId: delta.slotId,
        ...(activeRun ? { mapRunId: activeRun.id } : {}),
        ...(price !== undefined ? { estimatedValue: price * delta.quantityDelta } : {}),
        pickedUpAt: now()
      };
      repository.upsertLootEvent(event);
      lootEvents.emit('event', event);
    }
    return;
  }

  const priceUpdate = parseExchangeSearchPriceLine(parsed.message);
  if (priceUpdate) {
    const entry: PriceEntry = { id: `price_${randomUUID()}`, configBaseId: priceUpdate.configBaseId, price: priceUpdate.price, observedAt: now() };
    repository.upsertPriceEntry(entry);
  }
}

function startTailer(): LogTailerHandle | undefined {
  const logPath = process.env.TORCHLIGHT_LOG_PATH?.trim();
  if (!logPath) {
    console.log('TORCHLIGHT_LOG_PATH is not set — loot tracking is idle until it is configured.');
    return undefined;
  }
  if (!existsSync(logPath)) {
    console.log(`TORCHLIGHT_LOG_PATH (${logPath}) does not exist yet — loot tracking is idle until the file appears.`);
    return undefined;
  }
  console.log(`Tailing ${logPath} for loot events.`);
  return tailLogFile(logPath, handleLogLine);
}
const tailerHandle = startTailer();

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body, null, 2));
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  try {
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      return send(res, 200, { status: 'ok', service: 'local-agent', version: '0.1.0' });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/loot/recent') {
      const since = url.searchParams.get('since') ?? undefined;
      const snapshot = repository.getLootFeedSnapshot();
      const recentEvents = since ? repository.listRecentLootEvents(since) : snapshot.recentEvents;
      return send(res, 200, { data: { ...snapshot, recentEvents } });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/loot/events') {
      res.socket?.setNoDelay(true);
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'access-control-allow-origin': '*'
      });
      // Real bug, caught by live-timing a test rather than assumed: Node doesn't actually put
      // the header block on the wire after writeHead() — it waits for the first res.write()/
      // res.end() to piggyback the headers onto that same packet. An SSE connection often has
      // no real data to send for a while, so without flushHeaders() the client's fetch()/
      // EventSource never even sees a response until the first heartbeat (15s later) forces a
      // write. Confirmed: the client-side fetch() call itself — not the data stream after it —
      // was the thing taking exactly ~15000ms.
      res.flushHeaders();

      let seq = 0;
      const listener = (event: LootEvent): void => {
        seq += 1;
        res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      lootEvents.on('event', listener);

      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        lootEvents.off('event', listener);
      });
      return;
    }

    return send(res, 404, { error: { code: 'NOT_FOUND', message: `${req.method} ${url.pathname} is not implemented yet.` } });
  } catch (error) {
    return send(res, 400, { error: { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Unknown error' } });
  }
});

// Tie the tailer's lifecycle to the server's — its setInterval otherwise runs forever and
// keeps the Node process alive even after the HTTP server itself has been closed (a real bug
// caught by the test suite hanging on shutdown rather than exiting cleanly).
server.on('close', () => tailerHandle?.stop());

const port = Number(process.env.LOCAL_AGENT_PORT ?? 4777);
server.listen(port, '127.0.0.1', () => console.log(`Torchlight Companion local-agent listening on http://127.0.0.1:${port}`));

export { server };
