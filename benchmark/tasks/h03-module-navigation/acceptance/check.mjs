import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from './entry.mjs';
import { resolveFromRegistry } from './registry.mjs';
import { legacyResolve } from './legacy.mjs';
import { routeCli } from './adapters/cli.mjs';
import { routeHttp } from './adapters/http.mjs';
import { parentPath } from './utils/path.mjs';
import { routeLabel } from './analytics.mjs';

test('static wins despite dynamic and fallback declaration order', () => {
  assert.deepEqual(dispatch('/users/new'), { route: 'user-new', params: {} });
  assert.deepEqual(dispatch('/health'), { route: 'health', params: {} });
});
test('dynamic segment keeps original case', () => {
  assert.deepEqual(dispatch('/posts/Hello'), { route: 'post-detail', params: { slug: 'Hello' } });
  assert.deepEqual(dispatch('/users/ada'), { route: 'user-detail', params: { id: 'ada' } });
});
test('fallback comes only after all candidates', () => {
  assert.deepEqual(dispatch('/users/new/'), { route: 'not-found', params: {} });
  assert.deepEqual(dispatch('/unknown'), { route: 'not-found', params: {} });
});
test('matching dynamic routes keep first declaration', () => {
  const records = [{ kind: 'dynamic', pattern: '/x/:a', route: 'first' }, { kind: 'dynamic', pattern: '/x/:b', route: 'second' }];
  assert.deepEqual(resolveFromRegistry('/x/y', records), { route: 'first', params: { a: 'y' } });
});
test('legacy compatibility export stays separate', () => {
  assert.deepEqual(legacyResolve('/old/help'), { route: 'legacy-help', params: {} });
  assert.equal(legacyResolve('/health'), null);
  assert.deepEqual(dispatch('/old/help'), { route: 'not-found', params: {} });
});
test('invalid entry path errors and records are not mutated', () => {
  for (const input of [null, '', 'users/new']) assert.throws(() => dispatch(input), TypeError);
  const records = Object.freeze([Object.freeze({ kind: 'static', path: '/x', route: 'x' })]);
  assert.deepEqual(resolveFromRegistry('/x', records), { route: 'x', params: {} });
});
test('unrelated adapters and utilities keep their exported behavior', () => {
  assert.equal(routeCli('/users/7'), 'user-detail:7');
  assert.deepEqual(routeHttp('/health?q=one&q=two').query, [['q', 'one'], ['q', 'two']]);
  assert.deepEqual(routeHttp('/health').headers, { 'content-type': 'application/json' });
  assert.equal(parentPath('/users/7'), '/users');
  assert.equal(routeLabel(null), 'unmatched');
});

test('returned params are fresh across calls', () => {
  const first = dispatch('/users/Ada');
  first.params.id = 'changed';
  assert.deepEqual(dispatch('/users/Ada'), { route: 'user-detail', params: { id: 'Ada' } });
});
