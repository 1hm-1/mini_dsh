import { legacyResolve } from './legacy.mjs';
import { resolveFromRegistry } from './registry.mjs';
import { defaultRoutes } from './fixtures/routes.mjs';

export function dispatch(path) {
  return legacyResolve(path) ?? resolveFromRegistry(path, defaultRoutes);
}
