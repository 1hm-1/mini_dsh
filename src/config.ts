import variantSpec from '../specs/variants.json' with { type: 'json' };
import type { Budget, ContextConfig, ModelConfig, RunConfig, Variant } from './types.js';
import { finiteNumber, positiveInteger, record, relativePath, string, uniqueStrings } from './validation.js';

const variantNames = Object.keys(variantSpec.variants) as Variant[];
export function parseVariant(value: unknown): Variant {
  if (typeof value !== 'string' || !variantNames.includes(value as Variant)) throw new Error('variant: invalid value');
  return value as Variant;
}

export function variantFlags(variant: Variant): { context: boolean; optimizer: boolean } {
  const flags = variantSpec.variants[parseVariant(variant)];
  return { context: flags.context, optimizer: flags.optimizer };
}

export function parseModelConfig(value: unknown): ModelConfig {
  const input = record(value, 'model', ['endpoint', 'id', 'temperature']);
  const endpoint = string(input.endpoint, 'model.endpoint');
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('model.endpoint: invalid URL'); }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)
    && host.split('.').slice(1).every(part => Number(part) <= 255);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && loopback)
    || url.username !== '' || url.password !== '' || url.hash !== '') throw new Error('model.endpoint: invalid URL');
  for (const key of url.searchParams.keys()) {
    const parts = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().split(/[^a-z0-9]+/);
    const joined = parts.join('');
    if (parts.some(part => /^(?:key|token|secret|password|passwd|auth|authorization|credential|sig|signature)$/.test(part))
      || /^(?:apikey|accesstoken|refreshtoken|authtoken|clientsecret|accesskey|bearertoken)$/.test(joined))
      throw new Error('model.endpoint: credentials in query');
  }
  const id = string(input.id, 'model.id');
  const temperature = finiteNumber(input.temperature, 'model.temperature');
  return { endpoint, id, temperature };
}

export function parseBudget(value: unknown): Budget {
  const keys = ['maxModelRequests', 'maxToolCalls', 'timeoutMs', 'maxOutputTokens', 'maxInputChars'] as const;
  const input = record(value, 'budget', keys);
  return {
    maxModelRequests: positiveInteger(input.maxModelRequests, 'budget.maxModelRequests'),
    maxToolCalls: positiveInteger(input.maxToolCalls, 'budget.maxToolCalls'),
    timeoutMs: positiveInteger(input.timeoutMs, 'budget.timeoutMs'),
    maxOutputTokens: positiveInteger(input.maxOutputTokens, 'budget.maxOutputTokens'),
    maxInputChars: positiveInteger(input.maxInputChars, 'budget.maxInputChars'),
  };
}

export function parseContextConfig(value: unknown): ContextConfig {
  const input = record(value, 'context', ['estimatedWindowTokens', 'triggerRatio', 'keepRecentRounds']);
  const triggerRatio = finiteNumber(input.triggerRatio, 'context.triggerRatio');
  if (triggerRatio <= 0 || triggerRatio >= 1) throw new Error('context.triggerRatio: expected value between 0 and 1');
  return {
    estimatedWindowTokens: positiveInteger(input.estimatedWindowTokens, 'context.estimatedWindowTokens'),
    triggerRatio,
    keepRecentRounds: positiveInteger(input.keepRecentRounds, 'context.keepRecentRounds'),
  };
}

export function parseRunConfig(value: unknown): RunConfig {
  const input = record(value, 'run config', ['schemaVersion', 'variant', 'model', 'budget', 'context', 'workspace', 'writable', 'sessionPath']);
  if (input.schemaVersion !== 1) throw new Error('schemaVersion: expected 1');
  return {
    schemaVersion: 1,
    variant: parseVariant(input.variant),
    model: parseModelConfig(input.model),
    budget: parseBudget(input.budget),
    context: parseContextConfig(input.context),
    workspace: string(input.workspace, 'workspace'),
    writable: uniqueStrings(input.writable, 'writable', relativePath, true),
    sessionPath: string(input.sessionPath, 'sessionPath'),
  };
}
