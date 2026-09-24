export function formatLegacy(config) {
  return `endpoint=${config.network.endpoint};retries=${config.network.retries};enabled=${config.enabled ? 'on' : 'off'}`;
}
