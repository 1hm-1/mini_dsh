export function legacyResolve(path) {
  return path === '/old/help' ? { route: 'legacy-help', params: {} } : null;
}
