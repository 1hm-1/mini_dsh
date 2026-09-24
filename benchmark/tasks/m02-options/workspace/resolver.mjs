import { DEFAULT_OPTIONS } from './defaults.mjs';

export function resolveOptions(overrides = {}) {
  Object.assign(DEFAULT_OPTIONS, overrides);
  return DEFAULT_OPTIONS;
}
