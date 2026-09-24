export function cacheKey(serviceId, revision) {
  if (typeof serviceId !== 'string' || !Number.isInteger(revision) || revision < 0) throw new TypeError('invalid cache key');
  return `${serviceId}:${revision}`;
}
