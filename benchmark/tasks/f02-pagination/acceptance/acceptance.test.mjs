import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from './pagination.mjs';

test('empty input has no pages', () => {
  assert.deepEqual(paginate([], 1, 3), { items: [], totalPages: 0, nextPage: null });
});
test('out-of-range page preserves total count', () => {
  assert.deepEqual(paginate([1, 2, 3], 5, 2), { items: [], totalPages: 2, nextPage: null });
});
test('input and element identity stay unchanged', () => {
  const value = { id: 1 }; const source = Object.freeze([value, { id: 2 }]);
  const result = paginate(source, 1, 1);
  assert.notEqual(result.items, source);
  assert.equal(result.items[0], value);
  assert.deepEqual(source, [value, { id: 2 }]);
});
test('invalid inputs use specified error classes', () => {
  assert.throws(() => paginate(null, 1, 2), TypeError);
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => paginate([], invalid, 2), RangeError);
    assert.throws(() => paginate([], 1, invalid), RangeError);
  }
});
