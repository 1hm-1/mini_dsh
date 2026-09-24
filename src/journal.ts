import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import type { Event, Message, RunResult } from './types.js';
import { parseModelEventData } from './model-events.js';
import { parseContextCompactedData } from './context-events.js';
import type { ContextCompactedData } from './context-events.js';
import type { ContextObservationData, RequestData, ResponseData } from './model-events.js';
import { parseToolEventData, parseToolResult } from './tool-events.js';
import type { ToolEndData, ToolStartData } from './tool-events.js';
import type { ToolCall } from './types.js';

function object(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${name}: expected plain object`);
  const input = value as Record<string, unknown>;
  const found = Reflect.ownKeys(input);
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error(`${name}: wrong fields`);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !Object.hasOwn(property, 'value')) throw new Error(`${name}: missing or accessor field ${key}`);
  }
  return input;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name}: expected string`);
  return value;
}
function count(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${name}: expected nonnegative safe integer`);
  return value;
}
function duration(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name}: expected nonnegative finite number`);
  return value;
}
function nullableCount(value: unknown, name: string): number | null {
  return value === null ? null : count(value, name);
}
function nullableText(value: unknown, name: string): string | null {
  return value === null ? null : text(value, name);
}

export function parseMessage(value: unknown): Message {
  if (value === null || typeof value !== 'object') throw new Error('message: expected object');
  const role = (value as Record<string, unknown>).role;
  if (role === 'user') {
    const input = object(value, 'message', ['role', 'content']);
    return { role, content: text(input.content, 'message.content') };
  }
  if (role === 'tool') {
    const input = object(value, 'message', ['role', 'callId', 'content']);
    const callId = text(input.callId, 'message.callId');
    if (!callId) throw new Error('message.callId: empty');
    return { role, callId, content: text(input.content, 'message.content') };
  }
  if (role === 'assistant') {
    const input = object(value, 'message', ['role', 'content', 'calls']);
    if (!Array.isArray(input.calls)) throw new Error('message.calls: expected array');
    const calls = Array.from(input.calls, (call, index) => {
      const item = object(call, `message.calls[${index}]`, ['id', 'name', 'arguments']);
      const id = text(item.id, 'call.id');
      const name = text(item.name, 'call.name');
      if (!id || !name) throw new Error('call: empty id or name');
      return { id, name, arguments: text(item.arguments, 'call.arguments') };
    });
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error('message.calls: duplicate id');
    return { role, content: text(input.content, 'message.content'), calls };
  }
  throw new Error('message.role: unknown');
}

export function parseRunResult(value: unknown): RunResult {
  const input = object(value, 'run result', [
    'schemaVersion', 'termination', 'answer', 'modelRequests', 'workerRequests', 'optimizerRequests',
    'summaryRequests', 'toolCalls', 'toolErrors', 'inputTokens', 'outputTokens', 'knownInputTokens',
    'knownOutputTokens', 'durationMs', 'compactions', 'error', 'contextStats',
  ]);
  if (input.schemaVersion !== 1) throw new Error('run result: invalid schemaVersion');
  const termination = input.termination;
  if (!['completed', 'request_limit', 'tool_limit', 'timeout', 'cancelled', 'context_overflow',
    'model_error', 'io_error', 'internal_error'].includes(termination as string)) throw new Error('run result: invalid termination');
  const stats = object(input.contextStats, 'contextStats', [
    'workerRequests', 'meanEstimatedInputTokens', 'peakEstimatedInputTokens', 'peakRequestChars',
    'thresholdRequests', 'eligibleCompactionRequests',
  ]);
  return {
    schemaVersion: 1, termination: termination as RunResult['termination'],
    answer: nullableText(input.answer, 'answer'),
    modelRequests: count(input.modelRequests, 'modelRequests'),
    workerRequests: count(input.workerRequests, 'workerRequests'),
    optimizerRequests: count(input.optimizerRequests, 'optimizerRequests'),
    summaryRequests: count(input.summaryRequests, 'summaryRequests'),
    toolCalls: count(input.toolCalls, 'toolCalls'), toolErrors: count(input.toolErrors, 'toolErrors'),
    inputTokens: nullableCount(input.inputTokens, 'inputTokens'),
    outputTokens: nullableCount(input.outputTokens, 'outputTokens'),
    knownInputTokens: count(input.knownInputTokens, 'knownInputTokens'),
    knownOutputTokens: count(input.knownOutputTokens, 'knownOutputTokens'),
    durationMs: duration(input.durationMs, 'durationMs'), compactions: count(input.compactions, 'compactions'),
    error: nullableText(input.error, 'error'),
    contextStats: {
      workerRequests: count(stats.workerRequests, 'contextStats.workerRequests'),
      meanEstimatedInputTokens: stats.meanEstimatedInputTokens === null ? null : duration(stats.meanEstimatedInputTokens, 'contextStats.meanEstimatedInputTokens'),
      peakEstimatedInputTokens: nullableCount(stats.peakEstimatedInputTokens, 'contextStats.peakEstimatedInputTokens'),
      peakRequestChars: nullableCount(stats.peakRequestChars, 'contextStats.peakRequestChars'),
      thresholdRequests: count(stats.thresholdRequests, 'contextStats.thresholdRequests'),
      eligibleCompactionRequests: count(stats.eligibleCompactionRequests, 'contextStats.eligibleCompactionRequests'),
    },
  };
}

