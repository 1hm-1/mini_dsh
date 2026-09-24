import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runEvaluation } from '../eval/runner.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import type { EvalConfig } from '../eval/contracts.js';

const source = path.resolve('tests/fixtures/eval-smoke');
const config = (outputDir: string): EvalConfig => ({
  schemaVersion: 1, phase: 'smoke', benchmarkManifest: null, taskIds: ['eval-smoke'], variants: ['baseline'], repeats: 2,
  model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'fixture', temperature: 0 },
  budget: { maxModelRequests: 2, maxToolCalls: 2, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 20000 },
  context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 }, outputDir,
});

test('E06 smoke runner preflights and records failed attempts without retry', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(source, path.join(root, 'tasks/eval-smoke'), { recursive: true });
  let calls = 0;
  const result = await runEvaluation(config('runs'), { projectRoot: root, smokeTaskRoot: path.join(root, 'tasks'),
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script: [() => {
      calls++;
      return { content: 'No edit', calls: [], finish: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null };
    }] }) });
  assert.equal(calls, 2);
  assert.deepEqual(result.attempts.map(item => item.repeat), [1, 2]);
  assert.equal(result.attempts.every(item => !item.passed), true);
  assert.equal(result.manifest.provider, 'mock');
  assert.equal(result.manifest.schedule.length, 2);
  assert.deepEqual(JSON.parse(await readFile(path.join(result.runRoot, 'manifest.json'), 'utf8')), result.manifest);
  assert.equal((await readdir(path.join(result.runRoot, 'attempts'))).length, 2);
});

test('E06 smoke runner schedules all four variants with shared two-request budgets', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'runner-four-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(source, path.join(root, 'tasks/eval-smoke'), { recursive: true });
  const variants = ['baseline', 'context', 'optimizer', 'full'] as const;
  const result = await runEvaluation({ ...config('runs'), variants: [...variants], repeats: 1 },
    { projectRoot: root, smokeTaskRoot: path.join(root, 'tasks'), modelPlugin: ({ model, accounting }) =>
      mockModelPlugin({ model, accounting, script: [
        request => ({ content: request.kind === 'optimizer' ? 'Fix sum.' : 'No edit',
          calls: [], finish: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null }),
        { content: 'No edit', calls: [], finish: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null },
      ] }) });
  assert.deepEqual(new Set(result.manifest.schedule.map(item => item.variant)), new Set(variants));
  assert.equal(result.attempts.length, 4);
  for (const attempt of result.attempts) {
    assert.equal(attempt.agent.termination, 'completed');
    assert.equal(attempt.agent.optimizerRequests, attempt.variant === 'optimizer' || attempt.variant === 'full' ? 1 : 0);
    assert.equal(attempt.agent.workerRequests, 1);
  }
});

test('runner keeps phase matrix and bad preflight rejection before model calls', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'runner-bad-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(source, path.join(root, 'tasks/eval-smoke'), { recursive: true });
  let calls = 0;
  const modelPlugin = ({ model, accounting }: Parameters<NonNullable<NonNullable<Parameters<typeof runEvaluation>[1]>['modelPlugin']>>[0]) =>
    mockModelPlugin({ model, accounting, script: [() => { calls++; throw new Error('unexpected'); }] });
  await assert.rejects(runEvaluation({ ...config('runs'), phase: 'baseline-diagnostic', benchmarkManifest: 'benchmark/v1.json', variants: ['optimizer'] },
    { projectRoot: root, smokeTaskRoot: path.join(root, 'tasks'), modelPlugin }), /phase matrix/i);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(root, 'tasks/eval-smoke/workspace/sum.mjs'), 'export const sum = (a, b) => a + b;\n');
  await assert.rejects(runEvaluation(config('runs'), { projectRoot: root, smokeTaskRoot: path.join(root, 'tasks'), modelPlugin }), /preflight/i);
  assert.equal(calls, 0);
});

test('smoke records dirty output created after a clean Git checkout passes preflight', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'runner-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(source, path.join(root, 'tasks/eval-smoke'), { recursive: true });
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']]) {
    execFileSync('git', args, { cwd: root });
  }
  const result = await runEvaluation({ ...config('runs'), repeats: 1 }, { projectRoot: root, smokeTaskRoot: path.join(root, 'tasks'),
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script: [{
      content: 'done', calls: [], finish: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null,
    }] }) });
  assert.equal(result.manifest.dirty, true);
  assert.match(result.manifest.implementationCommit ?? '', /^[a-f0-9]{40,64}$/);
});

test('real evaluation rejects an unrelated project root before loading a benchmark', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'runner-other-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.HARNESS_API_KEY;
  process.env.HARNESS_API_KEY = 'test-key';
  try {
    await assert.rejects(runEvaluation({ ...config('runs'), phase: 'baseline-diagnostic', benchmarkManifest: 'benchmark/v1.json' },
      { projectRoot: root }), /projectRoot|runner project/i);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_API_KEY;
    else process.env.HARNESS_API_KEY = previous;
  }
});
