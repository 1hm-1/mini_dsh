import path from 'node:path';
import { Accounting } from './accounting.js';
import { parseRunConfig, variantFlags } from './config.js';
import { Context } from './context.js';
import type { MiniPlugin } from './plugin.js';
import { agentLoopPlugin } from './plugins/agent-loop.js';
import { contextManagerPlugin } from './plugins/context-manager.js';
import { eventsPlugin } from './plugins/events.js';
import { fileToolsPlugin } from './plugins/file-tools.js';
import { httpModelPlugin } from './plugins/http-model.js';
import { jsonlPersistencePlugin } from './plugins/jsonl-persistence.js';
import { memorySessionPlugin } from './plugins/memory-session.js';
import { permissionsPlugin } from './plugins/permissions.js';
import { toolsPlugin } from './plugins/tools.js';
import type { ModelConfig, RunResult } from './types.js';

export const BASE_SYSTEM = 'Follow the original user task. Use only the available file tools. Read files before editing them. Change only files you are permitted to write. Keep edits focused and report the result clearly.';

export interface RuntimeOptions {
  signal?: AbortSignal;
  modelPlugin?: (options: { model: ModelConfig; accounting: Accounting }) => MiniPlugin;
}

export interface Runtime {
  readonly context: Context;
  run(input: string): Promise<RunResult>;
  dispose(): Promise<void>;
}

export async function createRuntime(config: unknown, options: RuntimeOptions = {}): Promise<Runtime> {
  // Validate and copy caller-owned input before the first asynchronous setup step.
  const parsed = parseRunConfig(config);
  const flags = variantFlags(parsed.variant);
  if (flags.context || flags.optimizer) throw new Error(`variant ${parsed.variant} is not implemented`);
  if (options === null || typeof options !== 'object'
    || options.signal !== undefined && !(options.signal instanceof AbortSignal)
    || options.modelPlugin !== undefined && typeof options.modelPlugin !== 'function') {
    throw new Error('invalid runtime options');
  }
  const modelFactory = options.modelPlugin ?? httpModelPlugin;
  const externalSignal = options.signal;
  if (!options.modelPlugin && !process.env.HARNESS_API_KEY) throw new Error('HARNESS_API_KEY is required');

  const workspace = path.resolve(process.cwd(), parsed.workspace);
  const sessionPath = path.resolve(process.cwd(), parsed.sessionPath);
  const controller = new AbortController();
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  const accounting = new Accounting(parsed.budget, signal);
  const context = new Context();
  try {
    await context.use(jsonlPersistencePlugin({ workspace, sessionPath }));
    await context.use(eventsPlugin());
    await context.use(memorySessionPlugin());
    await context.use(permissionsPlugin(parsed.writable));
    await context.use(toolsPlugin());
    await context.use(fileToolsPlugin(workspace));
    await context.use(modelFactory({ model: parsed.model, accounting }));
    await context.use(contextManagerPlugin({ context: parsed.context }));
    await context.use(agentLoopPlugin({ system: BASE_SYSTEM, accounting }));
  } catch (error) {
    try { await context.dispose(); } catch { /* preserve the startup error */ }
    throw error;
  }

  let started = false;
  let closed = false;
  let active: Promise<RunResult> | undefined;
  let cleaning: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    closed = true;
    cleaning ??= context.dispose();
    return cleaning;
  };
  return {
    context,
    run(input) {
      if (started || closed) return Promise.reject(new Error('runtime can run only once or is disposed'));
      started = true;
      active = (async () => {
        try { return await context.get('agentLoop').run(input, { signal }); }
        finally { await cleanup(); }
      })();
      return active;
    },
    async dispose() {
      if (active && !cleaning) {
        controller.abort();
        try { await active; } catch { /* cleanup below reports its own error */ }
      }
      await cleanup();
    },
  };
}
