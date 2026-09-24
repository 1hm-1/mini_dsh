const levels = new Set(['debug', 'info', 'warn', 'error']);
export function parseLogLevel(value) {
  if (typeof value !== 'string' || !levels.has(value.toLowerCase())) throw new TypeError('invalid log level');
  return value.toLowerCase();
}
