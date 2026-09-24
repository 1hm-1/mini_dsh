import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runEvaluation } from '../eval/runner.js';
import { smokeConfig } from '../eval/smoke.js';
import { verify } from '../eval/verify.js';
import { readJournal } from '../src/journal.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import type { ModelResponse } from '../src/types.js';

const reply = (content: string, calls: ModelResponse['calls'] = []): ModelResponse => ({ content, calls,
  finish: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 40, outputTokens: 20 },
  actualModel: 'offline-context-stress', fingerprint: null });

test('C01/C02/R07/E06 baseline and context mock matrix verifies at the unchanged default context window', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'context-matrix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskRoot = path.join(root, 'tasks');
  await cp(path.resolve('tests/fixtures/eval-smoke'), path.join(taskRoot, 'eval-smoke'), { recursive: true });
  const config = { ...smokeConfig(path.join(root, 'runs')), variants: ['baseline', 'context'], repeats: 1,
    budget: { maxModelRequests: 16, maxToolCalls: 24, timeoutMs: 10000, maxOutputTokens: 4096, maxInputChars: 128000 } };
  const run = await runEvaluation(config, { projectRoot: root, smokeTaskRoot: taskRoot,
    modelPlugin: ({ model, accounting }) => {
      let workers = 0;
      const step: MockStep = request => {
        if (request.kind === 'summary') return reply('Source was read. Preserve the requested addition fix; no tests have been executed by the agent.');
        workers++;
        // Synthetic long history is confined to this engineering fixture, never Benchmark v1.
        if (workers <= 5) return reply('Observed source. '.repeat(400), [
          { id: `read-${workers}`, name: 'read_file', arguments: '{"path":"sum.mjs"}' },
        ]);
        if (workers === 6) return reply('', [{ id: 'edit', name: 'edit_file',
          arguments: '{"path":"sum.mjs","oldText":"a - b","newText":"a + b"}' }]);
        return reply('Fixed sum.');
      };
      return mockModelPlugin({ model, accounting, script: Array.from({ length: 16 }, () => step) });
    } });
  assert.deepEqual(config.context, { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 });
  assert.equal(run.manifest.provider, 'mock');
  assert.equal(run.attempts.length, 2); assert.ok(run.attempts.every(a => a.passed));
  const baseline = run.attempts.find(a => a.variant === 'baseline')!;
  const context = run.attempts.find(a => a.variant === 'context')!;
  assert.equal(baseline.agent.compactions, 0); assert.equal(baseline.agent.summaryRequests, 0);
  assert.ok(context.agent.compactions >= 1); assert.equal(context.agent.summaryRequests, context.agent.compactions);
  assert.equal(context.agent.modelRequests, context.agent.workerRequests + context.agent.summaryRequests);
  assert.equal(context.agent.workerRequests, baseline.agent.workerRequests);
  assert.ok(context.agent.modelRequests <= 16);
  assert.equal((await verify(run.runRoot)).passed, true);
  assert.ok(context.artifactPaths.journal);
  const journal = await readJournal(context.artifactPaths.journal);
  assert.equal(journal.events.filter(e => e.type === 'context_compacted').length, context.agent.compactions);
  assert.ok((await readFile(path.join(run.runRoot, 'report.md'), 'utf8')).includes('mock'));
});
