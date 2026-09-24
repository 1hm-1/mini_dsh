export interface ContextCompactedData {
  fromMessageIndex: number;
  toMessageIndex: number;
  summary: string;
  summaryRequestSeq: number;
  summaryResponseSeq: number;
}

function index(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}: expected nonnegative safe integer`);
  return value;
}
export function parseContextCompactedData(value: unknown): ContextCompactedData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('context_compacted: expected object');
  const data = value as Record<string, unknown>;
  const keys = ['fromMessageIndex', 'toMessageIndex', 'summary', 'summaryRequestSeq', 'summaryResponseSeq'];
  if (Reflect.ownKeys(data).length !== keys.length || Reflect.ownKeys(data).some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new Error('context_compacted: wrong fields');
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error(`context_compacted: invalid ${key}`);
  }
  const fromMessageIndex = index(data.fromMessageIndex, 'context_compacted.fromMessageIndex');
  const toMessageIndex = index(data.toMessageIndex, 'context_compacted.toMessageIndex');
  const summaryRequestSeq = index(data.summaryRequestSeq, 'context_compacted.summaryRequestSeq');
  const summaryResponseSeq = index(data.summaryResponseSeq, 'context_compacted.summaryResponseSeq');
  if (fromMessageIndex >= toMessageIndex || summaryRequestSeq < 1 || summaryRequestSeq >= summaryResponseSeq) {
    throw new Error('context_compacted: invalid boundary or request reference');
  }
  if (typeof data.summary !== 'string' || data.summary.trim() === '') throw new Error('context_compacted.summary: empty');
  return { fromMessageIndex, toMessageIndex, summary: data.summary, summaryRequestSeq, summaryResponseSeq };
}
