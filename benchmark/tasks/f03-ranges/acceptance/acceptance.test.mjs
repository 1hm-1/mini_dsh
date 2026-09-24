import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRanges } from './ranges.mjs';

test('empty input', () => assert.deepEqual(mergeRanges([]), []));
test('contained interval cannot shorten outer end', () => {
  assert.deepEqual(mergeRanges([[1, 10], [3, 4], [12, 13]]), [[1, 10], [12, 13]]);
});
test('separate and negative intervals remain separate', () => {
  assert.deepEqual(mergeRanges([[3, 4], [-3, -1], [0, 0], [8, 9]]), [[-3, 0], [3, 4], [8, 9]]);
});
test('frozen input and pairs are not mutated or returned directly', () => {
  const first = Object.freeze([3, 4]); const second = Object.freeze([1, 2]);
  const input = Object.freeze([first, second]);
  const output = mergeRanges(input);
  assert.deepEqual(output, [[1, 4]]);
  assert.notEqual(output[0], first);
  assert.deepEqual(input, [first, second]);
});
test('malformed input is rejected', () => {
  for (const invalid of [null, [[2]], [[2, 1]], [[1.5, 2]], [[0, Infinity]], [[0, 1, 2]]]) {
    assert.throws(() => mergeRanges(invalid), TypeError);
  }
});
