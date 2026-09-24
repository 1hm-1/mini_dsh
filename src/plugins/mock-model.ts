import type { MiniPlugin } from '../plugin.js';
import type { Accounting } from '../accounting.js';
import type { ModelConfig, ModelRequest, ModelResponse } from '../types.js';
import { parseModelConfig } from '../config.js';
import { parseModelResponse } from '../model-events.js';
import { createModelService, ProviderModelError } from './model-common.js';

export type MockStep = ModelResponse | ((request: ModelRequest, signal: AbortSignal, index: number) => ModelResponse | Promise<ModelResponse>);

export function mockModelPlugin(options: { model: ModelConfig; accounting: Accounting; script: readonly MockStep[] }): MiniPlugin {
  return { name: 'mock-model', dependencies: ['session'], setup(ctx) {
    const script = options.script.map(step => typeof step === 'function' ? step : parseModelResponse(step));
    let index = 0;
    const service = createModelService(parseModelConfig(options.model), options.accounting, ctx.get('session'), async (_body, request, signal) => {
      const step = script[index++];
      if (!step) throw new ProviderModelError();
      if (typeof step === 'function') return step(request, signal, index - 1);
      return parseModelResponse(step);
    });
    const remove = ctx.provide('model', service);
    return () => { service.close(); remove(); };
  } };
}
