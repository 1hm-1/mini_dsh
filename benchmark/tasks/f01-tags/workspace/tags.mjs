export function parseTags(input) {
  if (typeof input !== 'string') throw new TypeError('tags must be a string');
  return input.split(',').map(part => part.trim());
}
