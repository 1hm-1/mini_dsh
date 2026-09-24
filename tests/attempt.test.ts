import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadTask } from '../eval/assets.js';
import { runAttempt } from '../eval/attempt.js';
import type { EvalConfig, ScheduleEntry } from '../eval/contracts.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';

const source = path.resolve('tests/fixtures/eval-smoke');
const config: EvalConfig = {
  schemaVersion: 1, phase: 'smoke', benchmarkManifest: null, taskIds: ['eval-smoke'], variants: ['baseline'], repeats: 1,
  model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'fixture', temperature: 0 },
  budget: { maxModelRequests: 2, maxToolCalls: 2, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 20000 },
  context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 }, outputDir: 'unused',
};
const entry: ScheduleEntry = { taskId: 'eval-smoke', variant: 'baseline', repeat: 1, orderIndex: 0 };

test('E06 attempt retains complete failed evidence and isolates hidden assets', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'attempt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskRoot = path.join(root, 'eval-smoke');
  await cp(source, taskRoot, { recursive: true });
  const task = await loadTask(taskRoot);
  const runRoot = path.join(root, 'run');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(runRoot);
  let called = 0;
  const result = await runAttempt({ task, config, entry, runId: 'test', runRoot, implementationCommit: null,
    benchmarkCommit: null, modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script: [request => {
      called++;
      assert.equal(request.messages[0]?.role, 'user');
      assert.equal((request.messages[0] as { content: string }).content, task.prompt);
      assert.equal(request.system.includes(task.spec.acceptanceTest), false);
      return { content: 'Unable to fix', calls: [], finish: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null };
    }] }) });
  assert.equal(called, 1);
  assert.equal(result.agent.termination, 'completed');
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, 'public_test');
  assert.deepEqual(JSON.parse(await readFile(result.artifactPaths.result!, 'utf8')), result);
  for (const key of ['before', 'after', 'changes', 'journal', 'publicOutput', 'acceptanceOutput']) {
    assert.ok((await readFile(result.artifactPaths[key]!, 'utf8')).length > 0, key);
  }
  const attemptDir = path.dirname(result.artifactPaths.result!);
  assert.equal((await readdir(attemptDir)).includes('.workspace'), false);
  assert.equal((await readFile(result.artifactPaths.before!, 'utf8')).includes('acceptance.test.mjs'), false);
  await assert.rejects(runAttempt({ task, config, entry, runId: 'test', runRoot, implementationCommit: null,
    benchmarkCommit: null, modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script: [] }) }));
});


test('M8.3 attempt accepts all variants and charges optimizer calls to each budget', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'attempt-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskRoot = path.join(root, 'eval-smoke');
  await cp(source, taskRoot, { recursive: true });
  const task = await loadTask(taskRoot);
  const runRoot = path.join(root, 'run');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(runRoot);
  const allVariants: EvalConfig = { ...config, variants: ['baseline', 'context', 'optimizer', 'full'] };
  const options = { task, config: allVariants, runId: 'test', runRoot, implementationCommit: null, benchmarkCommit: null,
    modelPlugin: ({ model, accounting }: Parameters<NonNullable<Parameters<typeof runAttempt>[0]['modelPlugin']>>[0]) =>
      mockModelPlugin({ model, accounting, script: [
        request => ({ content: request.kind === 'optimizer' ? 'Improved task wording' : 'No edit',
          calls: [], finish: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null }),
        { content: 'No edit', calls: [], finish: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null },
      ] }) };
  for (const variant of allVariants.variants) {
    const result = await runAttempt({ ...options, entry: { ...entry, variant } });
    assert.equal(result.variant, variant);
    assert.equal(result.agent.termination, 'completed');
    assert.equal(result.agent.optimizerRequests, variant === 'optimizer' || variant === 'full' ? 1 : 0);
    assert.equal(result.agent.summaryRequests, 0);
  }
  assert.equal((await readdir(path.join(runRoot, 'attempts'))).length, 4);
});