export function parseEvent(value: unknown): Event {
  const input = object(value, 'event', ['schemaVersion', 'seq', 'type', 'elapsedMs', 'data']);
  if (input.schemaVersion !== 1) throw new Error('event: invalid schemaVersion');
  const seq = count(input.seq, 'event.seq');
  if (seq === 0) throw new Error('event.seq: starts at one');
  const elapsedMs = duration(input.elapsedMs, 'event.elapsedMs');
  const type = text(input.type, 'event.type');
  let data: unknown;
  switch (type) {
    case 'run_start': {
      const payload = object(input.data, 'run_start data', ['input']);
      data = { input: text(payload.input, 'run_start.input') };
      break;
    }
    case 'message': {
      const payload = object(input.data, 'message data', ['message']);
      data = { message: parseMessage(payload.message) };
      break;
    }
    case 'context_compacted':
      data = parseContextCompactedData(input.data);
      break;
    case 'context_observation':
    case 'request':
    case 'response':
      data = parseModelEventData(type, input.data);
      break;
    case 'tool_start':
    case 'tool_end':
      data = parseToolEventData(type, input.data);
      break;
    case 'run_end': {
      const payload = object(input.data, 'run_end data', ['result']);
      data = { result: parseRunResult(payload.result) };
      break;
    }
    default: throw new Error('event type: payload validation is not implemented');
  }
  return { schemaVersion: 1, seq, type, elapsedMs, data };
}

export interface JournalRead { status: 'complete' | 'incomplete'; events: Event[] }

