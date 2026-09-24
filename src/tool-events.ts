import type { ToolCall, ToolResult } from './types.js';

export interface ToolStartData { call: ToolCall }
export interface ToolEndData {
  startSeq: number;
  dispatched: boolean;
  result: ToolResult | null;
  error: 'tool_limit' | 'timeout' | 'cancelled' | 'internal_error' | null;
}

function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label}: expected plain object`);
  }
  const input = value as Record<string, unknown>;
  const found = Reflect.ownKeys(input);
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new Error(`${label}: wrong fields`);
  }
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !Object.hasOwn(property, 'value')) throw new Error(`${label}: missing or accessor field ${key}`);
  }
  return input;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}: expected string`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}: expected boolean`);
  return value;
}
function call(value: unknown): ToolCall {
  const input = object(value, 'tool_start.call', ['id', 'name', 'arguments']);
  const id = string(input.id, 'tool_start.call.id');
  const name = string(input.name, 'tool_start.call.name');
  if (!id || !name) throw new Error('tool_start.call: empty id or name');
  return { id, name, arguments: string(input.arguments, 'tool_start.call.arguments') };
}

export function parseToolResult(value: unknown): ToolResult {
  const input = object(value, 'tool result', ['ok', 'output', 'errorCode', 'truncated']);
  const ok = bool(input.ok, 'tool result.ok');
  const output = string(input.output, 'tool result.output');
  if (output.length > 16000) throw new Error('tool result.output: exceeds 16000 characters');
  const errorCode = input.errorCode === null ? null : string(input.errorCode, 'tool result.errorCode');
  if (ok ? errorCode !== null : errorCode === null || errorCode.trim() === '') {
    throw new Error('tool result.errorCode: inconsistent with ok');
  }
  return { ok, output, errorCode, truncated: bool(input.truncated, 'tool result.truncated') };
}

export function parseToolEventData(type: 'tool_start', value: unknown): ToolStartData;
export function parseToolEventData(type: 'tool_end', value: unknown): ToolEndData;
export function parseToolEventData(type: string, value: unknown): ToolStartData | ToolEndData;
export function parseToolEventData(type: string, value: unknown): ToolStartData | ToolEndData {
  if (type === 'tool_start') {
    const input = object(value, 'tool_start data', ['call']);
    return { call: call(input.call) };
  }
  if (type === 'tool_end') {
    const input = object(value, 'tool_end data', ['startSeq', 'dispatched', 'result', 'error']);
    const startSeq = input.startSeq;
    if (typeof startSeq !== 'number' || !Number.isSafeInteger(startSeq) || startSeq < 1) {
      throw new Error('tool_end.startSeq: expected positive safe integer');
    }
    const dispatched = bool(input.dispatched, 'tool_end.dispatched');
    const result = input.result === null ? null : parseToolResult(input.result);
    const error = input.error;
    if (error !== null && error !== 'tool_limit' && error !== 'timeout'
      && error !== 'cancelled' && error !== 'internal_error') throw new Error('tool_end.error: invalid');
    if (dispatched && error === 'tool_limit') throw new Error('tool_end.error: dispatched tool_limit');
    if (result !== null && (!dispatched || error !== null)) throw new Error('tool_end.result: invalid outcome');
    if (result === null && error === null) throw new Error('tool_end.error: missing for null result');
    if (!dispatched && error !== 'tool_limit' && error !== 'cancelled' && error !== 'timeout'
      && error !== 'internal_error') {
      throw new Error('tool_end.dispatched: invalid undispatched outcome');
    }
    return { startSeq, dispatched, result,
      error: error as ToolEndData['error'] };
  }
  throw new Error('tool event type: unknown');
}
