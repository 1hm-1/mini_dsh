import { isDeepStrictEqual } from 'node:util';
import { parseRunConfig } from '../src/config.js';
import type { JournalRead } from '../src/journal.js';
import { isDeepSeekChatEndpoint } from '../src/model-protocol.js';
import type { ContextObservationData, RequestData, ResponseData } from '../src/model-events.js';
import type { ToolEndData } from '../src/tool-events.js';
import type { Message, ModelRequestKind, ModelResponse, RunConfig, RunResult } from '../src/types.js';

export interface RequestMetric {
  seq: number;
  kind: ModelRequestKind;
  requestChars: number;
  estimatedInputTokens: number;
  preCompressionEstimatedTokens: number | null;
  olderRounds: number | null;
  thresholdReached: boolean | null;
  compactionEligible: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  actualModel: string | null;
  fingerprint: string | null;
}
export interface JournalMetrics {
  result: RunResult;
  requests: RequestMetric[];
  inputKnownRequests: number;
  outputKnownRequests: number;
  completeUsageRequests: number;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`journal metrics: ${label} mismatch`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`journal metrics: ${label} invalid`);
  return value as Record<string, unknown>;
}
function countRounds(messages: Message[]): number {
  let rounds = 0;
  let pending: Set<string> | null = null;
  for (const message of messages) {
    if (message.role === 'user') continue;
    if (message.role === 'assistant') {
      if (message.calls.length === 0) rounds++;
      else pending = new Set(message.calls.map(call => call.id));
    } else if (pending?.delete(message.callId) && pending.size === 0) { rounds++; pending = null; }
  }
  return rounds;
}

