import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createRuntime, type RuntimeOptions } from '../src/runtime.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import { readJournal } from '../src/journal.js';
import type { MiniContext } from '../src/plugin.js';
import type { ModelResponse, RunConfig } from '../src/types.js';

const done = (): ModelResponse => ({ content: 'done', calls: [], finish: 'stop',
  usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'test', fingerprint: null });
async function fixture(t: TestContext): Promise<RunConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'file.txt'), 'old');
  return { schemaVersion: 1, variant: 'baseline',
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'test', temperature: 0 },
    budget: { maxModelRequests: 2, maxToolCalls: 2, timeoutMs: 5000, maxOutputTokens: 64, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace, writable: ['file.txt'], sessionPath: path.join(root, 'run.jsonl') };
}
const services = ['agentLoop', 'contextManager', 'model', 'tools', 'permissions', 'session', 'persistence', 'events'];
function assertClosed(ctx: MiniContext) { for (const service of services) assert.equal(ctx.has(service), false, service); }

test('K04 runtime snapshots configuration and model factory before asynchronous setup', async t => {
  const config = await fixture(t);
  const originalJournal = config.sessionPath;
  let calls = 0;
  const options: RuntimeOptions = { modelPlugin: modelOptions => mockModelPlugin({ ...modelOptions, script: [request => {
    calls++;
    assert.equal(request.maxOutputTokens, 64);
    assert.deepEqual(request.messages, [{ role: 'user', content: 'task' }]);
    return done();
  }] }) };
  const pending = createRuntime(config, options);
  config.model.id = 'mutated';
  config.budget.maxOutputTokens = 1;
  config.writable.length = 0;
  config.sessionPath = path.join(path.dirname(originalJournal), 'other.jsonl');
  options.modelPlugin = () => { throw new Error('mutable factory used'); };
  const runtime = await pending;
  t.after(() => runtime.dispose());
  assert.equal(runtime.context.get('permissions').check('write_file', { path: 'file.txt' }).allowed, true);
  const result = await runtime.run('task');
  assert.equal(result.termination, 'completed');
  assert.equal(calls, 1);
  assertClosed(runtime.context);
  const log = await readJournal(originalJournal);
  const request = log.events.find(e => e.type === 'request')!;
  assert.equal(JSON.parse((request.data as { body: string }).body).model, 'test');
});

test('K03 model setup failure clears upstream services and closes the created journal', async t => {
  const config = await fixture(t);
  let captured: MiniContext | undefined;
  let closeCalls = 0;
  await assert.rejects(createRuntime(config, { modelPlugin: () => ({ name: 'broken-model', setup(ctx) {
    captured = ctx;
    const persistence = ctx.get('persistence');
    const close = persistence.close.bind(persistence);
    persistence.close = async () => { closeCalls++; await close(); };
    throw new Error('injected setup failure');
  } }) }), /injected setup failure/);
  assert.ok(captured);
  assertClosed(captured);
  assert.ok(closeCalls >= 1);
  assert.equal(await readFile(config.sessionPath, 'utf8'), '');
});

test('K02 runtime cleanup failure rejects run while still removing all upstream services', async t => {
  const config = await fixture(t);
  let cleaned = 0;
  const runtime = await createRuntime(config, { modelPlugin: options => {
    const plugin = mockModelPlugin({ ...options, script: [done()] });
    return { ...plugin, async setup(ctx) {
      const cleanup = await plugin.setup(ctx);
      return async () => { cleaned++; await cleanup?.(); throw new Error('injected cleanup failure'); };
    } };
  } });
  await assert.rejects(runtime.run('task'), /injected cleanup failure/);
  assert.equal(cleaned, 1);
  assertClosed(runtime.context);
  // The durable outcome precedes cleanup; cleanup failure must not rewrite it.
  const journal = await readJournal(config.sessionPath);
  assert.equal(journal.status, 'complete');
  assert.equal((journal.events.at(-1)!.data as { result: { termination: string } }).result.termination, 'completed');
  await runtime.dispose().catch(() => {});
  assert.equal(cleaned, 1);
});

