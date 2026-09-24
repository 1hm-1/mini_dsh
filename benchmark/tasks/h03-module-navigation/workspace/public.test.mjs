import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from './entry.mjs';
import { resolveFromRegistry } from './registry.mjs';
import { routeHttp } from './adapters/http.mjs';

test('entry selects static route before earlier dynamic route', () => {
  assert.deepEqual(dispatch('/users/new'), { route: 'user-new', params: {} });
});
test('entry still resolves dynamic path segments', () => {
  assert.deepEqual(dispatch('/users/Ada'), { route: 'user-detail', params: { id: 'Ada' } });
});
test('fallback is last and adapter uses the same entry', () => {
  assert.deepEqual(dispatch('/missing'), { route: 'not-found', params: {} });
  assert.deepEqual(routeHttp('/health?q=one').match, { route: 'health', params: {} });
});
test('supplied registry works without fallback', () => {
  assert.equal(resolveFromRegistry('/x', []), null);
});
