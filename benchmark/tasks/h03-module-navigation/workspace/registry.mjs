import { matchStatic } from './routes/static.mjs';
import { matchDynamic } from './routes/dynamic.mjs';
import { fallbackResult } from './routes/fallback.mjs';

export function resolveFromRegistry(path, records) {
  if (typeof path !== 'string' || !path.startsWith('/') || !path) throw new TypeError('path must be absolute');
  for (const record of records) {
    if (record.kind === 'fallback') return fallbackResult(record);
    if (record.kind === 'dynamic') {
      const params = matchDynamic(record.pattern, path);
      if (params) return { route: record.route, params };
    }
    if (record.kind === 'static' && matchStatic(record.path, path)) return { route: record.route, params: {} };
  }
  return null;
}
