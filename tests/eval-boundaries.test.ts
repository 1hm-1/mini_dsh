import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { runEvaluation } from '../eval/runner.js';
import { smokeConfig } from '../eval/smoke.js';
import { readJournal } from '../src/journal.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import type { RuntimeOptions } from '../src/runtime.js';
import type { ModelResponse } from '../src/types.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-boundaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tasks = path.join(root, 'tasks');
  await mkdir(tasks);
  await cp(path.resolve('tests/fixtures/eval-smoke'), path.join(tasks, 'eval-smoke'), { recursive: true });
  return { root, tasks, config: smokeConfig(path.join(root, 'runs')) };
}
const response = (calls: ModelResponse['calls'] = []): ModelResponse => ({
  content: calls.length ? '' : 'done', calls, finish: calls.length ? 'tool_calls' : 'stop',
  usage: { inputTokens: null, outputTokens: null }, actualModel: 'scripted-test', fingerprint: null,
});

test('E01/E02 runner saves schedule before model calls and retains model failure before later success', async t => {
  const f = await fixture(t);
  let factories = 0;
  const seen: string[] = [];
  const modelPlugin: NonNullable<RuntimeOptions['modelPlugin']> = ({ model, accounting }) => {
    const attempt = ++factories;
    const script: MockStep[] = [async request => {
      const runs = await readdir(f.config.outputDir);
      assert.equal(runs.length, 1);
      const manifest = JSON.parse(await readFile(path.join(f.config.outputDir, runs[0]!, 'manifest.json'), 'utf8'));
      assert.equal(manifest.schedule.length, 2);
      seen.push(JSON.stringify(request.messages));
      assert.doesNotMatch(seen.at(-1)!, /CANARY|acceptance|reference/i);
      assert.equal(request.messages.length, 1);
      return response([{ id: 'list', name: 'list_files', arguments: '{}' }]);
    }, request => {
      const text = JSON.stringify(request.messages);
      assert.doesNotMatch(text, /CANARY|acceptance|reference/i);
      if (attempt === 1) throw new Error('SIMULATED-PROVIDER-SECRET');
      return response([{ id: 'edit', name: 'edit_file', arguments: '{"path":"sum.mjs","oldText":"a - b","newText":"a + b"}' }]);
    }, response()];
    return mockModelPlugin({ model, accounting, script });
  };
  const result = await runEvaluation(f.config, { projectRoot: f.root, smokeTaskRoot: f.tasks, modelPlugin });
  assert.equal(factories, 2);
  assert.equal(seen.length, 2);
  const [first, second] = result.attempts;
  assert.ok(first && second);
  assert.equal(first.agent.termination, 'model_error');
  assert.equal(first.agent.modelRequests, 2);
  assert.equal(first.passed, false);
  assert.equal(second.passed, true);
  assert.equal(second.agent.modelRequests, 3);
  assert.equal(first.agent.inputTokens, null);
  assert.equal(second.agent.inputTokens, null);
  assert.notEqual(first.config.workspace, second.config.workspace);
  assert.equal(await readFile(first.artifactPaths.before!, 'utf8'), await readFile(second.artifactPaths.before!, 'utf8'));
  for (const attempt of result.attempts) {
    assert.deepEqual(JSON.parse(await readFile(attempt.artifactPaths.result!, 'utf8')), attempt);
    const journal = await readJournal(attempt.artifactPaths.journal!);
    assert.equal(journal.status, 'complete');
    assert.equal(journal.events[0]?.seq, 1);
    assert.deepEqual((journal.events.at(-1)?.data as { result: unknown }).result, attempt.agent);
    assert.doesNotMatch(await readFile(attempt.artifactPaths.journal!, 'utf8'), /SIMULATED-PROVIDER-SECRET/);
    for (const check of [attempt.publicTest, attempt.acceptanceTest]) {
      assert.equal(check.outputHash, createHash('sha256').update(await readFile(check.outputPath)).digest('hex'));
    }
    await assert.rejects(readdir(attempt.config.workspace), /ENOENT/);
  }
});

test('runner captures configuration and options before its first asynchronous step', async t => {
  const f = await fixture(t);
  f.config.repeats = 1;
  const options = { projectRoot: f.root, smokeTaskRoot: f.tasks,
    modelPlugin: ({ model, accounting }: Parameters<NonNullable<RuntimeOptions['modelPlugin']>>[0]) =>
      mockModelPlugin({ model, accounting, script: [response()] }) };
  const pending = runEvaluation(f.config, options);
  f.config.taskIds[0] = 'nonexistent';
  f.config.repeats = 10;
  f.config.budget.maxModelRequests = 999;
  options.modelPlugin = () => { throw new Error('mutated'); };
  const result = await pending;
  assert.equal(result.attempts.length, 1);
  assert.equal(result.manifest.config.repeats, 1);
  assert.equal(result.manifest.config.budget.maxModelRequests, 5);
  assert.deepEqual(result.manifest.config.taskIds, ['eval-smoke']);
});

test('runner rejects output inside source and symlink output parents before model calls', async t => {
  const f = await fixture(t);
  let calls = 0;
  const options = { projectRoot: f.root, smokeTaskRoot: f.tasks,
    modelPlugin: ({ model, accounting }: Parameters<NonNullable<RuntimeOptions['modelPlugin']>>[0]) => {
      calls++;
      return mockModelPlugin({ model, accounting, script: [response()] });
    } };
  const nested = path.join(f.tasks, 'eval-smoke', 'new-parent', 'runs');
  await assert.rejects(runEvaluation({ ...f.config, outputDir: nested }, options));
  await assert.rejects(readdir(path.dirname(nested)), /ENOENT/);
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(f.root, 'alias'));
  await assert.rejects(runEvaluation({ ...f.config, outputDir: path.join(f.root, 'alias', 'runs') }, options));
  assert.deepEqual(await readdir(outside), []);
  assert.equal(calls, 0);
});
