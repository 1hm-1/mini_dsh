import { dispatch } from '../entry.mjs';
import { queryPairs } from '../utils/query.mjs';
import { contentType } from '../utils/headers.mjs';

export function routeHttp(url) {
  const parsed = new URL(url, 'https://local.example');
  return { match: dispatch(parsed.pathname), query: queryPairs(parsed.search), headers: contentType('application/json') };
}
