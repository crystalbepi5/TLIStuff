// This package is split deliberately into two confidence tiers:
//
// CONFIRMED: parseUELogLine and diffInventorySnapshots. Unreal Engine's log line format
// (`[Date-Time:Millis][Frame]Category: Verbosity: Message`) is a well-documented, generic
// engine convention, not something specific to this game — and diffInventorySnapshots is
// pure domain logic that doesn't depend on the exact log format at all.
//
// VERIFIED against a real UE_game.log (SS12.5): parseInventorySlotLine matches the real
// `BagMgr@:Modfy BagItem PageId = … SlotId = … ConfigBaseId = … Num = …` format, and
// ConfigBaseId equals tlidb/tlicompendium's item id (so drops resolve to real items via
// build-data). parseExchangeSearchPriceBlock matches the multi-line XchgSearchPrice socket
// block; its price-amount fields still need a market query that returns listings to finalise
// (the verified sample returned none).

export interface UELogLine {
  timestamp: string;
  frame: number;
  category: string;
  verbosity?: string;
  message: string;
}

const UE_LOG_LINE_PATTERN =
  /^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]\[\s*(\d+)\]([A-Za-z0-9_]+):\s*(?:(Display|Warning|Error|Verbose|VeryVerbose|Log):\s*)?(.*)$/;

export function parseUELogLine(line: string): UELogLine | undefined {
  const match = UE_LOG_LINE_PATTERN.exec(line);
  if (!match) return undefined;
  const [, timestamp, frame, category, verbosity, message] = match;
  if (!timestamp || !frame || !category || message === undefined) return undefined;
  return {
    timestamp, frame: Number(frame), category,
    ...(verbosity ? { verbosity } : {}),
    message
  };
}

export interface InventorySlotState {
  pageId: number;
  slotId: number;
  configBaseId: number;
  quantity: number;
}

function extractKeyValuePairs(message: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  // Accepts both `Key=Value` and `Key = Value` — the real game logs the latter,
  // e.g. `BagMgr@:Modfy BagItem PageId = 100 SlotId = 52 ConfigBaseId = 3802 Num = 1`.
  for (const match of message.matchAll(/(\w+)\s*=\s*([^\s,]+)/g)) {
    const [, key, value] = match;
    if (key && value !== undefined) pairs[key] = value;
  }
  return pairs;
}

/**
 * VERIFIED against a real UE_game.log: the game logs inventory changes as
 * `[Game] BagMgr@:Modfy BagItem PageId = <n> SlotId = <n> ConfigBaseId = <n> Num = <n>`.
 * `Num` is the quantity; `Count`/`Quantity` are also accepted for compatibility.
 */
export function parseInventorySlotLine(message: string): InventorySlotState | undefined {
  const kv = extractKeyValuePairs(message);
  const pageId = Number(kv.PageId);
  const slotId = Number(kv.SlotId);
  const configBaseId = Number(kv.ConfigBaseId);
  const quantity = Number(kv.Num ?? kv.Count ?? kv.Quantity);
  if ([pageId, slotId, configBaseId, quantity].some((n) => Number.isNaN(n))) return undefined;
  return { pageId, slotId, configBaseId, quantity };
}

export interface ExchangeSearchPrice {
  /** The marketplace item the price was queried for (an item-listing id, NOT a
   * ConfigBaseId). */
  itemGoldId: number;
  /** Currency type ids the response quoted in. */
  currencies: number[];
  /** Price amounts, if the search returned listings. Empty when the market had
   * no matches — as in the sample this was verified against. */
  prices: number[];
}

/**
 * VERIFIED against a real UE_game.log. A price check is a multi-line socket
 * message block, so this takes the whole accumulated `RecvMessage …
 * XchgSearchPrice … RecvMessage End` block (joined), e.g.:
 *
 *   +itemGoldId [1419]
 *   +prices+1+currency [100300]
 *   |      +2+currency [100200]
 *
 * NOTE: the verified sample returned no listing amounts (empty market result),
 * so `prices` came back empty. The amount fields still need a price check that
 * returns listings to pin down — this parser extracts them opportunistically.
 */
export function parseExchangeSearchPriceBlock(block: string): ExchangeSearchPrice | undefined {
  if (!block.includes('XchgSearchPrice')) return undefined;
  const item = block.match(/itemGoldId\s*\[(\d+)\]/);
  if (!item?.[1]) return undefined;
  const currencies = [...block.matchAll(/currency\s*\[(\d+)\]/g)].map((m) => Number(m[1]));
  const prices = [...block.matchAll(/(?:price|amount|low|high)\s*\[(\d+)\]/gi)].map((m) => Number(m[1]));
  return { itemGoldId: Number(item[1]), currencies, prices };
}

export interface InventoryDelta {
  pageId: number;
  slotId: number;
  configBaseId: number;
  quantityDelta: number;
}

function slotKey(state: Pick<InventorySlotState, 'pageId' | 'slotId'>): string {
  return `${state.pageId}:${state.slotId}`;
}

/**
 * CONFIRMED — pure comparison, independent of log format. A pickup is any slot whose
 * quantity increased (or a brand-new slot with configBaseId matching what appeared).
 * Decreases (item consumed/sold/moved) are returned too, as negative deltas, so callers
 * can decide what counts as a "pickup" vs. other inventory churn.
 */
export function diffInventorySnapshots(previous: InventorySlotState[], next: InventorySlotState[]): InventoryDelta[] {
  const previousByKey = new Map(previous.map((state) => [slotKey(state), state]));
  const nextByKey = new Map(next.map((state) => [slotKey(state), state]));
  const deltas: InventoryDelta[] = [];

  for (const state of next) {
    const before = previousByKey.get(slotKey(state));
    if (!before) {
      if (state.quantity !== 0) deltas.push({ pageId: state.pageId, slotId: state.slotId, configBaseId: state.configBaseId, quantityDelta: state.quantity });
      continue;
    }
    const quantityDelta = state.quantity - before.quantity;
    if (quantityDelta !== 0) deltas.push({ pageId: state.pageId, slotId: state.slotId, configBaseId: state.configBaseId, quantityDelta });
  }

  // A slot that vanished entirely (fully consumed/sold/moved, not just reduced) never
  // appears in `next` at all, so it can only be caught by walking `previous` separately.
  for (const state of previous) {
    if (!nextByKey.has(slotKey(state))) {
      deltas.push({ pageId: state.pageId, slotId: state.slotId, configBaseId: state.configBaseId, quantityDelta: -state.quantity });
    }
  }

  return deltas;
}
