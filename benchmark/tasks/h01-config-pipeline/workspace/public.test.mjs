import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, formatConfig, formatLegacy } from './src/index.mjs';

test('defaults resolve and old format is preserved', () => {
  const config = resolveConfig();
  assert.deepEqual(config, { network: { endpoint: 'localhost', retries: 3 }, ui: { theme: 'light', compact: false }, enabled: true });
  assert.equal(formatLegacy(config), 'endpoint=localhost;retries=3;enabled=on');
  assert.equal(formatConfig(config), 'endpoint=localhost;retries=3;enabled=on;theme=light;compact=no');
});

test('file fields merge with nested defaults', () => {
  assert.deepEqual(resolveConfig({ file: { network: { endpoint: 'api.local' }, ui: { compact: true } } }),
    { network: { endpoint: 'api.local', retries: 3 }, ui: { theme: 'light', compact: true }, enabled: true });
});

test('env wins over file, including zero and false', () => {
  const config = resolveConfig({ file: { network: { retries: 7 }, enabled: true },
    env: { APP_RETRIES: '00', APP_ENABLED: 'false' } });
  assert.equal(config.network.retries, 0);
  assert.equal(config.enabled, false);
});

test('ordinary service utilities retain their behavior', async () => {
  const [{ normalizeServiceId }, { cacheKey }, { parseLogLevel }] = await Promise.all([
    import('./src/id.mjs'), import('./src/cache-key.mjs'), import('./src/log-level.mjs')]);
  assert.equal(cacheKey(normalizeServiceId('  Billing API '), 2), 'billing-api:2');
  assert.equal(parseLogLevel('WARN'), 'warn');
});
