export function checksum(bytes) {
  if (!Array.isArray(bytes) || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new TypeError('bytes must be an array of octets');
  }
  return bytes.reduce((sum, value) => (sum + value) % 256, 0);
}
