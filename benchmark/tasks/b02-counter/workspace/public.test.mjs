import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCounter } from './counter.mjs';

test('initial value and default steps', () => {
  const counter = createCounter(5);
  assert.equal(counter.value(), 5);
  assert.equal(counter.increment(), 6);
  assert.equal(counter.decrement(), 5);
});

test('two counters stay independent', () => {
  const left = createCounter(2);
  const right = createCounter(9);
  assert.equal(left.increment(), 3);
  assert.equal(right.value(), 9);
  assert.equal(right.decrement(4), 5);
  assert.equal(left.value(), 3);
});

test('explicit finite steps return updated values', () => {
  const counter = createCounter();
  assert.equal(counter.increment(2.5), 2.5);
  assert.equal(counter.decrement(1.5), 1);
});
