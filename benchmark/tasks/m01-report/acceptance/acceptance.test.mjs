import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrders } from './parser.mjs';
import { buildReport } from './report.mjs';

test('blank lines ignored and empty input gives empty report', () => {
  assert.deepEqual(parseOrders('  \r\n\nA,1,2\n  '), [{ sku: 'A', quantity: 1, unitPriceCents: 2 }]);
  assert.deepEqual(buildReport(' \r\n'), { items: [], totalUnits: 0, totalCents: 0 });
});
test('repeated rows remain distinct in parser but combine in report', () => {
  assert.deepEqual(parseOrders('A,1,3\nA,2,4').length, 2);
  assert.deepEqual(buildReport('A,1,3\nA,2,4'), { items: [{ sku: 'A', quantity: 3, totalCents: 11 }], totalUnits: 3, totalCents: 11 });
});
test('invalid row fields are rejected', () => {
  assert.throws(() => parseOrders(null), TypeError);
  for (const row of ['a,1,2', 'A,0,2', 'A,-1,2', 'A,1,1.5', 'A,1', 'A,1,2,3', 'A, 1x,2']) {
    assert.throws(() => parseOrders(row), Error);
  }
});
test('overflow in row and aggregate is rejected', () => {
  assert.throws(() => parseOrders(`A,2,${Number.MAX_SAFE_INTEGER}`), RangeError);
  assert.throws(() => buildReport(`A,${Number.MAX_SAFE_INTEGER},1\nA,1,1`), RangeError);
});
test('separate calls have no shared state', () => {
  buildReport('A,2,3');
  assert.deepEqual(buildReport('B,1,4'), { items: [{ sku: 'B', quantity: 1, totalCents: 4 }], totalUnits: 1, totalCents: 4 });
});
