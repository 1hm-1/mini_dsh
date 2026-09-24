import { DEFAULTS } from './defaults.mjs';
import { readFileLayer } from './file-config.mjs';
import { readEnvLayer } from './env-config.mjs';
import { mergeLayers } from './merge.mjs';
import { validateConfig } from './validate.mjs';
export { formatConfig } from './format.mjs';
export { formatLegacy } from './legacy.mjs';

export function resolveConfig({ file = {}, env = {} } = {}) {
  return validateConfig(mergeLayers(DEFAULTS, readFileLayer(file), readEnvLayer(env)));
}
