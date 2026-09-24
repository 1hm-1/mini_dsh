export function mergeConfig(defaults, overrides = {}) {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)
    || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('expected configuration objects');
  }
  return Object.assign(defaults, overrides);
}
