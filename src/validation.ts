export function record(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${name}: expected object`);
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw new Error(`${name}: unknown field`);
  for (const key of keys) if (!Object.hasOwn(input, key)) throw new Error(`${name}: missing field ${key}`);
  return input;
}

export function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('TEMPLATE')) throw new Error(`${name}: invalid string`);
  return value;
}

export function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}: expected positive safe integer`);
  return value;
}

export function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name}: expected finite number`);
  return value;
}

export function relativePath(value: unknown, name: string): string {
  const path = string(value, name);
  if (path.startsWith('/') || path.includes('\\') || /[?*\[\]{}]/.test(path)
    || path.split('/').some(part => part === '' || part === '.' || part === '..')
    || /^[A-Za-z]:/.test(path) || path.includes('\0')) throw new Error(`${name}: invalid relative path`);
  return path;
}

export function uniqueStrings(value: unknown, name: string, check: (value: unknown, name: string) => string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${name}: expected array`);
  const parsed = Array.from(value, (item, index) => check(item, `${name}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${name}: duplicate entry`);
  return parsed;
}
