import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRanges } from './ranges.mjs';

test('unsorted overlaps merge in order', () => {
  assert.deepEqual(mergeRanges([[8, 10], [1, 3], [2, 5]]), [[1, 5], [8, 10]]);
});
test('adjacent integer intervals touch', () => {
  assert.deepEqual(mergeRanges([[5, 7], [2, 4]]), [[2, 7]]);
});
