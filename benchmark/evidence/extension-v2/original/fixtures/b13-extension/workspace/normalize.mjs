export function normalizeText(value) {
  if (typeof value !== 'string') throw new TypeError('text must be a string');
  return value.trim().toLowerCase();
}
