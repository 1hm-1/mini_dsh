import { isDeepStrictEqual } from 'node:util';
import { parseRunConfig, variantFlags } from '../src/config.js';
import { parseMessage, type JournalRead } from '../src/journal.js';
import { encodeChatRequest, isDeepSeekChatEndpoint } from '../src/model-protocol.js';
import { SUMMARY_PREFIX, SUMMARY_SYSTEM } from '../src/plugins/context-manager.js';
import { OPTIMIZER_SYSTEM } from '../src/plugins/prompt-optimizer.js';
import { SUGGESTION_LABEL } from '../src/plugins/agent-loop.js';
import { fileToolSchemas } from '../src/plugins/file-tools.js';
import { BASE_SYSTEM } from '../src/runtime.js';
import type { ContextCompactedData } from '../src/context-events.js';
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
function completedRoundEnds(messages: Message[]): number[] {
  const ends: number[] = [];
  let pending: Set<string> | null = null;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'user') continue;
    if (message.role === 'assistant') {
      if (message.calls.length === 0) ends.push(index + 1);
      else pending = new Set(message.calls.map(call => call.id));
    } else if (pending?.delete(message.callId) && pending.size === 0) { ends.push(index + 1); pending = null; }
  }
  return ends;
}
function projection(history: Message[], boundary: number, summary: string | null): Message[] {
  if (summary === null) return history;
  return [...history.slice(0, boundary).filter(message => message.role === 'user'),
    { role: 'user', content: SUMMARY_PREFIX + summary }, ...history.slice(boundary)];
}
function estimate(system: string, messages: Message[], tools: unknown[]): number {
  return Math.ceil(JSON.stringify({ system, messages, tools }).length / 4);
}