/** Independently reconstruct accounting from a parsed, complete v1 journal. */
export function inspectJournal(journal: JournalRead, config: RunConfig): JournalMetrics {
  const settings = parseRunConfig(config);
  if (journal.status !== 'complete' || journal.events.length < 2) throw new Error('journal metrics: incomplete journal');
  const events = journal.events;
  if (events[0]?.type !== 'run_start' || events.at(-1)?.type !== 'run_end') throw new Error('journal metrics: missing run boundaries');
  const result = (events.at(-1)!.data as { result: RunResult }).result;
  const input = (events[0]!.data as { input: string }).input;
  const history: Message[] = [];
  const observations = new Map<number, ContextObservationData['metrics']>();
  const referenced = new Set<number>();
  const pending = new Map<number, RequestData>();
  const toolStarts = new Set<number>();
  let assistantDue: ModelResponse | null = null;
  const requests: RequestMetric[] = [];
  let inputKnownRequests = 0;
  let outputKnownRequests = 0;
  let completeUsageRequests = 0;
  let knownInputTokens = 0;
  let knownOutputTokens = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let skippedTools = 0;
  let overflow = false;
  let modelFailure = false;
  let timeout = false;
  let cancelled = false;
  let lastAssistant: string | null = null;
  let lastAssistantCalls = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    if (event.seq !== index + 1 || index > 0 && event.elapsedMs < events[index - 1]!.elapsedMs) {
      throw new Error('journal metrics: event order mismatch');
    }
    if (index > 0 && event.type === 'run_start' || index < events.length - 1 && event.type === 'run_end') {
      throw new Error('journal metrics: duplicate run boundary');
    }
    if (event.type === 'message') {
      const message = (event.data as { message: Message }).message;
      if (history.length === 0) equal(message, { role: 'user', content: input }, 'run_start input');
      if (message.role === 'assistant') {
        if (!assistantDue) throw new Error('journal metrics: assistant message has no successful worker response');
        equal({ content: message.content, calls: message.calls },
          { content: assistantDue.content, calls: assistantDue.calls }, 'assistant response');
        assistantDue = null;
      }
      history.push(message);
      if (message.role === 'assistant') { lastAssistant = message.content; lastAssistantCalls = message.calls.length; }
    }
    if (event.type === 'context_observation') {
      const metrics = (event.data as ContextObservationData).metrics;
      const threshold = metrics.preCompressionEstimatedTokens >= settings.context.estimatedWindowTokens * settings.context.triggerRatio;
      equal(metrics.thresholdReached, threshold, 'thresholdReached');
      equal(metrics.compactionEligible, threshold && metrics.olderRounds > 0, 'compactionEligible');
      observations.set(event.seq, metrics);
      if (metrics.requestChars > settings.budget.maxInputChars) overflow = true;
    }
    if (event.type === 'request') {
      if (assistantDue) throw new Error('journal metrics: worker response missing assistant message');
      const data = event.data as RequestData;
      if (pending.size) throw new Error('journal metrics: concurrent request');
      const body = object(JSON.parse(data.body) as unknown, 'request body');
      equal(data.requestChars, data.body.length, 'requestChars');
      equal(body.model, settings.model.id, 'model');
      equal(body.temperature, settings.model.temperature, 'temperature');
      if (isDeepSeekChatEndpoint(settings.model.endpoint)) {
        equal(Object.keys(body).sort(), ['model', 'temperature', 'stream', 'max_tokens', 'thinking', 'messages', 'tools'].sort(), 'DeepSeek protocol fields');
        equal(body.max_tokens, settings.budget.maxOutputTokens, 'DeepSeek max_tokens');
        equal(body.thinking, { type: 'disabled' }, 'DeepSeek thinking');
      } else {
        equal(Object.keys(body).sort(), ['model', 'temperature', 'stream', 'n', 'max_completion_tokens', 'messages', 'tools'].sort(), 'generic protocol fields');
        equal(body.max_completion_tokens, settings.budget.maxOutputTokens, 'maxOutputTokens');
        equal(body.n, 1, 'n');
      }
      equal(body.stream, false, 'stream');
      const messages = body.messages;
      if (!Array.isArray(messages) || !Array.isArray(body.tools) || !messages.length) throw new Error('journal metrics: request body messages/tools invalid');
      const system = object(messages[0], 'system message');
      equal(system.role, 'system', 'system role');
      if (typeof system.content !== 'string') throw new Error('journal metrics: system content invalid');
      const rest = messages.slice(1);
      const projected = rest.map(raw => {
        const item = object(raw, 'message');
        if (item.role === 'user') return { role: 'user', content: item.content };
        if (item.role === 'tool') return { role: 'tool', callId: item.tool_call_id, content: item.content };
        if (item.role === 'assistant') return { role: 'assistant', content: item.content,
          calls: Array.isArray(item.tool_calls) ? item.tool_calls.map(rawCall => {
            const call = object(rawCall, 'tool call');
            const fn = object(call.function, 'function');
            return { id: call.id, name: fn.name, arguments: fn.arguments };
          }) : [] };
        throw new Error('journal metrics: request message role invalid');
      });
      const tools = body.tools.map(raw => {
        const wrapper = object(raw, 'tool schema');
        const fn = object(wrapper.function, 'function schema');
        equal(wrapper.type, 'function', 'tool schema type');
        return { name: fn.name, description: fn.description, parameters: fn.parameters };
      });
      const estimate = Math.ceil(JSON.stringify({ system: system.content, messages: projected, tools }).length / 4);
      equal(data.estimatedInputTokens, estimate, 'estimatedInputTokens');
      if (data.requestChars > settings.budget.maxInputChars) throw new Error('journal metrics: request exceeds maxInputChars');
      if (data.kind === 'worker') {
        // M4 baseline projects the complete Session history. M7 compaction will
        // require projection-aware checks once its journal event is supported.
        equal(projected, history, 'worker history');
        const observation = observations.get(data.observationSeq!);
        if (!observation || referenced.has(data.observationSeq!)) throw new Error('journal metrics: missing or reused context observation');
        referenced.add(data.observationSeq!);
        equal(observation.requestChars, data.requestChars, 'context requestChars');
        equal(observation.estimatedInputTokens, estimate, 'context estimatedInputTokens');
        equal(observation.preCompressionEstimatedTokens, estimate, 'preCompressionEstimatedTokens');
        equal(observation.olderRounds, Math.max(0, countRounds(history) - settings.context.keepRecentRounds), 'olderRounds');
      } else if (data.observationSeq !== null) throw new Error('journal metrics: auxiliary request has observation');
      pending.set(event.seq, data);
    }
    if (event.type === 'response') {
      const data = event.data as ResponseData;
      const request = pending.get(data.requestSeq);
      if (!request || request.kind !== data.kind) throw new Error('journal metrics: unpaired response');
      pending.delete(data.requestSeq);
      if (data.dispatched) {
        const observation = request.observationSeq === null ? null : observations.get(request.observationSeq)!;
        requests.push({ seq: data.requestSeq, kind: data.kind, requestChars: request.requestChars,
          estimatedInputTokens: request.estimatedInputTokens,
          preCompressionEstimatedTokens: observation?.preCompressionEstimatedTokens ?? null,
          olderRounds: observation?.olderRounds ?? null,
          thresholdReached: observation?.thresholdReached ?? null,
          compactionEligible: observation?.compactionEligible ?? null,
          inputTokens: data.usage.inputTokens, outputTokens: data.usage.outputTokens,
          actualModel: data.response?.actualModel ?? null, fingerprint: data.response?.fingerprint ?? null });
        if (data.usage.inputTokens !== null) { inputKnownRequests++; knownInputTokens += data.usage.inputTokens; }
        if (data.usage.outputTokens !== null) { outputKnownRequests++; knownOutputTokens += data.usage.outputTokens; }
        if (data.usage.inputTokens !== null && data.usage.outputTokens !== null) completeUsageRequests++;
      }
      if (data.error === 'model_error' || data.response?.finish === 'length' || data.response?.finish === 'other') modelFailure = true;
      if (data.error === 'timeout') timeout = true;
      if (data.error === 'cancelled') cancelled = true;
      if (data.kind === 'worker' && data.error === null && data.response) assistantDue = data.response;
    }
    if (event.type === 'tool_start') toolStarts.add(event.seq);
    if (event.type === 'tool_end') {
      const end = event.data as ToolEndData;
      if (!toolStarts.delete(end.startSeq)) throw new Error('journal metrics: unpaired tool_end');
      if (end.dispatched) { toolCalls++; if (end.error || end.result && !end.result.ok) toolErrors++; }
      else if (end.error === 'tool_limit') skippedTools++;
      if (end.error === 'timeout') timeout = true;
      if (end.error === 'cancelled') cancelled = true;
    }
  }
  if (history.length === 0) throw new Error('journal metrics: missing initial user message');
  if (pending.size) throw new Error('journal metrics: incomplete request without response');
  if (toolStarts.size || assistantDue && result.termination === 'completed') {
    throw new Error('journal metrics: incomplete response or tool evidence');
  }
  for (const [seq, observation] of observations) {
    if (!referenced.has(seq) && observation.requestChars <= settings.budget.maxInputChars) {
      throw new Error('journal metrics: unpaired context observation');
    }
  }
  if (requests.length > settings.budget.maxModelRequests || toolCalls > settings.budget.maxToolCalls) {
    throw new Error('journal metrics: budget exceeded');
  }
  const worker = requests.filter(request => request.kind === 'worker');
  const contextStats = {
    workerRequests: worker.length,
    meanEstimatedInputTokens: worker.length ? worker.reduce((sum, request) => sum + request.estimatedInputTokens, 0) / worker.length : null,
    peakEstimatedInputTokens: worker.length ? Math.max(...worker.map(request => request.estimatedInputTokens)) : null,
    peakRequestChars: worker.length ? Math.max(...worker.map(request => request.requestChars)) : null,
    thresholdRequests: worker.filter(request => request.thresholdReached).length,
    eligibleCompactionRequests: worker.filter(request => request.compactionEligible).length,
  };
  const fields = {
    modelRequests: requests.length, workerRequests: worker.length,
    optimizerRequests: requests.filter(request => request.kind === 'optimizer').length,
    summaryRequests: requests.filter(request => request.kind === 'summary').length,
    toolCalls, toolErrors,
    inputTokens: inputKnownRequests === requests.length ? knownInputTokens : null,
    outputTokens: outputKnownRequests === requests.length ? knownOutputTokens : null,
    knownInputTokens, knownOutputTokens, contextStats, compactions: 0,
  };
  for (const [key, value] of Object.entries(fields)) equal(result[key as keyof RunResult], value, key);
  if (result.termination === 'completed') {
    if (lastAssistant === null || lastAssistantCalls || result.answer !== lastAssistant || result.error !== null
      || modelFailure || timeout || cancelled || skippedTools || overflow) {
      throw new Error('journal metrics: completed answer mismatch');
    }
  } else {
    equal(result.answer, null, 'noncompleted answer');
    equal(result.error, result.termination, 'termination error');
    if (result.termination === 'request_limit' && requests.length !== settings.budget.maxModelRequests
      || result.termination === 'tool_limit' && !skippedTools
      || result.termination === 'context_overflow' && !overflow
      || result.termination === 'model_error' && !modelFailure) {
      throw new Error('journal metrics: termination has no supporting evidence');
    }
  }
  return { result, requests, inputKnownRequests, outputKnownRequests, completeUsageRequests };
}
