import { ModelCallError } from '../accounting.js';
import { parseContextConfig } from '../config.js';
import { parseMessage } from '../journal.js';
import type { MiniPlugin } from '../plugin.js';
import type { ContextConfig, Message } from '../types.js';

export const SUMMARY_SYSTEM = 'Summarize only facts already present in the conversation: task constraints, file changes, errors, and remaining work. Do not claim that a test passed unless the history says it passed. Keep the summary concise.';
export const SUMMARY_PREFIX = 'Earlier conversation summary:\n';

/** End indices of complete assistant/tool rounds, with call/result continuity checked. */
function completedRoundEnds(messages: readonly Message[]): number[] {
  const ends: number[] = [];
  let pending: Set<string> | null = null;
  for (let i = 0; i < messages.length; i++) {
    const message = parseMessage(messages[i]);
    if (message.role === 'user') {
      if (pending) throw new Error('context history: user message before tool results completed');
    } else if (message.role === 'assistant') {
      if (pending) throw new Error('context history: assistant message before tool results completed');
      if (message.calls.length === 0) ends.push(i + 1);
      else pending = new Set(message.calls.map(call => call.id));
    } else {
      if (!pending || !pending.delete(message.callId)) {
        throw new Error('context history: orphan, duplicate or mismatched tool result');
      }
      if (pending.size === 0) { pending = null; ends.push(i + 1); }
    }
  }
  return ends;
}

function projection(history: readonly Message[], boundary: number, summary: string | null): Message[] {
  if (summary === null) return history.map(parseMessage);
  return [
    ...history.slice(0, boundary).filter(message => message.role === 'user').map(parseMessage),
    { role: 'user', content: SUMMARY_PREFIX + summary },
    ...history.slice(boundary).map(parseMessage),
  ];
}

export function contextManagerPlugin(options: { context: ContextConfig; enabled?: boolean; maxOutputTokens?: number }): MiniPlugin {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || !Object.hasOwn(options, 'context')
    || Reflect.ownKeys(options).some(key => !['context', 'enabled', 'maxOutputTokens'].includes(String(key)))) {
    throw new Error('context manager options: invalid fields');
  }
  const config = parseContextConfig(options.context);
  const enabled = options.enabled === undefined ? false : options.enabled;
  if (typeof enabled !== 'boolean') throw new Error('context manager enabled: expected boolean');
  const maxOutputTokens = options.maxOutputTokens === undefined ? 512 : options.maxOutputTokens;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('context manager maxOutputTokens: expected positive integer');
  return {
    name: 'context-manager',
    dependencies: ['session', 'model', 'tools', ...(enabled ? ['events'] : [])],
    setup(ctx) {
      const session = ctx.get('session');
      const model = ctx.get('model');
      const tools = ctx.get('tools');
      let closed = false;
      let busy = false;
      let idle: (() => void) | null = null;
      let boundary = 0;
      let summary: string | null = null;
      const remove = ctx.provide('contextManager', {
        async build({ system, signal }) {
          if (closed) throw new Error('context manager is closed');
          if (busy) throw new Error('context manager: concurrent build');
          busy = true;
          try {
            signal.throwIfAborted();
            if (typeof system !== 'string') throw new Error('context system: expected string');
            const history = session.messages().map(parseMessage);
            const schemas = structuredClone(tools.schemas());
            const ends = completedRoundEnds(history);
            const before = projection(history, boundary, summary);
            const preCompressionEstimatedTokens = Math.ceil(JSON.stringify({ system, messages: before, tools: schemas }).length / 4);
            const pendingEnds = ends.filter(end => end > boundary);
            const olderRounds = Math.max(0, pendingEnds.length - config.keepRecentRounds);
            const thresholdReached = preCompressionEstimatedTokens >= config.estimatedWindowTokens * config.triggerRatio;
            const compactionEligible = thresholdReached && olderRounds > 0;
            let messages = before;
            if (enabled && compactionEligible) {
              const toMessageIndex = pendingEnds[olderRounds - 1]!;
              const fromMessageIndex = boundary || history.findIndex(message => message.role === 'assistant');
              if (fromMessageIndex < 0 || fromMessageIndex >= toMessageIndex) throw new Error('context history: invalid compaction boundary');
              const summaryMessages: Message[] = [
                ...(summary === null ? [] : [{ role: 'user' as const, content: SUMMARY_PREFIX + summary }]),
                ...history.slice(fromMessageIndex, toMessageIndex),
              ];
              let requestSeq: number | null = null;
              let responseSeq: number | null = null;
              const removeListener = ctx.get('events').on(event => {
                if (event.type === 'request' && (event.data as { kind?: string }).kind === 'summary') requestSeq = event.seq;
                if (event.type === 'response' && (event.data as { kind?: string }).kind === 'summary') responseSeq = event.seq;
              });
              let response;
              try {
                response = await model.complete({ kind: 'summary', system: SUMMARY_SYSTEM,
                  messages: summaryMessages, tools: [], maxOutputTokens: Math.min(512, maxOutputTokens), signal });
              } finally { removeListener(); }
              signal.throwIfAborted();
              if (closed) throw new Error('context manager is closed');
              if (response.finish !== 'stop' || response.calls.length !== 0 || response.content.trim() === '') {
                throw new ModelCallError('model_error');
              }
              if (requestSeq === null || responseSeq === null) throw new ModelCallError('io_error');
              const nextSummary = response.content.trim();
              try {
                await session.record({ type: 'context_compacted', data: {
                  fromMessageIndex, toMessageIndex, summary: nextSummary,
                  summaryRequestSeq: requestSeq, summaryResponseSeq: responseSeq,
                } });
              } catch { throw new ModelCallError('io_error'); }
              boundary = toMessageIndex;
              summary = nextSummary;
              messages = projection(history, boundary, summary);
            }
            signal.throwIfAborted();
            if (closed) throw new Error('context manager is closed');
            const estimatedInputTokens = Math.ceil(JSON.stringify({ system, messages, tools: schemas }).length / 4);
            return {
              system, messages, tools: schemas,
              contextMetrics: { estimatedInputTokens, preCompressionEstimatedTokens,
                olderRounds, thresholdReached, compactionEligible },
            };
          } finally { busy = false; idle?.(); idle = null; }
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
