// This package is split deliberately into two confidence tiers:
//
// CONFIRMED: parseUELogLine and diffInventorySnapshots. Unreal Engine's log line format
// (`[Date-Time:Millis][Frame]Category: Verbosity: Message`) is a well-documented, generic
// engine convention, not something specific to this game — and diffInventorySnapshots is
// pure domain logic that doesn't depend on the exact log format at all.
//
// UNVERIFIED — BEST GUESS PENDING A REAL LOG SAMPLE: parseInventorySlotLine and
// parseExchangeSearchPriceLine. No real UE_game.log sample was available while writing this
// (see project memory/plan) — these two functions guess at Torchlight Infinite's specific
// message content shape based on TITrack's publicly described approach (PageId/SlotId/
// ConfigBaseId inventory deltas, XchgSearchPrice marketplace events) and MUST be corrected
// against a real log sample before this package can be trusted in production. Everything
// else in this file does not depend on these two functions being correct.

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
  for (const match of message.matchAll(/(\w+)=([^\s,]+)/g)) {
    const [, key, value] = match;
    if (key && value !== undefined) pairs[key] = value;
  }
  return pairs;
}

/** UNVERIFIED — see file header. Best guess: a key=value line naming PageId/SlotId/ConfigBaseId/Count. */
export function parseInventorySlotLine(message: string): InventorySlotState | undefined {
  const kv = extractKeyValuePairs(message);
  const pageId = Number(kv.PageId);
  const slotId = Number(kv.SlotId);
  const configBaseId = Number(kv.ConfigBaseId);
  const quantity = Number(kv.Count ?? kv.Quantity);
  if ([pageId, slotId, configBaseId, quantity].some((n) => Number.isNaN(n))) return undefined;
  return { pageId, slotId, configBaseId, quantity };
}

export interface ExchangeSearchPrice {
  configBaseId: number;
  price: number;
}

/** UNVERIFIED — see file header. Best guess: an XchgSearchPrice line naming ConfigBaseId/Price. */
export function parseExchangeSearchPriceLine(message: string): ExchangeSearchPrice | undefined {
  if (!message.includes('XchgSearchPrice')) return undefined;
  const kv = extractKeyValuePairs(message);
  const configBaseId = Number(kv.ConfigBaseId);
  const price = Number(kv.Price);
  if (Number.isNaN(configBaseId) || Number.isNaN(price)) return undefined;
  return { configBaseId, price };
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
