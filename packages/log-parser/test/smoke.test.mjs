import test from 'node:test';
import assert from 'node:assert/strict';
import { diffInventorySnapshots, parseExchangeSearchPriceBlock, parseInventorySlotLine, parseUELogLine } from '../dist/index.js';

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

// parseInventorySlotLine / parseExchangeSearchPriceBlock — VERIFIED against a real log.

test('parseInventorySlotLine reads the REAL game format (spaces around =, Num quantity)', () => {
  const result = parseInventorySlotLine(
    '[Game] BagMgr@:Modfy BagItem PageId = 100 SlotId = 52 ConfigBaseId = 3802 Num = 1'
  );
  assert.deepEqual(result, { pageId: 100, slotId: 52, configBaseId: 3802, quantity: 1 });
});

test('parseInventorySlotLine still reads the compact key=value form (Count/Quantity)', () => {
  assert.deepEqual(parseInventorySlotLine('PageId=0 SlotId=5 ConfigBaseId=1001 Count=1'), {
    pageId: 0, slotId: 5, configBaseId: 1001, quantity: 1
  });
  assert.deepEqual(parseInventorySlotLine('PageId=2 SlotId=10 ConfigBaseId=42 Quantity=3'), {
    pageId: 2, slotId: 10, configBaseId: 42, quantity: 3
  });
});

test('parseInventorySlotLine returns undefined when a required field is missing', () => {
  assert.equal(parseInventorySlotLine('PageId=0 SlotId=5 Count=1'), undefined);
  assert.equal(parseInventorySlotLine('unrelated message'), undefined);
});

test('parseExchangeSearchPriceBlock reads the real multi-line XchgSearchPrice block', () => {
  const block = [
    '----Socket RecvMessage STT----XchgSearchPrice----SynId = 1266',
    '+errCode',
    '+itemGoldId [1419]',
    '+prices+1+currency [100300]',
    '|      +2+currency [100200]',
    '----Socket RecvMessage End----'
  ].join('\n');
  const result = parseExchangeSearchPriceBlock(block);
  assert.equal(result.itemGoldId, 1419);
  assert.deepEqual(result.currencies, [100300, 100200]);
  assert.deepEqual(result.prices, []); // this sample returned no listings
});

test('parseExchangeSearchPriceBlock extracts amounts when listings are present', () => {
  const block = 'XchgSearchPrice\n+itemGoldId [42]\n+prices+1+currency [100300]+low [250]+high [900]';
  const result = parseExchangeSearchPriceBlock(block);
  assert.deepEqual(result.prices, [250, 900]);
});

test('parseExchangeSearchPriceBlock ignores non-price blocks', () => {
  assert.equal(parseExchangeSearchPriceBlock('some other socket message'), undefined);
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
