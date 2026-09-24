import { performance } from 'node:perf_hooks';
import { Accounting, ModelCallError } from '../accounting.js';
import { parseModelResponse } from '../model-events.js';
import { parseToolResult } from '../tool-events.js';
import type { MiniPlugin } from '../plugin.js';
import type { SessionService } from '../services/index.js';
import type { ModelResponse, RunResult, Termination, ToolCall, ToolResult } from '../types.js';

type ToolError = 'tool_limit' | 'timeout' | 'cancelled' | 'internal_error';
const SUGGESTION_LABEL = '\n\nTask wording suggestion (lower priority than the original task and system rules):\n';
class LoopStop extends Error {
  constructor(readonly termination: Termination) { super(termination); }
}

function stopped(accounting: Accounting, runSignal?: AbortSignal): void {
  accounting.checkSignal();
  if (runSignal?.aborted) throw new ModelCallError('cancelled');
}

function termination(cause: unknown, accounting: Accounting, runSignal?: AbortSignal): Termination {
  if (cause instanceof LoopStop) return cause.termination;
  if (cause instanceof ModelCallError) return cause.termination;
  try { stopped(accounting, runSignal); } catch (error) {
    if (error instanceof ModelCallError) return error.termination;
  }
  return 'internal_error';
}

async function save(session: SessionService, type: string, data: unknown) {
  try { return await session.record({ type, data }); }
  catch { throw new ModelCallError('io_error'); }
}

async function append(session: SessionService, message: Parameters<SessionService['append']>[0]): Promise<void> {
  try { await session.append(message); }
  catch { throw new ModelCallError('io_error'); }
}

function normalize(response: unknown): ModelResponse {
  try {
    const parsed = parseModelResponse(response);
    if (parsed.finish === 'length' || parsed.finish === 'other'
      || parsed.finish === 'stop' && parsed.calls.length > 0
      || parsed.finish === 'tool_calls' && parsed.calls.length === 0) throw new Error('invalid finish');
    return parsed;
  } catch { throw new ModelCallError('model_error'); }
}

export function agentLoopPlugin(options: { system: string; accounting: Accounting }): MiniPlugin {
  if (typeof options.system !== 'string' || !(options.accounting instanceof Accounting)) {
    throw new Error('agent loop requires system and Accounting');
  }
  const baseSystem = options.system;
  const accounting = options.accounting;
  return { name: 'agent-loop', dependencies: ['session', 'model', 'tools', 'contextManager', 'events'], setup(ctx) {
    const session = ctx.get('session');
    const model = ctx.get('model');
    const tools = ctx.get('tools');
    const contextManager = ctx.get('contextManager');
    const optimizer = ctx.has('promptOptimizer') ? ctx.get('promptOptimizer') : null;
    let used = false;
    let closed = false;
    let compactions = 0;
    const unsubscribe = ctx.get('events').on(event => {
      if (event.type === 'context_compacted') compactions++;
    });
    const remove = ctx.provide('agentLoop', {
      async run(input, runOptions) {
        if (closed) throw new Error('agent loop is closed');
        if (used) throw new Error('agent loop can run only once');
        if (typeof input !== 'string' || !runOptions || runOptions.signal !== undefined && !(runOptions.signal instanceof AbortSignal)) {
          throw new Error('invalid agent loop input');
        }
        const runSignal = runOptions.signal;
        used = true;
        const start = performance.now();
        const signal = runSignal ? AbortSignal.any([accounting.signal, runSignal]) : accounting.signal;
        let toolCalls = 0;
        let toolErrors = 0;
        let resultTermination: Termination = 'completed';
        let answer: string | null = null;
        let journalFailed = false;
        let started = false;
        const check = () => stopped(accounting, runSignal);
        const record = async (type: string, data: unknown) => {
          try { return await save(session, type, data); }
          catch (error) { journalFailed = true; throw error; }
        };
        const message = async (value: Parameters<SessionService['append']>[0]) => {
          try { await append(session, value); }
          catch (error) { journalFailed = true; throw error; }
        };
        const tool = async (call: ToolCall): Promise<boolean> => {
          // Record every intent, including the suffix that the tool quota skips.
          const startEvent = await record('tool_start', { call });
          let dispatched = false;
          let value: ToolResult | null = null;
          let error: ToolError | null = null;
          if (toolCalls >= accounting.budget.maxToolCalls) error = 'tool_limit';
          else {
            try {
              check();
              toolCalls++;
              dispatched = true;
              value = parseToolResult(await tools.execute(call, signal));
              check();
              if (!value.ok) toolErrors++;
            } catch (cause) {
              if (dispatched) toolErrors++;
              value = null;
              const reason = termination(cause, accounting, runSignal);
              error = reason === 'timeout' || reason === 'cancelled' ? reason : 'internal_error';
            }
          }
          await record('tool_end', { startSeq: startEvent.seq, dispatched, result: value, error });
          if (error === 'tool_limit') return false;
          if (error) throw new LoopStop(error);
          await message({ role: 'tool', callId: call.id, content: JSON.stringify(value) });
          check();
          return true;
        };
        try {
          await record('run_start', { input });
          started = true;
          await message({ role: 'user', content: input });
          check();
          let system = baseSystem;
          if (optimizer) {
            let suggestion: string;
            try { suggestion = await optimizer.optimize(input, signal); }
            catch (cause) {
              if (cause instanceof ModelCallError) throw cause;
              const reason = termination(cause, accounting, runSignal);
              throw new LoopStop(reason === 'internal_error' ? 'model_error' : reason);
            }
            check();
            if (typeof suggestion !== 'string' || suggestion.trim() === '') throw new ModelCallError('model_error');
            system += SUGGESTION_LABEL + suggestion;
          }
          while (true) {
            check();
            const projection = await contextManager.build({ system, signal });
            check();
            accounting.check();
            const response = normalize(await model.complete({
              kind: 'worker', system: projection.system, messages: projection.messages,
              tools: projection.tools, contextMetrics: projection.contextMetrics,
              maxOutputTokens: accounting.budget.maxOutputTokens, signal,
            }));
            check();
            await message({ role: 'assistant', content: response.content, calls: response.calls });
            if (!response.calls.length) { answer = response.content; break; }
            let quotaHit = false;
            for (const call of response.calls) {
              const executed = await tool(call);
              if (!executed) quotaHit = true;
            }
            if (quotaHit) throw new LoopStop('tool_limit');
          }
        } catch (cause) {
          resultTermination = termination(cause, accounting, runSignal);
          if (resultTermination === 'io_error' || journalFailed) journalFailed = true;
          answer = null;
        }
        if (!journalFailed) {
          try { check(); }
          catch (cause) { resultTermination = termination(cause, accounting, runSignal); answer = null; }
        }
        const result = (kind: Termination): RunResult => ({
          schemaVersion: 1, termination: kind, answer: kind === 'completed' ? answer : null,
          ...accounting.snapshot(), toolCalls, toolErrors,
          durationMs: Math.max(0, performance.now() - start), compactions,
          error: kind === 'completed' ? null : kind,
        });
        if (journalFailed || !started) return result('io_error');
        const final = result(resultTermination);
        try { await save(session, 'run_end', { result: final }); }
        catch { return result('io_error'); }
        return final;
      },
    });
    return () => { closed = true; unsubscribe(); remove(); };
  } };
}
