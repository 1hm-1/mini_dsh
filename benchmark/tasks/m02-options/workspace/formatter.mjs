import { resolveOptions } from './resolver.mjs';

export function formatValue(value, overrides = {}) {
  const options = resolveOptions(overrides);
  return options.prefix + value.toFixed(options.precision);
}
