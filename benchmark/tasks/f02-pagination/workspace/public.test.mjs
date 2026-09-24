import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from './pagination.mjs';

test('first page uses 1-based numbering', () => {
  assert.deepEqual(paginate(['a', 'b', 'c', 'd'], 1, 2), { items: ['a', 'b'], totalPages: 2, nextPage: 2 });
});
test('last page has no successor', () => {
  assert.deepEqual(paginate([1, 2, 3], 2, 2), { items: [3], totalPages: 2, nextPage: null });
});
