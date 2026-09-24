import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS } from './defaults.mjs';
import { resolveOptions } from './resolver.mjs';
import { formatValue } from './formatter.mjs';

test('defaults and old call forms remain', () => {
  assert.deepEqual(DEFAULT_OPTIONS, { precision: 2, prefix: '', unitLabel: '' });
  assert.equal(formatValue(12.345), '12.35');
  assert.equal(formatValue(12.34, { precision: 1, prefix: '~' }), '~12.3');
});
test('new option passes through resolver and formatter', () => {
  assert.deepEqual(resolveOptions({ unitLabel: 'kg' }), { precision: 2, prefix: '', unitLabel: 'kg' });
  assert.equal(formatValue(12.3, { unitLabel: 'kg' }), '12.30 kg');
});
