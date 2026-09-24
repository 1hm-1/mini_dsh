import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from './config.mjs';

test('top-level override wins and unrelated defaults remain', () => {
  assert.deepEqual(mergeConfig({ mode: 'safe', retries: 3 }, { mode: 'fast' }),
    { mode: 'fast', retries: 3 });
});

test('nested fields merge one level', () => {
  assert.deepEqual(mergeConfig({ network: { host: 'localhost', port: 80 } }, { network: { port: 443 } }),
    { network: { host: 'localhost', port: 443 } });
});

test('false and zero are real overrides', () => {
  assert.deepEqual(mergeConfig({ enabled: true, retries: 3 }, { enabled: false, retries: 0 }),
    { enabled: false, retries: 0 });
});
