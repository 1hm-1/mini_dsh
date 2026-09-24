import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS } from './defaults.mjs';
import { resolveOptions } from './resolver.mjs';
import { formatValue } from './formatter.mjs';

test('default remains unchanged after overrides', () => {
  assert.equal(formatValue(5, { precision: 0, prefix: '$', unitLabel: 'each' }), '$5 each');
  assert.equal(formatValue(5), '5.00');
  assert.deepEqual(DEFAULT_OPTIONS, { precision: 2, prefix: '', unitLabel: '' });
});
test('resolver returns independent objects', () => {
  const one = resolveOptions({ prefix: '>' });
  one.prefix = '!';
  assert.deepEqual(resolveOptions(), { precision: 2, prefix: '', unitLabel: '' });
});
test('all options combine through formatter', () => {
  assert.equal(formatValue(12.34, { precision: 1, prefix: '~', unitLabel: 'kg' }), '~12.3 kg');
});
test('invalid overrides and values use specified errors', () => {
  for (const invalid of [null, [], 5, 'x']) assert.throws(() => resolveOptions(invalid), TypeError);
  assert.throws(() => resolveOptions({ extra: true }), TypeError);
  for (const invalid of [-1, 5, 1.5, NaN]) assert.throws(() => resolveOptions({ precision: invalid }), RangeError);
  assert.throws(() => resolveOptions({ prefix: 2 }), TypeError);
  assert.throws(() => resolveOptions({ unitLabel: 2 }), TypeError);
  for (const invalid of [NaN, Infinity, '2']) assert.throws(() => formatValue(invalid), TypeError);
});
