import type { Accounting } from '../accounting.js';
import { ModelCallError } from '../accounting.js';
import { parseModelResponse } from '../model-events.js';
import { encodeChatRequest } from '../model-protocol.js';
import { parseMessage } from '../journal.js';
import { parseModelConfig } from '../config.js';
import type { ModelConfig, ModelRequest, ModelResponse, WorkerContextMetrics } from '../types.js';
import type { SessionService } from '../services/index.js';

export class ProviderModelError extends Error {
  constructor(readonly usage: ModelResponse['usage'] = { inputTokens: null, outputTokens: null }) {
    super('model_error');
  }
}

export interface ModelDispatcher {
  (body: string, request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

function failure(error: unknown, signal: AbortSignal, accounting: Accounting, request: ModelRequest): ModelCallError {
  if (error instanceof ModelCallError) return error;
  if (accounting.signal.aborted) {
    try { accounting.checkSignal(); } catch (cause) { if (cause instanceof ModelCallError) return cause; }
  }
  if (request.signal.aborted) return new ModelCallError('cancelled');
  if (signal.aborted) return new ModelCallError('cancelled');
  return new ModelCallError('model_error');
}

function snapshotRequest(input: ModelRequest): ModelRequest {
  try {
    if (input.kind !== 'worker' && input.kind !== 'optimizer' && input.kind !== 'summary') throw new Error('kind');
    if (typeof input.system !== 'string' || !(input.signal instanceof AbortSignal)
      || !Array.isArray(input.messages) || !Array.isArray(input.tools)) throw new Error('request');
    const messages = structuredClone(input.messages).map(parseMessage);
    const tools = structuredClone(input.tools);
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool)
        || typeof tool.name !== 'string' || !tool.name || typeof tool.description !== 'string'
        || !tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)) throw new Error('tool schema');
    }
    let contextMetrics = input.contextMetrics;
    if (input.kind === 'worker') {
      if (!contextMetrics) throw new Error('metrics');
      const m = contextMetrics;
      if (!Number.isSafeInteger(m.estimatedInputTokens) || m.estimatedInputTokens < 0
        || !Number.isSafeInteger(m.preCompressionEstimatedTokens) || m.preCompressionEstimatedTokens < 0
        || !Number.isSafeInteger(m.olderRounds) || m.olderRounds < 0
        || typeof m.thresholdReached !== 'boolean' || typeof m.compactionEligible !== 'boolean'
        || m.compactionEligible !== (m.thresholdReached && m.olderRounds > 0)) throw new Error('metrics');
      contextMetrics = { ...m };
    } else if (contextMetrics !== undefined) throw new Error('unexpected metrics');
    return { kind: input.kind, system: input.system, messages, tools,
      maxOutputTokens: input.maxOutputTokens, signal: input.signal,
      ...(contextMetrics ? { contextMetrics } : {}) };
  } catch { throw new ModelCallError('model_error', 'invalid model request'); }
}

export function createModelService(model: ModelConfig, accounting: Accounting, session: SessionService, dispatch: ModelDispatcher) {
  const frozenModel = parseModelConfig(model);
  let busy = false;
  let sealed = false;
  return {
    close() { sealed = true; },
    async complete(input: ModelRequest): Promise<ModelResponse> {
      if (sealed) throw new ModelCallError('io_error', 'model service is closed');
      if (busy) throw new ModelCallError('model_error', 'concurrent model request');
      busy = true;
      try {
        const request = snapshotRequest(input);
        accounting.check();
        if (request.signal.aborted) throw new ModelCallError('cancelled');
        if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1
          || request.maxOutputTokens > accounting.budget.maxOutputTokens) throw new ModelCallError('model_error');
        let body: string;
        let estimatedInputTokens: number;
        try {
          body = encodeChatRequest(frozenModel, request);
          estimatedInputTokens = Math.ceil(JSON.stringify({
            system: request.system, messages: request.messages, tools: request.tools,
          }).length / 4);
        } catch { throw new ModelCallError('model_error', 'invalid model request'); }
        const requestChars = body.length;
        let metrics: WorkerContextMetrics | undefined;
        let observationSeq: number | null = null;
        if (request.kind === 'worker') {
          if (!request.contextMetrics) throw new ModelCallError('model_error', 'worker context metrics required');
          metrics = { ...request.contextMetrics, estimatedInputTokens, requestChars, observationSeq: 0 };
          let observation;
          try { observation = await session.record({ type: 'context_observation', data: { metrics: {
            requestChars, estimatedInputTokens,
            preCompressionEstimatedTokens: metrics.preCompressionEstimatedTokens,
            olderRounds: metrics.olderRounds,
            thresholdReached: metrics.thresholdReached,
            compactionEligible: metrics.compactionEligible,
          } } }); }
          catch { sealed = true; throw new ModelCallError('io_error'); }
          observationSeq = observation.seq;
          metrics.observationSeq = observation.seq;
        }
        if (requestChars > accounting.budget.maxInputChars) throw new ModelCallError('context_overflow');
        // A journaled intent precedes every network/script dispatch.
        let requestEvent;
        try { requestEvent = await session.record({ type: 'request', data: {
          kind: request.kind, body, requestChars, estimatedInputTokens, observationSeq,
        } }); }
        catch { sealed = true; throw new ModelCallError('io_error'); }

        const signal = AbortSignal.any([accounting.signal, request.signal]);
        let dispatched = false;
        let response: ModelResponse | null = null;
        let error: ModelCallError | null = null;
        let usage: ModelResponse['usage'] = { inputTokens: null, outputTokens: null };
        try {
          if (sealed) throw new ModelCallError('io_error');
          if (request.signal.aborted) throw new ModelCallError('cancelled');
          // No await may occur between reserving the shared quota and invoking the provider.
          accounting.reserve(request.kind, metrics);
          dispatched = true;
          const pending = dispatch(body, request, signal);
          response = parseModelResponse(await pending);
          usage = response.usage;
          if (signal.aborted) error = failure(signal.reason, signal, accounting, request);
          else if (response.finish === 'length' || response.finish === 'other'
            || response.finish === 'stop' && response.calls.length > 0
            || response.finish === 'tool_calls' && response.calls.length === 0) {
            error = new ModelCallError('model_error');
          }
        } catch (cause) {
          error = failure(cause, signal, accounting, request);
          if (cause instanceof ProviderModelError) usage = cause.usage;
        }
        if (dispatched) accounting.recordUsage(usage);
        try { await session.record({ type: 'response', data: {
          requestSeq: requestEvent.seq, kind: request.kind, dispatched,
          response, usage, error: error ? (error.termination === 'timeout' || error.termination === 'cancelled' ? error.termination : 'model_error') : null,
        } }); }
        catch { sealed = true; throw new ModelCallError('io_error'); }
        if (error) throw error;
        if (signal.aborted) throw failure(signal.reason, signal, accounting, request);
        return response!;
      } finally { busy = false; }
    },
  };
}
