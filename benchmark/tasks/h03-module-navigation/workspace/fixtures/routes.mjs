export const defaultRoutes = Object.freeze([
  Object.freeze({ kind: 'dynamic', pattern: '/users/:id', route: 'user-detail' }),
  Object.freeze({ kind: 'fallback', route: 'not-found' }),
  Object.freeze({ kind: 'static', path: '/users/new', route: 'user-new' }),
  Object.freeze({ kind: 'static', path: '/health', route: 'health' }),
  Object.freeze({ kind: 'dynamic', pattern: '/posts/:slug', route: 'post-detail' }),
]);
