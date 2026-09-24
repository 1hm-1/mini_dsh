import type { ModelRequestKind, ModelResponse, WorkerContextMetrics } from './types.js';

export type ObservationMetrics = Omit<WorkerContextMetrics, 'observationSeq'>;
export interface ContextObservationData { metrics: ObservationMetrics }
export interface RequestData {
  kind: ModelRequestKind;
  body: string;
  requestChars: number;
  estimatedInputTokens: number;
  observationSeq: number | null;
}
export interface ResponseData {
  requestSeq: number;
  kind: ModelRequestKind;
  dispatched: boolean;
  response: ModelResponse | null;
  usage: ModelResponse['usage'];
  error: 'model_error' | 'timeout' | 'cancelled' | null;
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
function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}: expected nonnegative safe integer`);
  }
  return value;
}
function nullableCount(value: unknown, label: string): number | null {
  return value === null ? null : count(value, label);
}
function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}: expected boolean`);
  return value;
}
function kind(value: unknown): ModelRequestKind {
  if (value !== 'worker' && value !== 'optimizer' && value !== 'summary') throw new Error('model event.kind: invalid');
  return value;
}
function usage(value: unknown): ModelResponse['usage'] {
  const input = object(value, 'usage', ['inputTokens', 'outputTokens']);
  return { inputTokens: nullableCount(input.inputTokens, 'usage.inputTokens'),
    outputTokens: nullableCount(input.outputTokens, 'usage.outputTokens') };
}

export function parseModelResponse(value: unknown): ModelResponse {
  const input = object(value, 'model response', ['content', 'calls', 'finish', 'usage', 'actualModel', 'fingerprint']);
  if (!Array.isArray(input.calls)) throw new Error('model response.calls: expected array');
  const calls = Array.from(input.calls, (value, index) => {
    const call = object(value, `model response.calls[${index}]`, ['id', 'name', 'arguments']);
    const id = string(call.id, 'call.id');
    const name = string(call.name, 'call.name');
    if (!id || !name) throw new Error('model response.calls: empty id or name');
    return { id, name, arguments: string(call.arguments, 'call.arguments') };
  });
  if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error('model response.calls: duplicate id');
  const finish = input.finish;
  if (finish !== 'stop' && finish !== 'tool_calls' && finish !== 'length' && finish !== 'other') {
    throw new Error('model response.finish: invalid');
  }
  return { content: string(input.content, 'model response.content'), calls, finish,
    usage: usage(input.usage), actualModel: nullableString(input.actualModel, 'model response.actualModel'),
    fingerprint: nullableString(input.fingerprint, 'model response.fingerprint') };
}

function parseObservation(value: unknown): ContextObservationData {
  const data = object(value, 'context_observation data', ['metrics']);
  const input = object(data.metrics, 'context_observation.metrics', [
    'requestChars', 'estimatedInputTokens', 'preCompressionEstimatedTokens', 'olderRounds',
    'thresholdReached', 'compactionEligible',
  ]);
  const metrics: ObservationMetrics = {
    requestChars: count(input.requestChars, 'metrics.requestChars'),
    estimatedInputTokens: count(input.estimatedInputTokens, 'metrics.estimatedInputTokens'),
    preCompressionEstimatedTokens: count(input.preCompressionEstimatedTokens, 'metrics.preCompressionEstimatedTokens'),
    olderRounds: count(input.olderRounds, 'metrics.olderRounds'),
    thresholdReached: bool(input.thresholdReached, 'metrics.thresholdReached'),
    compactionEligible: bool(input.compactionEligible, 'metrics.compactionEligible'),
  };
  if (metrics.compactionEligible !== (metrics.thresholdReached && metrics.olderRounds > 0)) {
    throw new Error('metrics.compactionEligible: must match threshold and older rounds');
  }
  return { metrics };
}
function parseRequest(value: unknown): RequestData {
  const data = object(value, 'request data', ['kind', 'body', 'requestChars', 'estimatedInputTokens', 'observationSeq']);
  const body = string(data.body, 'request.body');
  let parsed: unknown;
  try { parsed = JSON.parse(body) as unknown; } catch { throw new Error('request.body: invalid JSON object'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request.body: expected JSON object');
  }
  const requestChars = count(data.requestChars, 'request.requestChars');
  if (body.length !== requestChars) throw new Error('request.requestChars: does not match body length');
  const requestKind = kind(data.kind);
  const observationSeq = data.observationSeq === null ? null : count(data.observationSeq, 'request.observationSeq');
  if (observationSeq === 0 || (requestKind === 'worker' && observationSeq === null)
    || (requestKind !== 'worker' && observationSeq !== null)) {
    throw new Error('request.observationSeq: invalid for kind');
  }
  return { kind: requestKind, body, requestChars,
    estimatedInputTokens: count(data.estimatedInputTokens, 'request.estimatedInputTokens'), observationSeq };
}
function parseResponse(value: unknown): ResponseData {
  const data = object(value, 'response data', ['requestSeq', 'kind', 'dispatched', 'response', 'usage', 'error']);
  const requestSeq = count(data.requestSeq, 'response.requestSeq');
  if (requestSeq === 0) throw new Error('response.requestSeq: starts at one');
  const dispatched = bool(data.dispatched, 'response.dispatched');
  const parsedResponse = data.response === null ? null : parseModelResponse(data.response);
  const parsedUsage = usage(data.usage);
  const error = data.error;
  if (error !== null && error !== 'model_error' && error !== 'timeout' && error !== 'cancelled') {
    throw new Error('response.error: invalid');
  }
  if (!dispatched && (parsedResponse !== null || parsedUsage.inputTokens !== null || parsedUsage.outputTokens !== null
    || (error !== 'timeout' && error !== 'cancelled'))) {
    throw new Error('response.dispatched: invalid undispatched outcome');
  }
  if (dispatched && parsedResponse === null && error === null) throw new Error('response.error: missing for null response');
  if (parsedResponse !== null && (parsedResponse.usage.inputTokens !== parsedUsage.inputTokens
    || parsedResponse.usage.outputTokens !== parsedUsage.outputTokens)) {
    throw new Error('response.usage: does not match response usage');
  }
  return { requestSeq, kind: kind(data.kind), dispatched, response: parsedResponse, usage: parsedUsage, error };
}

export function parseModelEventData(type: 'context_observation', value: unknown): ContextObservationData;
export function parseModelEventData(type: 'request', value: unknown): RequestData;
export function parseModelEventData(type: 'response', value: unknown): ResponseData;
export function parseModelEventData(type: string, value: unknown): ContextObservationData | RequestData | ResponseData;
export function parseModelEventData(type: string, value: unknown): ContextObservationData | RequestData | ResponseData {
  if (type === 'context_observation') return parseObservation(value);
  if (type === 'request') return parseRequest(value);
  if (type === 'response') return parseResponse(value);
  throw new Error('model event type: unknown');
}
