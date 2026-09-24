import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrders } from './parser.mjs';
import { buildReport } from './report.mjs';

test('parser trims fields and handles CRLF', () => {
  assert.deepEqual(parseOrders(' A-1 , 2 , 150\r\nB2,1,0\r\n'), [
    { sku: 'A-1', quantity: 2, unitPriceCents: 150 },
    { sku: 'B2', quantity: 1, unitPriceCents: 0 },
  ]);
});
test('report combines duplicate SKU and computes cents', () => {
  assert.deepEqual(buildReport('B,1,100\nA,2,50\nB,3,100'), {
    items: [{ sku: 'A', quantity: 2, totalCents: 100 }, { sku: 'B', quantity: 4, totalCents: 400 }],
    totalUnits: 6, totalCents: 500,
  });
});
