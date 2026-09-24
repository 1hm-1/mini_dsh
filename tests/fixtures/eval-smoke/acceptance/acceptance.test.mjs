// HIDDEN_ACCEPTANCE_CANARY_M4_1: evaluator fixture, never copied to Agent workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum } from './sum.mjs';

test('sum handles zero and negative numbers', () => {
  assert.equal(sum(0, 7), 7);
  assert.equal(sum(-3, 2), -1);
});
