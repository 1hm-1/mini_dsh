import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags } from './tags.mjs';

test('splits comma-separated tags', () => {
  assert.deepEqual(parseTags('red,blue,green'), ['red', 'blue', 'green']);
});

test('trims, lowercases and drops empty parts', () => {
  assert.deepEqual(parseTags('  Red , , BLUE  ,'), ['red', 'blue']);
});

test('deduplicates in first-occurrence order', () => {
  assert.deepEqual(parseTags('Alpha,beta,alpha,BETA,gamma'), ['alpha', 'beta', 'gamma']);
});
