import { SqliteRepository } from '@torchlight-companion/db';
import { gearByConfigBaseId } from '@torchlight-companion/build-data';
import type { LootEvent, MarketPriceCheck } from '@torchlight-companion/domain';
import { diffInventorySnapshots, parseExchangeSearchPriceBlock, parseInventorySlotLine, parseUELogLine, type InventorySlotState } from '@torchlight-companion/log-parser';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tailLogFile, type LogTailerHandle } from './logTailer.js';
import { findGameLogPath } from './findGameLogPath.js';

const repository = new SqliteRepository();
const lootEvents = new EventEmitter();
lootEvents.setMaxListeners(0);
const priceChecks = new EventEmitter();
priceChecks.setMaxListeners(0);

const now = () => new Date().toISOString();

// The collector's working memory: the last known state per inventory slot, used to diff each
// incoming slot-update line against. This is intentionally separate from packages/log-parser's
// pure diffInventorySnapshots — this map is the mutable "previous snapshot" side of that call.
const knownSlotState = new Map<string, InventorySlotState>();

function slotKey(state: Pick<InventorySlotState, 'pageId' | 'slotId'>): string {
  return `${state.pageId}:${state.slotId}`;
}

/** Attach the resolved item (name/slot), derived from configBaseId via the
 * scraped catalog, so drops read as "Acolyte's Crown" not "Item #3802". */
function enrich(event: LootEvent): LootEvent {
  const item = gearByConfigBaseId(event.configBaseId);
  return item ? { ...event, itemName: item.name, itemSlot: item.slot } : event;
}

// A price check spans multiple raw log lines (an indented socket-message tree);
// accumulate them between the XchgSearchPrice start marker and the end marker.
let priceBlock: string[] | null = null;

function handleLogLine(rawLine: string): void {
  if (priceBlock) {
    priceBlock.push(rawLine);
    if (/(?:Recv|Send)Message End/.test(rawLine)) {
      const price = parseExchangeSearchPriceBlock(priceBlock.join('\n'));
      priceBlock = null;
      if (price) {
        // NOTE: itemGoldId is a marketplace-listing id, a different id space from
        // configBaseId (see MarketPriceCheck's doc comment) -- so this can't be
        // joined to a specific drop yet. Persisted and streamed on its own.
        const check: MarketPriceCheck = {
          id: `price_${randomUUID()}`,
          itemGoldId: price.itemGoldId,
          currencies: price.currencies,
          prices: price.prices,
          checkedAt: now()
        };
        repository.upsertMarketPriceCheck(check);
        priceChecks.emit('event', check);
        console.log(
          `[price-check] item ${price.itemGoldId}: ` +
            (price.prices.length ? price.prices.join('/') : 'no listings') +
            ` (currencies ${price.currencies.join(',')})`
        );
      }
    }
    return;
  }
  if (/(?:Recv|Send)Message STT----XchgSearchPrice/.test(rawLine)) {
    priceBlock = [rawLine];
    return;
  }

  const parsed = parseUELogLine(rawLine);
  if (!parsed) return;
  const slotUpdate = parseInventorySlotLine(parsed.message);
  if (!slotUpdate) return;

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
    lootEvents.emit('event', enrich(event));
  }
}

function startTailer(): LogTailerHandle | undefined {
  const envPath = process.env.TORCHLIGHT_LOG_PATH?.trim();
  let logPath = envPath;
  if (logPath && !existsSync(logPath)) {
    console.log(`TORCHLIGHT_LOG_PATH (${logPath}) does not exist yet — loot tracking is idle until the file appears.`);
    return undefined;
  }
  if (!logPath) {
    logPath = findGameLogPath();
    if (logPath) {
      console.log(`Auto-detected game log at ${logPath} (set TORCHLIGHT_LOG_PATH to override).`);
    } else {
      console.log(
        'Could not auto-detect Torchlight Infinite\'s log file — loot tracking is idle. ' +
          'Set TORCHLIGHT_LOG_PATH to its UE_game.log path (usually under <install dir>/Saved/Logs/).'
      );
      return undefined;
    }
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
      const recentEvents = (since ? repository.listRecentLootEvents(since) : snapshot.recentEvents).map(enrich);
      return send(res, 200, { data: { ...snapshot, recentEvents } });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/prices/recent') {
      return send(res, 200, { data: repository.listRecentMarketPriceChecks() });
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

    if (req.method === 'GET' && url.pathname === '/api/v1/prices/events') {
      res.socket?.setNoDelay(true);
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'access-control-allow-origin': '*'
      });
      res.flushHeaders();

      let seq = 0;
      const listener = (check: MarketPriceCheck): void => {
        seq += 1;
        res.write(`id: ${seq}\ndata: ${JSON.stringify(check)}\n\n`);
      };
      priceChecks.on('event', listener);

      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        priceChecks.off('event', listener);
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
