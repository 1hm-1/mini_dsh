import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectJournal } from '../eval/journal-metrics.js';
import { readJournal } from '../src/journal.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { createRuntime } from '../src/runtime.js';
import type { ModelResponse, RunConfig } from '../src/types.js';

const answer = (content: string): ModelResponse => ({ content, calls: [], finish: 'stop',
  usage: { inputTokens: 5, outputTokens: 3 }, actualModel: 'offline', fingerprint: null });
async function fixture(t: test.TestContext, script: MockStep[], budget: Partial<RunConfig['budget']> = {}, controller?: AbortController) {
  const root = await mkdtemp(path.join(tmpdir(), 'optimizer-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  const config: RunConfig = { schemaVersion: 1, variant: 'optimizer',
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'offline', temperature: 0 },
    budget: { maxModelRequests: 16, maxToolCalls: 24, maxOutputTokens: 4096, maxInputChars: 12000, timeoutMs: 10000, ...budget },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace, writable: [], sessionPath: path.join(root, 'journal.jsonl') };
  const runtime = await createRuntime(config, { ...(controller ? { signal: controller.signal } : {}),
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script }) });
  return { runtime, config };
}

test('O02 optimizer consumes the last shared request and cannot grant a free worker', async t => {
  const f = await fixture(t, [answer('Preserve the original task.')], { maxModelRequests: 1 });
  const result = await f.runtime.run('Task');
  assert.equal(result.termination, 'request_limit');
  assert.equal(result.modelRequests, 1); assert.equal(result.optimizerRequests, 1); assert.equal(result.workerRequests, 0);
  assert.deepEqual(inspectJournal(await readJournal(f.config.sessionPath), f.config).result, result);
});

test('O02 initial optimizer input overflow makes no provider request', async t => {
  let calls = 0;
  const f = await fixture(t, [() => { calls++; return answer('unused'); }], { maxInputChars: 100 });
  const result = await f.runtime.run('Original task');
  assert.equal(result.termination, 'context_overflow'); assert.equal(result.modelRequests, 0); assert.equal(calls, 0);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.events.some(e => e.type === 'request' || e.type === 'context_observation'), false);
  assert.deepEqual(inspectJournal(journal, f.config).result, result);
});

test('O02 oversized suggestion retains its cost and rejected worker observation', async t => {
  const f = await fixture(t, [answer('s'.repeat(18000))]);
  const result = await f.runtime.run('Original task');
  assert.equal(result.termination, 'context_overflow'); assert.equal(result.optimizerRequests, 1); assert.equal(result.workerRequests, 0);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.events.filter(e => e.type === 'context_observation').length, 1);
  assert.deepEqual(inspectJournal(journal, f.config).result, result);
});

test('O02 missing optimizer usage keeps totals unknown and retains known worker usage', async t => {
  const f = await fixture(t, [{ ...answer('Do the task.'), usage: { inputTokens: null, outputTokens: null } }, answer('Done')]);
  const result = await f.runtime.run('Original task');
  assert.equal(result.termination, 'completed'); assert.equal(result.modelRequests, 2);
  assert.equal(result.inputTokens, null); assert.equal(result.outputTokens, null);
  assert.equal(result.knownInputTokens, 5); assert.equal(result.knownOutputTokens, 3);
  assert.deepEqual(inspectJournal(await readJournal(f.config.sessionPath), f.config).result, result);
});

test('O02 optimizer tool call fails without dispatch or worker fallback', async t => {
  const f = await fixture(t, [{ ...answer(''), finish: 'tool_calls', calls: [{ id: 'bad', name: 'read_file', arguments: '{"path":"secret"}' }] }]);
  const result = await f.runtime.run('Original task');
  assert.equal(result.termination, 'model_error'); assert.equal(result.optimizerRequests, 1); assert.equal(result.workerRequests, 0);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.events.some(e => e.type === 'tool_start'), false);
  assert.deepEqual(inspectJournal(journal, f.config).result, result);
});

test('O02 cancellation during durable optimizer response wins over empty output', async t => {
  const controller = new AbortController();
  const f = await fixture(t, [answer('')], {}, controller);
  f.runtime.context.get('events').on(event => { if (event.type === 'response') controller.abort(); });
  const result = await f.runtime.run('Original task');
  assert.equal(result.termination, 'cancelled'); assert.equal(result.optimizerRequests, 1); assert.equal(result.workerRequests, 0);
  assert.deepEqual(inspectJournal(await readJournal(f.config.sessionPath), f.config).result, result);
});

test('O02 optimizer response persistence failure leaves incomplete evidence and no worker', async t => {
  const f = await fixture(t, [answer('Task')]);
  const persistence = f.runtime.context.get('persistence');
  const append = persistence.append.bind(persistence);
  persistence.append = async event => { if (event.type === 'response') throw Error('injected disk failure'); await append(event); };
  const result = await f.runtime.run('Original task');
  assert.equal(result.termination, 'io_error'); assert.equal(result.optimizerRequests, 1); assert.equal(result.workerRequests, 0);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.status, 'incomplete'); assert.equal(journal.events.some(e => e.type === 'run_end'), false);
});

test('O02 dispose waits for in-flight optimizer and rejects late success', async t => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, [async () => { started(); await gate; return answer('late'); }]);
  const running = f.runtime.run('Original task'); await ready;
  let disposed = false; const closing = f.runtime.dispose().then(() => { disposed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(disposed, false); release();
  const result = await running; await closing;
  assert.equal(result.termination, 'cancelled'); assert.equal(result.optimizerRequests, 1); assert.equal(result.workerRequests, 0);
  assert.deepEqual(inspectJournal(await readJournal(f.config.sessionPath), f.config).result, result);
});
