import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runEvaluation } from '../eval/runner.js';
import { smokeConfig } from '../eval/smoke.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import type { ModelResponse } from '../src/types.js';

const reply = (content: string, calls: ModelResponse['calls'] = []): ModelResponse => ({ content, calls,
  finish: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 40, outputTokens: 20 },
  actualModel: 'offline-optimizer-stress', fingerprint: null });

/** Synthetic engineering fixtures only; never modifies the frozen benchmark. */
export async function optimizerMatrix(root: string, projectRoot: string) {
  const taskRoot = path.join(root, 'tasks');
  for (const id of ['eval-smoke', 'eval-smoke-h']) {
    const target = path.join(taskRoot, id);
    await cp(path.join(projectRoot, 'tests/fixtures/eval-smoke'), target, { recursive: true });
    if (id.endsWith('-h')) {
      const spec = JSON.parse(await readFile(path.join(target, 'task.json'), 'utf8'));
      await writeFile(path.join(target, 'task.json'), JSON.stringify({ ...spec, id, suite: 'H' }));
      await writeFile(path.join(target, 'prompt.md'), 'MOCK_LONG_HISTORY\n' + await readFile(path.join(target, 'prompt.md'), 'utf8'));
    }
  }
  const config = { ...smokeConfig(path.join(root, 'runs')), taskIds: ['eval-smoke', 'eval-smoke-h'],
    variants: ['baseline', 'context', 'optimizer', 'full'], repeats: 2,
    budget: { maxModelRequests: 16, maxToolCalls: 24, timeoutMs: 10000, maxOutputTokens: 4096, maxInputChars: 128000 } };
  return runEvaluation(config, { projectRoot, smokeTaskRoot: taskRoot,
    modelPlugin: ({ model, accounting }) => {
      let workers = 0;
      const step: MockStep = request => {
        if (request.kind === 'optimizer') return reply('Preserve the exported sum interface, return the sum, and leave public tests unchanged.');
        if (request.kind === 'summary') return reply('Source was read; preserve the requested addition fix. Tests have not been executed by the agent.');
        workers++;
        const long = request.messages.some(m => m.role === 'user' && m.content.includes('MOCK_LONG_HISTORY'));
        const reads = long ? 5 : 1;
        if (workers <= reads) return reply(long ? 'Observed source. '.repeat(400) : '', [
          { id: `read-${workers}`, name: 'read_file', arguments: '{"path":"sum.mjs"}' },
        ]);
        if (workers === reads + 1) return reply('', [{ id: 'edit', name: 'edit_file',
          arguments: '{"path":"sum.mjs","oldText":"a - b","newText":"a + b"}' }]);
        return reply('Fixed sum.');
      };
      return mockModelPlugin({ model, accounting, script: Array.from({ length: 16 }, () => step) });
    } });
}
