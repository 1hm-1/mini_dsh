export function slug(value) {
  if (typeof value !== 'string') throw new TypeError('slug input must be a string');
  return value.trim().toLowerCase().replace(/\s+/gu, '-');
}
