import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText } from './normalize.mjs';

test('empty string remains empty', () => assert.equal(normalizeText(''), ''));
test('whitespace-only string becomes empty', () => assert.equal(normalizeText(' \t\n '), ''));
test('mixed runs use exactly one ASCII space', () => {
  assert.equal(normalizeText(' \n Alpha\t  BETA\r\n gamma '), 'alpha beta gamma');
});
test('already normalized input is stable', () => assert.equal(normalizeText('a b c'), 'a b c'));
test('non-string input throws TypeError', () => {
  assert.throws(() => normalizeText(null), TypeError);
  assert.throws(() => normalizeText(42), TypeError);
});