/** Read-only v1 inspection; no replay or repair. */
export async function readJournal(file: string): Promise<JournalRead> {
  const body = await readFile(file, 'utf8');
  const lines = body.split('\n');
  const terminated = body.endsWith('\n');
  if (terminated) lines.pop();
  const events: Event[] = [];
  const outstanding = new Set<string>();
  const observations = new Map<number, ContextObservationData>();
  const referencedObservations = new Set<number>();
  const pendingRequests = new Map<number, RequestData>();
  const answeredRequests = new Set<number>();
  const summaryResponses = new Map<number, { requestSeq: number; response: ResponseData }>();
  const compactedResponses = new Set<number>();
  type PendingCall = { call: ToolCall; startSeq: number | null; outcome: ToolEndData | null; messaged: boolean };
  let batch: PendingCall[] = [];
  let nextToolStart = 0;
  let activeToolStart: number | null = null;
  let skipped = false;
  let terminalToolError = false;
  let tornTail = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let raw: unknown;
    try { raw = JSON.parse(line) as unknown; } catch (error) {
      if (i === lines.length - 1) { tornTail = true; break; }
      throw new Error(`journal line ${i + 1}: invalid JSON`, { cause: error });
    }
    const item = parseEvent(raw);
    if (item.seq !== i + 1) throw new Error(`journal line ${i + 1}: sequence gap`);
    events.push(item);
  }
  const hasToolEvents = events.some(item => item.type === 'tool_start' || item.type === 'tool_end');
  for (const item of events) {
    const prior = events[item.seq - 2];
    if (item.seq === 1 && item.type !== 'run_start') throw new Error('journal: first event must be run_start');
    if (item.seq > 1 && item.type === 'run_start') throw new Error('journal: duplicate run_start');
    if (prior?.type === 'run_end') throw new Error('journal: event after run_end');
    if (prior && item.elapsedMs < prior.elapsedMs) throw new Error('journal: elapsedMs decreased');
    if (item.type === 'message') {
      const message = (item.data as { message: Message }).message;
      if (message.role === 'assistant') {
        if (outstanding.size > 0) throw new Error('journal: assistant message before tool results');
        for (const call of message.calls) outstanding.add(call.id);
        batch = message.calls.map(call => ({ call, startSeq: null, outcome: null, messaged: false }));
        nextToolStart = 0;
        skipped = false;
        terminalToolError = false;
      } else if (message.role === 'tool') {
        if (hasToolEvents) {
          const pending = batch.find(entry => entry.call.id === message.callId);
          if (!pending || !pending.outcome?.result || pending.messaged) {
            throw new Error('journal: tool message has no persisted tool_end result');
          }
          let content: unknown;
          try { content = JSON.parse(message.content) as unknown; }
          catch { throw new Error('journal: tool message result is invalid JSON'); }
          const parsed = parseToolResult(content);
          if (!isDeepStrictEqual(parsed, pending.outcome.result)) {
            throw new Error('journal: tool message result does not match tool_end');
          }
          pending.messaged = true;
        }
        if (!outstanding.delete(message.callId)) throw new Error('journal: unknown or duplicate tool result');
      }
    }
    if (item.type === 'tool_start') {
      if (activeToolStart !== null) throw new Error('journal: serial tools require prior tool_end');
      const previous = batch[nextToolStart - 1];
      if (previous?.outcome?.result && !previous.messaged) {
        throw new Error('journal: next tool_start before prior result message');
      }
      const entry = batch[nextToolStart];
      const toolCall = (item.data as ToolStartData).call;
      if (!entry || entry.call.id !== toolCall.id || entry.call.name !== toolCall.name
        || entry.call.arguments !== toolCall.arguments) throw new Error('journal: tool_start does not match next assistant call');
      entry.startSeq = item.seq;
      activeToolStart = item.seq;
      nextToolStart++;
    }
    if (item.type === 'tool_end') {
      const outcome = item.data as ToolEndData;
      if (activeToolStart === null || outcome.startSeq !== activeToolStart) {
        throw new Error('journal: tool_end references unknown or duplicate startSeq');
      }
      const entry = batch.find(pending => pending.startSeq === activeToolStart);
      if (!entry || entry.outcome) throw new Error('journal: duplicate tool_end');
      if (skipped && outcome.dispatched) throw new Error('journal: tool dispatch after budget skip');
      if (terminalToolError && outcome.dispatched) throw new Error('journal: tool dispatch after terminal error');
      entry.outcome = outcome;
      activeToolStart = null;
      if (!outcome.dispatched) skipped = true;
      if (outcome.error !== null && outcome.error !== 'tool_limit') terminalToolError = true;
    }
    if (item.type === 'context_observation') observations.set(item.seq, item.data as ContextObservationData);
    if (item.type === 'request') {
      if (outstanding.size > 0) throw new Error('journal: request before tool results');
      const request = item.data as RequestData;
      if (pendingRequests.size > 0) throw new Error('journal: concurrent requests are unsupported');
      if (request.kind === 'worker') {
        const observationSeq = request.observationSeq!;
        const metrics = observations.get(observationSeq)?.metrics;
        if (!metrics) throw new Error('journal: worker request references unknown observation');
        if (referencedObservations.has(observationSeq)) throw new Error('journal: observation already referenced');
        if (metrics.requestChars !== request.requestChars) throw new Error('journal: observation requestChars mismatch');
        if (metrics.estimatedInputTokens !== request.estimatedInputTokens) {
          throw new Error('journal: observation estimatedInputTokens mismatch');
        }
        referencedObservations.add(observationSeq);
      }
      pendingRequests.set(item.seq, request);
    }
    if (item.type === 'response') {
      const response = item.data as ResponseData;
      const request = pendingRequests.get(response.requestSeq);
      if (!request) {
        if (answeredRequests.has(response.requestSeq)) throw new Error('journal: duplicate response');
        throw new Error('journal: response references unknown request');
      }
      if (request.kind !== response.kind) throw new Error('journal: response kind mismatch');
      pendingRequests.delete(response.requestSeq);
      answeredRequests.add(response.requestSeq);
      if (response.kind === 'summary') summaryResponses.set(item.seq, { requestSeq: response.requestSeq, response });
    }
    if (item.type === 'context_compacted') {
      const compacted = item.data as ContextCompactedData;
      const linked = summaryResponses.get(compacted.summaryResponseSeq);
      if (!linked || linked.requestSeq !== compacted.summaryRequestSeq
        || compactedResponses.has(compacted.summaryResponseSeq)
        || linked.response.error !== null || linked.response.response?.finish !== 'stop'
        || linked.response.response.calls.length !== 0
        || linked.response.response.content.trim() !== compacted.summary) {
        throw new Error('journal: context_compacted does not match successful summary response');
      }
      compactedResponses.add(compacted.summaryResponseSeq);
    }
    if (item.type === 'run_end' && (item.data as { result: RunResult }).result.termination === 'completed' && outstanding.size > 0) {
      throw new Error('journal: completed run has missing tool results');
    }
    if (item.type === 'run_end' && (item.data as { result: RunResult }).result.termination === 'completed'
      && (activeToolStart !== null || batch.some(entry => entry.startSeq !== null && entry.outcome === null))) {
      throw new Error('journal: completed run has pending tool_end');
    }
    if (item.type === 'run_end' && (item.data as { result: RunResult }).result.termination === 'completed' && pendingRequests.size > 0) {
      throw new Error('journal: completed run has pending request without response');
    }
  }
  return { status: !tornTail && events.at(-1)?.type === 'run_end' ? 'complete' : 'incomplete', events };
}
