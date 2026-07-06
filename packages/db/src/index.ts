import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LootEvent, LootFeedSnapshot, MapRun, PriceEntry } from '@torchlight-companion/domain';

export function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  const path = configured || join(homedir(), '.torchlight-companion', 'torchlight-companion.db');
  return path.replace(/^~/, homedir());
}

interface LootEventRow {
  id: string;
  config_base_id: number;
  quantity: number;
  page_id: number;
  slot_id: number;
  map_run_id: string | null;
  estimated_value: number | null;
  picked_up_at: string;
}

interface MapRunRow {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  total_value: number;
}

function rowToLootEvent(row: LootEventRow): LootEvent {
  return {
    id: row.id, configBaseId: row.config_base_id, quantity: row.quantity,
    pageId: row.page_id, slotId: row.slot_id,
    ...(row.map_run_id ? { mapRunId: row.map_run_id } : {}),
    ...(row.estimated_value !== null ? { estimatedValue: row.estimated_value } : {}),
    pickedUpAt: row.picked_up_at
  };
}

function rowToMapRun(row: MapRunRow): MapRun {
  return {
    id: row.id, status: row.status as MapRun['status'], startedAt: row.started_at,
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    totalValue: row.total_value
  };
}

export class SqliteRepository {
  private readonly db: DatabaseSync;

  constructor(databasePath: string = resolveDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS loot_events (
        id TEXT PRIMARY KEY,
        config_base_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        page_id INTEGER NOT NULL,
        slot_id INTEGER NOT NULL,
        map_run_id TEXT,
        estimated_value REAL,
        picked_up_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_loot_events_picked_up_at ON loot_events(picked_up_at DESC);
      CREATE INDEX IF NOT EXISTS idx_loot_events_map_run_id ON loot_events(map_run_id);

      CREATE TABLE IF NOT EXISTS map_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        total_value REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_map_runs_status ON map_runs(status);

      CREATE TABLE IF NOT EXISTS price_entries (
        id TEXT PRIMARY KEY,
        config_base_id INTEGER NOT NULL,
        price REAL NOT NULL,
        observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_price_entries_config_base_id ON price_entries(config_base_id, observed_at DESC);
    `);
  }

  upsertLootEvent(event: LootEvent): void {
    this.db.prepare(`
      INSERT INTO loot_events (id, config_base_id, quantity, page_id, slot_id, map_run_id, estimated_value, picked_up_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        config_base_id = excluded.config_base_id, quantity = excluded.quantity,
        page_id = excluded.page_id, slot_id = excluded.slot_id,
        map_run_id = excluded.map_run_id, estimated_value = excluded.estimated_value,
        picked_up_at = excluded.picked_up_at
    `).run(
      event.id, event.configBaseId, event.quantity, event.pageId, event.slotId,
      event.mapRunId ?? null, event.estimatedValue ?? null, event.pickedUpAt
    );
  }

  listRecentLootEvents(sinceIso?: string, limit = 200): LootEvent[] {
    const rows = sinceIso
      ? this.db.prepare('SELECT * FROM loot_events WHERE picked_up_at > ? ORDER BY picked_up_at DESC LIMIT ?').all(sinceIso, limit)
      : this.db.prepare('SELECT * FROM loot_events ORDER BY picked_up_at DESC LIMIT ?').all(limit);
    return (rows as unknown as LootEventRow[]).map(rowToLootEvent);
  }

  upsertMapRun(run: MapRun): void {
    this.db.prepare(`
      INSERT INTO map_runs (id, status, started_at, ended_at, total_value)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, started_at = excluded.started_at,
        ended_at = excluded.ended_at, total_value = excluded.total_value
    `).run(run.id, run.status, run.startedAt, run.endedAt ?? null, run.totalValue);
  }

  getActiveMapRun(): MapRun | undefined {
    const row = this.db.prepare("SELECT * FROM map_runs WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get() as unknown as MapRunRow | undefined;
    return row ? rowToMapRun(row) : undefined;
  }

  upsertPriceEntry(entry: PriceEntry): void {
    this.db.prepare(`
      INSERT INTO price_entries (id, config_base_id, price, observed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET price = excluded.price, observed_at = excluded.observed_at
    `).run(entry.id, entry.configBaseId, entry.price, entry.observedAt);
  }

  latestPriceForItem(configBaseId: number): number | undefined {
    const row = this.db.prepare('SELECT price FROM price_entries WHERE config_base_id = ? ORDER BY observed_at DESC LIMIT 1').get(configBaseId) as unknown as { price: number } | undefined;
    return row?.price;
  }

  computeNetWorth(): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(estimated_value), 0) AS total FROM loot_events').get() as unknown as { total: number };
    return row.total;
  }

  getLootFeedSnapshot(): LootFeedSnapshot {
    const activeRun = this.getActiveMapRun();
    return {
      recentEvents: this.listRecentLootEvents(),
      ...(activeRun ? { activeRun } : {}),
      netWorth: this.computeNetWorth()
    };
  }

  close(): void {
    this.db.close();
  }
}
