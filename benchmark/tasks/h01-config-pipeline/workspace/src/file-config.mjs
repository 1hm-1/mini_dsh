export function readFileLayer(file = {}) {
  if (file === null || typeof file !== 'object' || Array.isArray(file)) throw new TypeError('file must be an object');
  return file;
}
