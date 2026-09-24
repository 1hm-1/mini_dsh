import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText } from './normalize.mjs';

test('trims outer whitespace and lowercases words', () => {
  assert.equal(normalizeText('  HELLO World  '), 'hello world');
});

test('collapses internal spaces', () => {
  assert.equal(normalizeText('One   TWO    Three'), 'one two three');
});

test('collapses tabs and line breaks', () => {
  assert.equal(normalizeText('\tA\n \t B\r\nC  '), 'a b c');
});
