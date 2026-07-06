import test from 'node:test';
import assert from 'node:assert/strict';
import { diffInventorySnapshots, parseExchangeSearchPriceLine, parseInventorySlotLine, parseUELogLine } from '../dist/index.js';

// parseUELogLine — CONFIRMED: standard Unreal Engine log line format.

test('parseUELogLine reads a standard line with an explicit verbosity level', () => {
  const line = '[2026.07.06-12.34.56:789][123]LogInventory: Display: PageId=0 SlotId=5 ConfigBaseId=1001 Count=1';
  const result = parseUELogLine(line);
  assert.equal(result.timestamp, '2026.07.06-12.34.56:789');
  assert.equal(result.frame, 123);
  assert.equal(result.category, 'LogInventory');
  assert.equal(result.verbosity, 'Display');
  assert.equal(result.message, 'PageId=0 SlotId=5 ConfigBaseId=1001 Count=1');
});

test('parseUELogLine reads a line with no explicit verbosity level', () => {
  const line = '[2026.07.06-12.34.56:789][  0]LogTemp: something happened';
  const result = parseUELogLine(line);
  assert.equal(result.category, 'LogTemp');
  assert.equal('verbosity' in result, false);
  assert.equal(result.message, 'something happened');
});

test('parseUELogLine returns undefined for a line that does not match the UE format at all', () => {
  assert.equal(parseUELogLine('just some random text, not a log line'), undefined);
  assert.equal(parseUELogLine(''), undefined);
});

// parseInventorySlotLine / parseExchangeSearchPriceLine — UNVERIFIED best-guess parsers.

test('parseInventorySlotLine reads a well-formed key=value message', () => {
  const result = parseInventorySlotLine('PageId=0 SlotId=5 ConfigBaseId=1001 Count=1');
  assert.deepEqual(result, { pageId: 0, slotId: 5, configBaseId: 1001, quantity: 1 });
});

test('parseInventorySlotLine accepts Quantity as an alias for Count', () => {
  const result = parseInventorySlotLine('PageId=2 SlotId=10 ConfigBaseId=42 Quantity=3');
  assert.deepEqual(result, { pageId: 2, slotId: 10, configBaseId: 42, quantity: 3 });
});

test('parseInventorySlotLine returns undefined when a required field is missing', () => {
  assert.equal(parseInventorySlotLine('PageId=0 SlotId=5 Count=1'), undefined);
  assert.equal(parseInventorySlotLine('unrelated message'), undefined);
});

test('parseExchangeSearchPriceLine reads a well-formed XchgSearchPrice message', () => {
  const result = parseExchangeSearchPriceLine('XchgSearchPrice ConfigBaseId=1001 Price=12.5');
  assert.deepEqual(result, { configBaseId: 1001, price: 12.5 });
});

test('parseExchangeSearchPriceLine ignores messages that are not exchange price searches', () => {
  assert.equal(parseExchangeSearchPriceLine('PageId=0 SlotId=5 ConfigBaseId=1001 Count=1'), undefined);
});

test('parseExchangeSearchPriceLine returns undefined when fields are missing despite the marker', () => {
  assert.equal(parseExchangeSearchPriceLine('XchgSearchPrice ConfigBaseId=1001'), undefined);
});

// diffInventorySnapshots — CONFIRMED: pure comparison logic, independent of log format.

test('diffInventorySnapshots reports a brand-new slot as a positive-quantity pickup', () => {
  const deltas = diffInventorySnapshots([], [{ pageId: 0, slotId: 5, configBaseId: 1001, quantity: 1 }]);
  assert.deepEqual(deltas, [{ pageId: 0, slotId: 5, configBaseId: 1001, quantityDelta: 1 }]);
});

test('diffInventorySnapshots reports a quantity increase in an existing stack', () => {
  const previous = [{ pageId: 0, slotId: 5, configBaseId: 1001, quantity: 1 }];
  const next = [{ pageId: 0, slotId: 5, configBaseId: 1001, quantity: 3 }];
  assert.deepEqual(diffInventorySnapshots(previous, next), [{ pageId: 0, slotId: 5, configBaseId: 1001, quantityDelta: 2 }]);
});

test('diffInventorySnapshots reports a quantity decrease as a negative delta', () => {
  const previous = [{ pageId: 0, slotId: 5, configBaseId: 1001, quantity: 3 }];
  const next = [{ pageId: 0, slotId: 5, configBaseId: 1001, quantity: 1 }];
  assert.deepEqual(diffInventorySnapshots(previous, next), [{ pageId: 0, slotId: 5, configBaseId: 1001, quantityDelta: -2 }]);
});

test('diffInventorySnapshots reports a slot that vanished entirely as a full negative delta', () => {
  const previous = [{ pageId: 0, slotId: 5, configBaseId: 1001, quantity: 2 }];
  const next = [];
  assert.deepEqual(diffInventorySnapshots(previous, next), [{ pageId: 0, slotId: 5, configBaseId: 1001, quantityDelta: -2 }]);
});

test('diffInventorySnapshots reports nothing for an unchanged slot', () => {
  const state = [{ pageId: 0, slotId: 5, configBaseId: 1001, quantity: 1 }];
  assert.deepEqual(diffInventorySnapshots(state, state), []);
});

test('diffInventorySnapshots handles multiple simultaneous changes across different slots', () => {
  const previous = [
    { pageId: 0, slotId: 0, configBaseId: 1, quantity: 1 },
    { pageId: 0, slotId: 1, configBaseId: 2, quantity: 5 }
  ];
  const next = [
    { pageId: 0, slotId: 0, configBaseId: 1, quantity: 1 },
    { pageId: 0, slotId: 1, configBaseId: 2, quantity: 6 },
    { pageId: 0, slotId: 2, configBaseId: 3, quantity: 1 }
  ];
  const deltas = diffInventorySnapshots(previous, next);
  assert.equal(deltas.length, 2);
  assert.ok(deltas.some((d) => d.slotId === 1 && d.quantityDelta === 1));
  assert.ok(deltas.some((d) => d.slotId === 2 && d.quantityDelta === 1));
});
