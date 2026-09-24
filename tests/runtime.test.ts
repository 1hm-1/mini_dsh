import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { readJournal } from '../src/journal.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { createRuntime, type RuntimeOptions } from '../src/runtime.js';
import type { ModelResponse, RunConfig } from '../src/types.js';

const execFileAsync = promisify(execFile);
const response = (content: string, calls: ModelResponse['calls'] = []): ModelResponse => ({
  content, calls, finish: calls.length ? 'tool_calls' : 'stop',
  usage: { inputTokens: 3, outputTokens: 2 }, actualModel: 'fixture', fingerprint: null,
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const sessionPath = path.join(root, 'run.jsonl');
  const config: RunConfig = {
    schemaVersion: 1, variant: 'baseline',
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'fixture', temperature: 0 },
    budget: { maxModelRequests: 5, maxToolCalls: 5, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace, writable: ['math.mjs'], sessionPath,
  };
  const modelPlugin = (script: readonly MockStep[]) =>
    ({ model, accounting }: Parameters<NonNullable<RuntimeOptions['modelPlugin']>>[0]) =>
      mockModelPlugin({ model, accounting, script });
  return { root, workspace, sessionPath, config, modelPlugin };
}

test('runtime executes a file edit, external Node test, and durable result', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.workspace, 'math.mjs'), 'export const add = (a, b) => a - b;\n');
  await writeFile(path.join(f.workspace, 'math.test.mjs'),
    "import { test } from 'node:test'; import { strict as assert } from 'node:assert'; import { add } from './math.mjs'; test('add', () => assert.equal(add(2, 3), 5));\n");
  const script: MockStep[] = [
    request => { assert.equal(request.messages[0]?.role, 'user'); return response('', [{ id: 'r', name: 'read_file', arguments: '{"path":"math.mjs"}' }]); },
    () => response('', [{ id: 'e', name: 'edit_file', arguments: '{"path":"math.mjs","oldText":"a - b","newText":"a + b"}' }]),
    () => response('Fixed the addition.'),
  ];
  const runtime = await createRuntime(f.config, { modelPlugin: f.modelPlugin(script) });
  const result = await runtime.run('Fix add in math.mjs');
  assert.equal(result.termination, 'completed');
  assert.equal(result.modelRequests, 3);
  assert.equal(result.toolCalls, 2);
  assert.equal(result.answer, 'Fixed the addition.');
  assert.equal(runtime.context.has('agentLoop'), false);
  await execFileAsync(process.execPath, ['--test', 'math.test.mjs'], { cwd: f.workspace });
  const replay = await readJournal(f.sessionPath);
  assert.equal(replay.status, 'complete');
  assert.deepEqual((replay.events.at(-1)?.data as { result: unknown }).result, result);
  await assert.rejects(runtime.run('again'), /once|closed|disposed/i);
  await runtime.dispose();
});

test('runtime rejects missing key before journal creation', async t => {
  const f = await fixture(t);
  const prior = process.env.HARNESS_API_KEY;
  delete process.env.HARNESS_API_KEY;
  try { await assert.rejects(createRuntime(f.config), /HARNESS_API_KEY/); }
  finally { if (prior === undefined) delete process.env.HARNESS_API_KEY; else process.env.HARNESS_API_KEY = prior; }
  await assert.rejects(readFile(f.sessionPath), /ENOENT/);
});

test('runtime snapshots config and isolates sessions and budgets', async t => {
  const f = await fixture(t);
  const second = path.join(f.root, 'second.jsonl');
  const runtime = await createRuntime(f.config, { modelPlugin: f.modelPlugin([response('one')]) });
  f.config.writable.push('forbidden.mjs');
  f.config.budget.maxModelRequests = 0;
  const another = await createRuntime({ ...f.config, budget: { ...f.config.budget, maxModelRequests: 1 }, sessionPath: second },
    { modelPlugin: f.modelPlugin([response('two')]) });
  assert.equal((await runtime.run('first')).modelRequests, 1);
  assert.equal((await another.run('second')).answer, 'two');
  assert.equal((await readJournal(f.sessionPath)).events[0]?.type, 'run_start');
  assert.equal((await readJournal(second)).events[0]?.type, 'run_start');
});

test('dispose during a run cancels and waits for the model callback', async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const runtime = await createRuntime(f.config, { modelPlugin: f.modelPlugin([async () => {
    entered.resolve(); await gate.promise; return response('late');
  }]) });
  const run = runtime.run('wait');
  await entered.promise;
  let disposed = false;
  const cleanup = runtime.dispose().then(() => { disposed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(disposed, false);
  gate.resolve();
  assert.equal((await run).termination, 'cancelled');
  await cleanup;
  assert.equal(runtime.context.has('model'), false);
  await runtime.dispose();
  await assert.rejects(runtime.run('again'), /once|closed|disposed/i);
});

test('startup failure cleans previously loaded services', async t => {
  const f = await fixture(t);
  await assert.rejects(createRuntime(f.config, { modelPlugin: () => ({
    name: 'broken-model', dependencies: ['session'], setup(ctx) {
      assert.equal(ctx.has('tools'), true);
      throw new Error('startup failed');
    },
  }) }), /startup failed/);
  const runtime = await createRuntime({ ...f.config, sessionPath: path.join(f.root, 'retry.jsonl') },
    { modelPlugin: f.modelPlugin([response('ok')]) });
  assert.equal((await runtime.run('retry')).termination, 'completed');
});
