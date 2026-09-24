export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !config.network || typeof config.network !== 'object' || Array.isArray(config.network)
    || !config.ui || typeof config.ui !== 'object' || Array.isArray(config.ui)
    || typeof config.network.endpoint !== 'string' || !config.network.endpoint
    || !Number.isInteger(config.network.retries) || config.network.retries < 0
    || typeof config.ui.theme !== 'string' || !config.ui.theme
    || typeof config.ui.compact !== 'boolean' || typeof config.enabled !== 'boolean') {
    throw new TypeError('invalid resolved config');
  }
  return config;
}
