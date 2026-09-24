import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from './config.mjs';

test('partial nested override preserves sibling fields', () => {
  assert.deepEqual(mergeConfig({ ui: { theme: 'light', density: 'normal' }, ready: true },
    { ui: { density: 'compact' } }), { ui: { theme: 'light', density: 'compact' }, ready: true });
});
test('defaults and overrides remain unchanged', () => {
  const defaults = { ui: { theme: 'light' }, retries: 2 };
  const overrides = { ui: { density: 'compact' } };
  mergeConfig(defaults, overrides);
  assert.deepEqual(defaults, { ui: { theme: 'light' }, retries: 2 });
  assert.deepEqual(overrides, { ui: { density: 'compact' } });
});
test('nested outputs do not alias either input', () => {
  const defaults = { left: { x: 1 } };
  const overrides = { right: { y: 2 } };
  const result = mergeConfig(defaults, overrides);
  result.left.x = 9;
  result.right.y = 8;
  assert.deepEqual(defaults, { left: { x: 1 } });
  assert.deepEqual(overrides, { right: { y: 2 } });
});
test('consecutive calls with shared defaults are independent', () => {
  const defaults = { port: 80, flags: { trace: true, debug: false } };
  const first = mergeConfig(defaults, { flags: { debug: true } });
  const second = mergeConfig(defaults, { port: 90 });
  assert.deepEqual(first.flags, { trace: true, debug: true });
  assert.deepEqual(second, { port: 90, flags: { trace: true, debug: false } });
});
test('null override replaces a nested object', () => {
  assert.deepEqual(mergeConfig({ option: { enabled: true } }, { option: null }), { option: null });
});
test('invalid arguments throw TypeError', () => {
  assert.throws(() => mergeConfig(null), TypeError);
  assert.throws(() => mergeConfig({}, []), TypeError);
});
test('JSON special names remain own data keys during nested merging', () => {
  const defaults = JSON.parse('{"__proto__":{"left":1},"constructor":{"first":true}}');
  const overrides = JSON.parse('{"__proto__":{"right":2},"constructor":{"second":false}}');
  const result = mergeConfig(defaults, overrides);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__')?.value, { left: 1, right: 2 });
  assert.deepEqual(result.constructor, { first: true, second: false });
  assert.deepEqual(defaults, JSON.parse('{"__proto__":{"left":1},"constructor":{"first":true}}'));
});
test('inherited constructor is not treated as a default field', () => {
  const override = JSON.parse('{"constructor":{"enabled":true}}');
  const result = mergeConfig({}, override);
  assert.deepEqual(result.constructor, { enabled: true });
  assert.equal(Object.hasOwn(result, 'constructor'), true);
});
