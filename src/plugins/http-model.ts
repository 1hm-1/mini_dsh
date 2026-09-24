import type { MiniPlugin } from '../plugin.js';
import type { Accounting } from '../accounting.js';
import type { ModelConfig } from '../types.js';
import { parseModelConfig } from '../config.js';
import { decodeChatResponse, extractChatUsage } from '../model-protocol.js';
import { createModelService, ProviderModelError } from './model-common.js';

export function httpModelPlugin(options: { model: ModelConfig; accounting: Accounting }): MiniPlugin {
  return { name: 'http-model', dependencies: ['session'], setup(ctx) {
    const key = process.env.HARNESS_API_KEY;
    if (!key) throw new Error('HARNESS_API_KEY is required');
    const model = parseModelConfig(options.model);
    const session = ctx.get('session');
    const service = createModelService(model, options.accounting, session, async (body, _request, signal) => {
      let response: Response;
      try {
        response = await fetch(model.endpoint, {
          method: 'POST', redirect: 'manual', signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body,
        });
      } catch { throw new ProviderModelError(); }
      if (!response.ok || response.status >= 300 && response.status < 400) {
        try { await response.body?.cancel(); } catch { /* retain the HTTP status failure */ }
        throw new ProviderModelError();
      }
      let raw: unknown;
      try {
        const text = await response.text();
        raw = JSON.parse(text) as unknown;
      } catch { throw new ProviderModelError(); }
      const usage = extractChatUsage(raw);
      try { return decodeChatResponse(raw); }
      catch { throw new ProviderModelError(usage); }
    });
    const remove = ctx.provide('model', service);
    return () => { service.close(); remove(); };
  } };
}
