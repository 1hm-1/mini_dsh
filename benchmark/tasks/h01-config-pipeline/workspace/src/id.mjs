export function normalizeServiceId(value) {
  if (typeof value !== 'string') throw new TypeError('service id must be a string');
  return value.trim().toLowerCase().replace(/\s+/gu, '-');
}
