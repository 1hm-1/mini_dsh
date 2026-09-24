import type { ModelRequest, ModelResponse } from './types.js';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('model_error: invalid response object');
  return value as Record<string, unknown>;
}

function token(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('model_error: invalid usage');
  return value;
}

/** Preserve trustworthy usage even when another response field is malformed. */
export function extractChatUsage(value: unknown): ModelResponse['usage'] {
  const unknown = { inputTokens: null, outputTokens: null };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return unknown;
  const usage = (value as Record<string, unknown>).usage;
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return unknown;
  const data = usage as Record<string, unknown>;
  const valid = (part: unknown): number | null => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 ? part : null;
  return { inputTokens: valid(data.prompt_tokens), outputTokens: valid(data.completion_tokens) };
}

/** Encode the exact body sent to a chat/completions endpoint. */
export function encodeChatRequest(model: { id: string; temperature: number }, request: ModelRequest): string {
  return JSON.stringify({
    model: model.id,
    temperature: model.temperature,
    stream: false,
    n: 1,
    max_completion_tokens: request.maxOutputTokens,
    messages: [
      { role: 'system', content: request.system },
      ...request.messages.map(message => {
        if (message.role === 'user') return { role: 'user', content: message.content };
        if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: message.content };
        return {
          role: 'assistant', content: message.content,
          ...(message.calls.length ? { tool_calls: message.calls.map(call => ({
            id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
          })) } : {}),
        };
      }),
    ],
    tools: request.tools.map(tool => ({ type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.parameters,
    } })),
  });
}

/** Parse provider JSON. Valid diagnostic finishes are returned for durable logging. */
export function decodeChatResponse(value: unknown): ModelResponse {
  const root = record(value);
  if (!Array.isArray(root.choices) || root.choices.length !== 1) throw new Error('model_error: expected one choice');
  const choice = record(root.choices[0]);
  const message = record(choice.message);
  if (message.role !== 'assistant') throw new Error('model_error: invalid role');
  const content = message.content === null ? '' : message.content;
  if (typeof content !== 'string') throw new Error('model_error: invalid content');
  const rawCalls = message.tool_calls === undefined || message.tool_calls === null ? [] : message.tool_calls;
  if (!Array.isArray(rawCalls)) throw new Error('model_error: invalid tool calls');
  const calls = rawCalls.map((raw: unknown) => {
    const call = record(raw);
    const fn = record(call.function);
    if (call.type !== 'function' || typeof call.id !== 'string' || !call.id
      || typeof fn.name !== 'string' || !fn.name || typeof fn.arguments !== 'string') {
      throw new Error('model_error: invalid tool call');
    }
    return { id: call.id, name: fn.name, arguments: fn.arguments };
  });
  if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error('model_error: duplicate tool call id');
  const reason = choice.finish_reason;
  if (typeof reason !== 'string') throw new Error('model_error: invalid finish reason');
  const finish: ModelResponse['finish'] = reason === 'stop' || reason === 'tool_calls' || reason === 'length' ? reason : 'other';
  if (finish === 'stop' && calls.length || finish === 'tool_calls' && !calls.length) throw new Error('model_error: finish does not match calls');
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  if (root.usage !== undefined && root.usage !== null) {
    const usage = record(root.usage);
    if (usage.prompt_tokens !== undefined && usage.prompt_tokens !== null) inputTokens = token(usage.prompt_tokens);
    if (usage.completion_tokens !== undefined && usage.completion_tokens !== null) outputTokens = token(usage.completion_tokens);
  }
  if (root.model !== undefined && root.model !== null && typeof root.model !== 'string') throw new Error('model_error: invalid model');
  if (root.system_fingerprint !== undefined && root.system_fingerprint !== null && typeof root.system_fingerprint !== 'string') throw new Error('model_error: invalid fingerprint');
  return {
    content, calls, finish,
    usage: { inputTokens, outputTokens },
    actualModel: root.model as string | null | undefined ?? null,
    fingerprint: root.system_fingerprint as string | null | undefined ?? null,
  };
}
