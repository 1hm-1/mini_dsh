export function readEnvLayer(env = {}) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('env must be an object');
  const network = {};
  const ui = {};
  const layer = {};
  if (env.APP_ENDPOINT) network.endpoint = env.APP_ENDPOINT;
  if (env.APP_RETRIES) network.retries = Number(env.APP_RETRIES);
  if (env.APP_THEME) ui.theme = env.APP_THEME;
  if (env.APP_COMPACT) ui.compact = env.APP_COMPACT === 'true';
  if (env.APP_ENABLED) layer.enabled = env.APP_ENABLED === 'true';
  if (Object.keys(network).length) layer.network = network;
  if (Object.keys(ui).length) layer.ui = ui;
  return layer;
}