/** Independently reconstruct accounting from a parsed, complete v1 journal. */
export function inspectJournal(journal: JournalRead, config: RunConfig): JournalMetrics {
  const settings = parseRunConfig(config);
  if (journal.status !== 'complete' || journal.events.length < 2) throw new Error('journal metrics: incomplete journal');
  const events = journal.events;
  if (events[0]?.type !== 'run_start' || events.at(-1)?.type !== 'run_end') throw new Error('journal metrics: missing run boundaries');
  const result = (events.at(-1)!.data as { result: RunResult }).result;
  const contextEnabled = variantFlags(settings.variant).context;
  const optimizerEnabled = variantFlags(settings.variant).optimizer;
  const input = (events[0]!.data as { input: string }).input;
  const optimizerInputBody = optimizerEnabled ? encodeChatRequest(settings.model, {
    kind: 'optimizer', system: OPTIMIZER_SYSTEM, messages: [{ role: 'user', content: input }],
    tools: [], maxOutputTokens: Math.min(512, settings.budget.maxOutputTokens),
    signal: new AbortController().signal,
  }) : null;
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
  let boundary = 0;
  let summary: string | null = null;
  let compactions = 0;
  let lastWorkerSystem: string | null = null;
  let lastWorkerTools: { name: unknown; description: unknown; parameters: unknown }[] | null = null;
  let pendingSummary: { requestSeq: number; responseSeq: number | null; from: number; to: number;
    preEstimate: number; olderRounds: number; response: ModelResponse | null; error: ResponseData['error'] | null } | null = null;
  let preAfterCompaction: { estimate: number; olderRounds: number } | null = null;
  let optimizerRequestSeq: number | null = null;
  let optimizerResponseSeq: number | null = null;
  let optimizerResponse: ModelResponse | null = null;
  let optimizerError: ResponseData['error'] | null = null;
  let suggestion: string | null = null;
  let seenWorkerRequest = false;
  const candidate = () => {
    if (!contextEnabled || lastWorkerSystem === null || lastWorkerTools === null) return null;
    const before = projection(history, boundary, summary);
    const preEstimate = estimate(lastWorkerSystem, before, lastWorkerTools);
    const pendingEnds = completedRoundEnds(history).filter(end => end > boundary);
    const olderRounds = Math.max(0, pendingEnds.length - settings.context.keepRecentRounds);
    const threshold = preEstimate >= settings.context.estimatedWindowTokens * settings.context.triggerRatio;
    if (!threshold || olderRounds === 0) return null;
    const to = pendingEnds[olderRounds - 1]!;
    const from = boundary || history.findIndex(message => message.role === 'assistant');
    if (from < 0 || from >= to) throw new Error('journal metrics: invalid compaction boundary');
    const messages: Message[] = [...(summary === null ? [] : [{ role: 'user' as const, content: SUMMARY_PREFIX + summary }]),
      ...history.slice(from, to)];
    return { from, to, messages, preEstimate, olderRounds };
  };
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
      if (pendingSummary?.responseSeq !== null && pendingSummary?.responseSeq !== undefined) {
        throw new Error('journal metrics: summary response without compaction before next request');
      }
      if (pending.size) throw new Error('journal metrics: concurrent request');
      const body = object(JSON.parse(data.body) as unknown, 'request body');
      equal(data.requestChars, data.body.length, 'requestChars');
      equal(body.model, settings.model.id, 'model');
      equal(body.temperature, settings.model.temperature, 'temperature');
      const outputLimit = data.kind === 'worker' ? settings.budget.maxOutputTokens : Math.min(512, settings.budget.maxOutputTokens);
      if (isDeepSeekChatEndpoint(settings.model.endpoint)) {
        equal(Object.keys(body).sort(), ['model', 'temperature', 'stream', 'max_tokens', 'thinking', 'messages', 'tools'].sort(), 'DeepSeek protocol fields');
        equal(body.max_tokens, outputLimit, 'DeepSeek max_tokens');
        equal(body.thinking, { type: 'disabled' }, 'DeepSeek thinking');
      } else {
        equal(Object.keys(body).sort(), ['model', 'temperature', 'stream', 'n', 'max_completion_tokens', 'messages', 'tools'].sort(), 'generic protocol fields');
        equal(body.max_completion_tokens, outputLimit, 'maxOutputTokens');
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
        if (item.role === 'user') return parseMessage({ role: 'user', content: item.content });
        if (item.role === 'tool') return parseMessage({ role: 'tool', callId: item.tool_call_id, content: item.content });
        if (item.role === 'assistant') return parseMessage({ role: 'assistant', content: item.content,
          calls: Array.isArray(item.tool_calls) ? item.tool_calls.map(rawCall => {
            const call = object(rawCall, 'tool call');
            const fn = object(call.function, 'function');
            return { id: call.id, name: fn.name, arguments: fn.arguments };
          }) : [] });
        throw new Error('journal metrics: request message role invalid');
      });
      const tools = body.tools.map(raw => {
        const wrapper = object(raw, 'tool schema');
        const fn = object(wrapper.function, 'function schema');
        equal(wrapper.type, 'function', 'tool schema type');
        return { name: fn.name, description: fn.description, parameters: fn.parameters };
      });
      const requestEstimate = estimate(system.content, projected, tools);
      equal(data.estimatedInputTokens, requestEstimate, 'estimatedInputTokens');
      if (data.requestChars > settings.budget.maxInputChars) throw new Error('journal metrics: request exceeds maxInputChars');
      if (data.kind === 'worker') {
        if (optimizerEnabled && suggestion === null) throw new Error('journal metrics: worker before valid optimizer suggestion');
        equal(system.content, optimizerEnabled ? BASE_SYSTEM + SUGGESTION_LABEL + suggestion : BASE_SYSTEM, 'worker system');
        seenWorkerRequest = true;
        const expectedBefore = projection(history, boundary, summary);
        const preEstimate = preAfterCompaction?.estimate ?? estimate(system.content, expectedBefore, tools);
        const olderRounds = preAfterCompaction?.olderRounds ?? Math.max(0,
          completedRoundEnds(history).filter(end => end > boundary).length - settings.context.keepRecentRounds);
        const threshold = preEstimate >= settings.context.estimatedWindowTokens * settings.context.triggerRatio;
        if (contextEnabled && !preAfterCompaction && threshold && olderRounds > 0) {
          throw new Error('journal metrics: eligible context omitted compaction');
        }
        equal(projected, expectedBefore, 'worker history');
        const observation = observations.get(data.observationSeq!);
        if (!observation || referenced.has(data.observationSeq!)) throw new Error('journal metrics: missing or reused context observation');
        referenced.add(data.observationSeq!);
        equal(observation.requestChars, data.requestChars, 'context requestChars');
        equal(observation.estimatedInputTokens, requestEstimate, 'context estimatedInputTokens');
        equal(observation.preCompressionEstimatedTokens, preEstimate, 'preCompressionEstimatedTokens');
        equal(observation.olderRounds, olderRounds, 'olderRounds');
        equal(observation.thresholdReached, threshold, 'thresholdReached');
        lastWorkerSystem = system.content;
        lastWorkerTools = tools;
        preAfterCompaction = null;
      } else if (data.observationSeq !== null) throw new Error('journal metrics: auxiliary request has observation');
      if (data.kind === 'summary') {
        const expected = candidate();
        if (!expected || pendingSummary) throw new Error('journal metrics: unexpected summary request');
        equal(projected, expected.messages, 'summary messages');
        equal(system.content, SUMMARY_SYSTEM, 'summary system');
        equal(tools, [], 'summary tools');
        equal(data.body, encodeChatRequest(settings.model, {
          kind: 'summary', system: SUMMARY_SYSTEM, messages: expected.messages, tools: [],
          maxOutputTokens: outputLimit, signal: new AbortController().signal,
        }), 'summary body');
        pendingSummary = { requestSeq: event.seq, responseSeq: null, from: expected.from, to: expected.to,
          preEstimate: expected.preEstimate, olderRounds: expected.olderRounds, response: null, error: null };
      }
      if (data.kind === 'optimizer') {
        if (!optimizerEnabled || optimizerRequestSeq !== null || seenWorkerRequest || history.length !== 1
          || observations.size !== 0
          || optimizerResponseSeq !== null || compactions > 0) {
          throw new Error('journal metrics: unexpected optimizer request');
        }
        equal(system.content, OPTIMIZER_SYSTEM, 'optimizer system');
        equal(projected, [{ role: 'user', content: input }], 'optimizer original task');
        equal(tools, [], 'optimizer tools');
        equal(data.body, optimizerInputBody, 'optimizer body');
        optimizerRequestSeq = event.seq;
      }
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
      if (data.kind === 'summary') {
        if (!pendingSummary || pendingSummary.requestSeq !== data.requestSeq) throw new Error('journal metrics: untracked summary response');
        pendingSummary.responseSeq = event.seq;
        pendingSummary.response = data.response;
        pendingSummary.error = data.error;
        if (data.error === null && data.response &&
          (data.response.finish !== 'stop' || data.response.calls.length > 0 || data.response.content.trim() === '')) {
          modelFailure = true;
        }
      }
      if (data.kind === 'optimizer') {
        if (optimizerRequestSeq !== data.requestSeq || optimizerResponseSeq !== null) {
          throw new Error('journal metrics: untracked optimizer response');
        }
        optimizerResponseSeq = event.seq;
        optimizerResponse = data.response;
        optimizerError = data.error;
        if (data.error === null && data.response) {
          if (data.response.finish === 'stop' && data.response.calls.length === 0 && data.response.content.trim() !== '') {
            suggestion = data.response.content.trim();
          } else modelFailure = true;
        }
      }
    }
    if (event.type === 'context_compacted') {
      const compacted = event.data as ContextCompactedData;
      if (!contextEnabled || !pendingSummary || pendingSummary.responseSeq === null
        || pendingSummary.error !== null || !pendingSummary.response
        || pendingSummary.response.finish !== 'stop' || pendingSummary.response.calls.length > 0
        || pendingSummary.response.content.trim() === '') {
        throw new Error('journal metrics: context_compacted without valid summary');
      }
      equal(compacted.fromMessageIndex, pendingSummary.from, 'compaction fromMessageIndex');
      equal(compacted.toMessageIndex, pendingSummary.to, 'compaction toMessageIndex');
      equal(compacted.summaryRequestSeq, pendingSummary.requestSeq, 'compaction summaryRequestSeq');
      equal(compacted.summaryResponseSeq, pendingSummary.responseSeq, 'compaction summaryResponseSeq');
      equal(compacted.summary, pendingSummary.response.content.trim(), 'compaction summary');
      boundary = compacted.toMessageIndex;
      summary = compacted.summary;
      preAfterCompaction = { estimate: pendingSummary.preEstimate, olderRounds: pendingSummary.olderRounds };
      pendingSummary = null;
      compactions++;
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
  if (optimizerEnabled) {
    if (optimizerRequestSeq === null) {
      if (observations.size !== 0) throw new Error('journal metrics: context observation before optimizer');
      if (!['cancelled', 'timeout', 'context_overflow'].includes(result.termination)) {
        throw new Error('journal metrics: optimizer request missing');
      }
      if (result.termination === 'context_overflow'
        && (optimizerInputBody === null || optimizerInputBody.length <= settings.budget.maxInputChars)) {
        throw new Error('journal metrics: optimizer input does not exceed hard limit');
      }
    } else if (optimizerResponseSeq === null) {
      throw new Error('journal metrics: optimizer response missing');
    } else if (suggestion === null) {
      const semanticFailure = optimizerError === null && optimizerResponse !== null;
      const allowed = optimizerError === null
        ? semanticFailure ? ['model_error', 'cancelled', 'timeout'] : ['cancelled', 'timeout']
        : [optimizerError];
      if (!allowed.includes(result.termination)) throw new Error('journal metrics: optimizer failure termination mismatch');
    } else if (!seenWorkerRequest && !['request_limit', 'cancelled', 'timeout'].includes(result.termination)
      && !(result.termination === 'context_overflow' && overflow)) {
      throw new Error('journal metrics: successful optimizer has no worker continuation');
    }
  }
  if (optimizerEnabled && suggestion !== null && !seenWorkerRequest
    && result.termination === 'context_overflow') {
    const workerSystem = BASE_SYSTEM + SUGGESTION_LABEL + suggestion;
    const workerMessages: Message[] = [{ role: 'user', content: input }];
    const workerTools = fileToolSchemas();
    const workerBody = encodeChatRequest(settings.model, {
      kind: 'worker', system: workerSystem, messages: workerMessages, tools: workerTools,
      maxOutputTokens: settings.budget.maxOutputTokens, signal: new AbortController().signal,
    });
    const workerEstimate = estimate(workerSystem, workerMessages, workerTools);
    const threshold = workerEstimate >= settings.context.estimatedWindowTokens * settings.context.triggerRatio;
    const unpaired = [...observations].filter(([seq]) => !referenced.has(seq));
    if (unpaired.length !== 1 || workerBody.length <= settings.budget.maxInputChars) {
      throw new Error('journal metrics: first worker context overflow lacks evidence');
    }
    equal(unpaired[0]![1], {
      requestChars: workerBody.length, estimatedInputTokens: workerEstimate,
      preCompressionEstimatedTokens: workerEstimate, olderRounds: 0,
      thresholdReached: threshold, compactionEligible: false,
    }, 'first worker context observation');
  }
  if (pendingSummary) {
    if (pendingSummary.responseSeq === null || result.termination === 'completed') {
      throw new Error('journal metrics: summary request lacks valid termination');
    }
    const response = pendingSummary.response;
    const semanticFailure = pendingSummary.error === null && response &&
      (response.finish !== 'stop' || response.calls.length > 0 || response.content.trim() === '');
    const allowed = pendingSummary.error === null
      ? semanticFailure ? ['model_error', 'timeout', 'cancelled'] : ['timeout', 'cancelled']
      : [pendingSummary.error];
    if (!allowed.includes(result.termination)) {
      throw new Error('journal metrics: uncommitted summary termination mismatch');
    }
  }
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
    knownInputTokens, knownOutputTokens, contextStats, compactions,
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
      || result.termination === 'context_overflow' && !overflow && !(() => {
        if (optimizerEnabled && optimizerRequestSeq === null && optimizerInputBody !== null
          && optimizerInputBody.length > settings.budget.maxInputChars) return true;
        const expected = candidate();
        if (!expected) return false;
        const summaryBody = encodeChatRequest(settings.model, {
          kind: 'summary', system: SUMMARY_SYSTEM, messages: expected.messages, tools: [],
          maxOutputTokens: Math.min(512, settings.budget.maxOutputTokens), signal: new AbortController().signal,
        });
        return summaryBody.length > settings.budget.maxInputChars;
      })()
      || result.termination === 'model_error' && !modelFailure) {
      throw new Error('journal metrics: termination has no supporting evidence');
    }
  }
  return { result, requests, inputKnownRequests, outputKnownRequests, completeUsageRequests };
}