test('R04 runtime dispose waits for active provider settlement before removing Session', { timeout: 3000 }, async t => {
  const config = await fixture(t);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let modelSignal: AbortSignal | undefined;
  const runtime = await createRuntime(config, { modelPlugin: options => mockModelPlugin({ ...options, script: [async (_input, signal) => {
    modelSignal = signal;
    entered.resolve();
    await gate.promise;
    return done();
  }] }) });
  t.after(() => runtime.dispose());
  const run = runtime.run('task');
  await entered.promise;
  let disposed = false;
  const closing = runtime.dispose().then(() => { disposed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(modelSignal?.aborted, true);
    assert.equal(disposed, false);
    assert.equal(runtime.context.has('session'), true);
    await assert.rejects(runtime.run('second'));
  } finally { gate.resolve(); }
  const result = await run;
  await closing;
  assert.equal(result.termination, 'cancelled');
  assert.equal(result.modelRequests, 1);
  assertClosed(runtime.context);
  const journal = await readJournal(config.sessionPath);
  assert.equal(journal.status, 'complete');
  assert.deepEqual((journal.events.at(-1)!.data as { result: unknown }).result, result);
});

test('R06 runtime closes services after a Session write failure without a fabricated ending', async t => {
  const config = await fixture(t);
  let calls = 0;
  const runtime = await createRuntime(config, { modelPlugin: options => mockModelPlugin({ ...options, script: [() => { calls++; return done(); }] }) });
  t.after(() => runtime.dispose());
  const persistence = runtime.context.get('persistence');
  const append = persistence.append.bind(persistence);
  persistence.append = async event => {
    if (event.type === 'request') throw new Error('private failure');
    await append(event);
  };
  const result = await runtime.run('task');
  assert.equal(result.termination, 'io_error');
  assert.equal(calls, 0);
  assertClosed(runtime.context);
  const journal = await readJournal(config.sessionPath);
  assert.equal(journal.status, 'incomplete');
  assert.equal(journal.events.some(e => e.type === 'run_end'), false);
});

test('K04 runtime captures the original cancellation signal before asynchronous plugin setup', async t => {
  const config = await fixture(t);
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const options: RuntimeOptions = { signal: controller.signal, modelPlugin: modelOptions => {
    const plugin = mockModelPlugin({ ...modelOptions, script: [() => { calls++; return done(); }] });
    return { ...plugin, async setup(ctx) { entered.resolve(); await gate.promise; return plugin.setup(ctx); } };
  } };
  const pending = createRuntime(config, options);
  await entered.promise;
  options.signal = new AbortController().signal;
  controller.abort();
  gate.resolve();
  const runtime = await pending;
  const result = await runtime.run('task');
  assert.equal(result.termination, 'cancelled');
  assert.equal(calls, 0);
  assertClosed(runtime.context);
  assert.equal((await readJournal(config.sessionPath)).status, 'complete');
});

test('K04 disposing one runtime removes its tool registrations without affecting another workspace', async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  const options: RuntimeOptions = { modelPlugin: input => mockModelPlugin({ ...input, script: [done()] }) };
  const first = await createRuntime(a, options);
  const second = await createRuntime(b, options);
  try {
    const firstTools = first.context.get('tools');
    const secondTools = second.context.get('tools');
    assert.equal(firstTools.schemas().length, 5);
    await first.dispose();
    assert.throws(() => firstTools.schemas(), /closed/);
    const call = { id: 'write', name: 'write_file', arguments: '{"path":"file.txt","content":"new"}' };
    await assert.rejects(firstTools.execute(call, new AbortController().signal), /closed/);
    assert.equal((await secondTools.execute(call, new AbortController().signal)).ok, true);
    assert.equal(await readFile(path.join(a.workspace, 'file.txt'), 'utf8'), 'old');
    assert.equal(await readFile(path.join(b.workspace, 'file.txt'), 'utf8'), 'new');
    assert.equal((await second.run('task')).termination, 'completed');
    assertClosed(second.context);
  } finally { await first.dispose(); await second.dispose(); }
});
