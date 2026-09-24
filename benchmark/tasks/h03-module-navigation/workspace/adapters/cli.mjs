import { dispatch } from '../entry.mjs';
export function routeCli(path) {
  const match = dispatch(path);
  return match ? `${match.route}:${Object.values(match.params).join(',')}` : 'unmatched';
}
