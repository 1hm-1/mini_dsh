import { ModelCallError } from '../accounting.js';
import { parseModelResponse } from '../model-events.js';
import type { MiniPlugin } from '../plugin.js';

export const OPTIMIZER_SYSTEM = 'Rewrite only the user\'s original, publicly provided task as a concise task wording suggestion. Preserve its meaning, goals, constraints, exceptions, and boundaries. Do not add requirements, choose files or algorithms, make a plan, or write code. Return only the rewritten task.';

/** Makes one accounted model request before the worker starts. */
export function promptOptimizerPlugin(options: { maxOutputTokens?: number } = {}): MiniPlugin {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || Reflect.ownKeys(options).some(key => key !== 'maxOutputTokens')) {
    throw new Error('prompt optimizer options: invalid fields');
  }
  const maxOutputTokens = options.maxOutputTokens === undefined ? 512 : options.maxOutputTokens;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error('prompt optimizer maxOutputTokens: expected positive integer');
  }
  return {
    name: 'prompt-optimizer', dependencies: ['model'],
    setup(ctx) {
      const model = ctx.get('model');
      let used = false;
      let closed = false;
      let busy = false;
      let idle: (() => void) | null = null;
      const remove = ctx.provide('promptOptimizer', {
        async optimize(input, signal) {
          if (closed) throw new Error('prompt optimizer is closed');
          if (used) throw new Error('prompt optimizer can optimize only once');
          if (typeof input !== 'string' || !(signal instanceof AbortSignal)) {
            throw new Error('prompt optimizer requires task text and signal');
          }
          used = true;
          busy = true;
          try {
            if (signal.aborted) throw new ModelCallError('cancelled');
            const response = await model.complete({ kind: 'optimizer', system: OPTIMIZER_SYSTEM,
              messages: [{ role: 'user', content: input }], tools: [],
              maxOutputTokens: Math.min(512, maxOutputTokens), signal });
            if (signal.aborted) throw new ModelCallError('cancelled');
            if (closed) throw new Error('prompt optimizer is closed');
            let parsed;
            try { parsed = parseModelResponse(response); }
            catch { throw new ModelCallError('model_error'); }
            if (parsed.finish !== 'stop' || parsed.calls.length !== 0 || parsed.content.trim() === '') {
              throw new ModelCallError('model_error');
            }
            return parsed.content.trim();
          } finally {
            busy = false;
            idle?.();
            idle = null;
          }
        },
      });
      return async () => {
        closed = true;
        if (busy) await new Promise<void>(resolve => { idle = resolve; });
        remove();
      };
    },
  };
}
