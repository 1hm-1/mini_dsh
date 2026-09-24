import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, formatConfig, formatLegacy } from './src/index.mjs';
import { DEFAULTS } from './src/defaults.mjs';

test('file partial network override retains retries', () => {
  assert.deepEqual(resolveConfig({ file: { network: { endpoint: 'api' } } }).network, { endpoint: 'api', retries: 3 });
});
test('env precedence combines file and defaults at both nested levels', () => {
  const result = resolveConfig({ file: { network: { endpoint: 'file', retries: 8 }, ui: { theme: 'dark' } },
    env: { APP_ENDPOINT: 'env', APP_COMPACT: 'true' } });
  assert.deepEqual(result, { network: { endpoint: 'env', retries: 8 }, ui: { theme: 'dark', compact: true }, enabled: true });
});
test('env false and zero override truthy file values', () => {
  const result = resolveConfig({ file: { enabled: true, network: { retries: 8 }, ui: { compact: true } },
    env: { APP_ENABLED: 'false', APP_RETRIES: '0', APP_COMPACT: 'false' } });
  assert.equal(result.enabled, false);
  assert.equal(result.network.retries, 0);
  assert.equal(result.ui.compact, false);
});
test('all supported env keys map with exact string conversions', () => {
  const result = resolveConfig({ env: { APP_ENDPOINT: 'edge', APP_RETRIES: '12', APP_THEME: 'night', APP_COMPACT: 'true', APP_ENABLED: 'false' } });
  assert.deepEqual(result, { network: { endpoint: 'edge', retries: 12 }, ui: { theme: 'night', compact: true }, enabled: false });
});
test('invalid recognized env values throw TypeError', () => {
  for (const env of [{ APP_RETRIES: '-1' }, { APP_RETRIES: '2.5' }, { APP_RETRIES: '9007199254740992' },
    { APP_ENABLED: 'yes' }, { APP_COMPACT: '0' }, { APP_THEME: '' }]) {
    assert.throws(() => resolveConfig({ env }), TypeError);
  }
});
test('leading-zero decimal retries normalize to a safe number', () => {
  assert.equal(resolveConfig({ env: { APP_RETRIES: '00012' } }).network.retries, 12);
  assert.equal(resolveConfig({ env: { APP_RETRIES: '9007199254740991' } }).network.retries, Number.MAX_SAFE_INTEGER);
});
test('input objects, nested references and exported defaults remain unchanged', () => {
  const file = { network: { endpoint: 'file' }, ui: { theme: 'dark' } };
  const env = { APP_RETRIES: '0' };
  const before = structuredClone(DEFAULTS);
  const result = resolveConfig({ file, env });
  result.network.endpoint = 'changed';
  result.ui.theme = 'changed';
  assert.deepEqual(file, { network: { endpoint: 'file' }, ui: { theme: 'dark' } });
  assert.deepEqual(env, { APP_RETRIES: '0' });
  assert.deepEqual(DEFAULTS, before);
});
test('consecutive calls do not leak prior configuration', () => {
  resolveConfig({ file: { network: { endpoint: 'first' } }, env: { APP_ENABLED: 'false' } });
  assert.deepEqual(resolveConfig(), { network: { endpoint: 'localhost', retries: 3 }, ui: { theme: 'light', compact: false }, enabled: true });
});
test('legacy and extended formatting keep exact old prefix', () => {
  const result = resolveConfig({ env: { APP_RETRIES: '0', APP_ENABLED: 'false', APP_COMPACT: 'true' } });
  assert.equal(formatLegacy(result), 'endpoint=localhost;retries=0;enabled=off');
  assert.equal(formatConfig(result), 'endpoint=localhost;retries=0;enabled=off;theme=light;compact=yes');
});
test('invalid layer objects and invalid final fields fail', () => {
  assert.throws(() => resolveConfig({ file: [] }), TypeError);
  assert.throws(() => resolveConfig({ env: null }), TypeError);
  assert.throws(() => resolveConfig({ file: { network: { retries: -1 } } }), TypeError);
  assert.throws(() => resolveConfig({ file: { network: { retries: Number.MAX_SAFE_INTEGER + 1 } } }), TypeError);
});
