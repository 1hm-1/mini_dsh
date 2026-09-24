import { parseContextConfig } from '../config.js';
import { parseMessage } from '../journal.js';
import type { MiniPlugin } from '../plugin.js';
import type { ContextConfig, Message } from '../types.js';

/** Count completed assistant turns while checking call/result continuity. */
function completedRounds(messages: readonly Message[]): number {
  let rounds = 0;
  let pending: Set<string> | null = null;
  for (const raw of messages) {
    const message = parseMessage(raw);
    if (message.role === 'user') {
      if (pending) throw new Error('context history: user message before tool results completed');
      continue;
    }
    if (message.role === 'assistant') {
      if (pending) throw new Error('context history: assistant message before tool results completed');
      if (message.calls.length === 0) rounds++;
      else pending = new Set(message.calls.map(call => call.id));
      continue;
    }
    if (!pending || !pending.delete(message.callId)) {
      throw new Error('context history: orphan, duplicate or mismatched tool result');
    }
    if (pending.size === 0) {
      pending = null;
      rounds++;
    }
  }
  return rounds;
}

/** M3 baseline projection. The optional summary mechanism is introduced in M7. */
export function contextManagerPlugin(options: { context: ContextConfig }): MiniPlugin {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || Reflect.ownKeys(options).length !== 1 || !Object.hasOwn(options, 'context')) {
    throw new Error('context manager options: expected only context');
  }
  const config = parseContextConfig(options.context);
  return {
    name: 'context-manager',
    dependencies: ['session', 'model', 'tools'],
    setup(ctx) {
      const session = ctx.get('session');
      const tools = ctx.get('tools');
      let closed = false;
      const remove = ctx.provide('contextManager', {
        async build({ system, signal }) {
          if (closed) throw new Error('context manager is closed');
          signal.throwIfAborted();
          if (typeof system !== 'string') throw new Error('context system: expected string');
          const messages = session.messages().map(parseMessage);
          const schemas = structuredClone(tools.schemas());
          const rounds = completedRounds(messages);
          const estimatedInputTokens = Math.ceil(JSON.stringify({ system, messages, tools: schemas }).length / 4);
          const olderRounds = Math.max(0, rounds - config.keepRecentRounds);
          const thresholdReached = estimatedInputTokens >= config.estimatedWindowTokens * config.triggerRatio;
          signal.throwIfAborted();
          if (closed) throw new Error('context manager is closed');
          return {
            system, messages, tools: schemas,
            contextMetrics: {
              estimatedInputTokens,
              preCompressionEstimatedTokens: estimatedInputTokens,
              olderRounds,
              thresholdReached,
              compactionEligible: thresholdReached && olderRounds > 0,
            },
          };
        },
      });
      return () => { closed = true; remove(); };
    },
  };
}
