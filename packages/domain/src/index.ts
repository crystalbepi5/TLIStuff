export type ISODateTime = string;

export interface LootEvent {
  id: string;
  configBaseId: number;
  quantity: number;
  pageId: number;
  slotId: number;
  mapRunId?: string;
  estimatedValue?: number;
  pickedUpAt: ISODateTime;
  /** Resolved from `configBaseId` via the item catalog (build-data). Not
   * persisted — it's derivable — so it's attached when events are served. */
  itemName?: string;
  itemSlot?: string;
}

export type MapRunStatus = 'active' | 'completed';

export interface MapRun {
  id: string;
  status: MapRunStatus;
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  totalValue: number;
}

export interface PriceEntry {
  id: string;
  configBaseId: number;
  price: number;
  observedAt: ISODateTime;
}

export interface NetWorthSnapshot {
  id: string;
  totalValue: number;
  computedAt: ISODateTime;
}

export interface LootFeedSnapshot {
  recentEvents: LootEvent[];
  activeRun?: MapRun;
  netWorth: number;
}

/**
 * A raw in-game marketplace price check, keyed by `itemGoldId` (the
 * marketplace's own item-listing id). NOTE: itemGoldId is NOT the same id
 * space as `configBaseId` (confirmed distinct in the one verified sample —
 * see packages/log-parser), so this cannot yet be joined to a specific
 * `LootEvent`/`GearBase` to compute `estimatedValue` for a drop. Surfaced
 * on its own until a real log session correlates the two id spaces.
 */
export interface MarketPriceCheck {
  id: string;
  itemGoldId: number;
  currencies: number[];
  prices: number[];
  checkedAt: ISODateTime;
}
