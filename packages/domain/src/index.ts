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
