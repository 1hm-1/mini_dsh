import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCounter } from './counter.mjs';

test('omitted initial starts at zero', () => assert.equal(createCounter().value(), 0));
test('creating a later counter does not reset an earlier one', () => {
  const first = createCounter(7);
  const second = createCounter(-2);
  assert.equal(first.value(), 7);
  assert.equal(second.value(), -2);
});
test('updates remain isolated across alternating calls', () => {
  const a = createCounter(1);
  const b = createCounter(10);
  assert.equal(a.increment(3), 4);
  assert.equal(b.decrement(2), 8);
  assert.equal(a.decrement(), 3);
  assert.equal(b.value(), 8);
});
test('negative finite step reverses direction', () => {
  const counter = createCounter(4);
  assert.equal(counter.increment(-2), 2);
  assert.equal(counter.decrement(-3), 5);
});
test('invalid initial and steps throw without updating', () => {
  assert.throws(() => createCounter(Infinity), TypeError);
  assert.throws(() => createCounter('1'), TypeError);
  const counter = createCounter(4);
  assert.throws(() => counter.increment(NaN), TypeError);
  assert.throws(() => counter.decrement('2'), TypeError);
  assert.equal(counter.value(), 4);
});
