import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectJournal } from '../eval/journal-metrics.js';
import { Accounting, ModelCallError } from '../src/accounting.js';
import { Context } from '../src/context.js';
import { readJournal } from '../src/journal.js';
import { contextManagerPlugin } from '../src/plugins/context-manager.js';
import { eventsPlugin } from '../src/plugins/events.js';
import { memorySessionPlugin } from '../src/plugins/memory-session.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { createRuntime } from '../src/runtime.js';
import type { Event, ModelResponse, RunConfig } from '../src/types.js';

const answer = (content: string): ModelResponse => ({ content, calls: [], finish: 'stop',
  usage: { inputTokens: 5, outputTokens: 3 }, actualModel: 'offline', fingerprint: null });
const read = (id: string): ModelResponse => ({ ...answer(''), finish: 'tool_calls',
  calls: [{ id, name: 'read_file', arguments: '{"path":"fact.txt"}' }] });
async function runtimeFixture(t: test.TestContext, script: MockStep[], budget: Partial<RunConfig['budget']> = {}, controller?: AbortController) {
  const root = await mkdtemp(path.join(tmpdir(), 'context-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  await writeFile(path.join(workspace, 'fact.txt'), 'already inspected fact');
  const config: RunConfig = { schemaVersion: 1, variant: 'context',
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'offline', temperature: 0 },
    budget: { maxModelRequests: 10, maxToolCalls: 10, maxOutputTokens: 4096, maxInputChars: 12000, timeoutMs: 5000, ...budget },
    context: { estimatedWindowTokens: 1, triggerRatio: 0.5, keepRecentRounds: 1 },
    workspace, writable: [], sessionPath: path.join(root, 'journal.jsonl') };
  const runtime = await createRuntime(config, { ...(controller ? { signal: controller.signal } : {}),
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script }) });
  return { runtime, config };
}

test('C03 request budget exhausted before summary dispatch records no free auxiliary call', async t => {
  const f = await runtimeFixture(t, [read('a'), read('b')], { maxModelRequests: 2 });
  const result = await f.runtime.run('Read facts');
  assert.equal(result.termination, 'request_limit');
  assert.equal(result.modelRequests, 2); assert.equal(result.summaryRequests, 0); assert.equal(result.compactions, 0);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.events.filter(e => e.type === 'request').length, 2);
  assert.deepEqual(inspectJournal(journal, f.config).result, result);
});

test('C03/R07 oversized summary leaves committed compaction and a rejected worker observation', async t => {
  const f = await runtimeFixture(t, [read('a'), read('b'), answer('s'.repeat(18000))]);
  const result = await f.runtime.run('Read facts');
  assert.equal(result.termination, 'context_overflow');
  assert.equal(result.summaryRequests, 1); assert.equal(result.compactions, 1); assert.equal(result.workerRequests, 2);
  const journal = await readJournal(f.config.sessionPath);
  const observations = journal.events.filter(e => e.type === 'context_observation');
  assert.equal(observations.length, 3);
  assert.deepEqual(inspectJournal(journal, f.config).result, result);
  assert.ok((observations.at(-1)!.data as { metrics: { requestChars: number } }).metrics.requestChars > f.config.budget.maxInputChars);
});

test('C03 cancellation while summary is in flight consumes usage but never commits a late summary', async t => {
  const controller = new AbortController();
  const f = await runtimeFixture(t, [read('a'), read('b'), async () => { controller.abort(); return answer('late'); }], {}, controller);
  const result = await f.runtime.run('Read facts');
  assert.equal(result.termination, 'cancelled');
  assert.equal(result.summaryRequests, 1); assert.equal(result.compactions, 0); assert.equal(result.modelRequests, 3);
  assert.equal(result.knownOutputTokens, 9);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.events.some(e => e.type === 'context_compacted'), false);
  assert.deepEqual(inspectJournal(journal, f.config).result, result);
});

test('C03 cancellation after durable compaction keeps its count and stops the next worker', async t => {
  const controller = new AbortController();
  const f = await runtimeFixture(t, [read('a'), read('b'), answer('saved')], {}, controller);
  f.runtime.context.get('events').on(event => { if (event.type === 'context_compacted') controller.abort(); });
  const result = await f.runtime.run('Read facts');
  assert.equal(result.termination, 'cancelled'); assert.equal(result.compactions, 1);
  assert.equal(result.modelRequests, 3); assert.equal(result.workerRequests, 2);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.events.filter(e => e.type === 'context_compacted').length, 1);
  assert.deepEqual(inspectJournal(journal, f.config).result, result);
});

test('C03 failed compaction persistence returns io_error without run_end or later worker', async t => {
  const f = await runtimeFixture(t, [read('a'), read('b'), answer('saved')]);
  const persistence = f.runtime.context.get('persistence');
  const append = persistence.append.bind(persistence);
  persistence.append = async event => { if (event.type === 'context_compacted') throw Error('injected disk failure'); await append(event); };
  const result = await f.runtime.run('Read facts');
  assert.equal(result.termination, 'io_error'); assert.equal(result.compactions, 0); assert.equal(result.modelRequests, 3);
  const journal = await readJournal(f.config.sessionPath);
  assert.equal(journal.status, 'incomplete'); assert.equal(journal.events.some(e => e.type === 'run_end'), false);
});

test('C03 summary input itself obeys the common hard cap before provider dispatch', async t => {
  const ctx = new Context(); t.after(() => ctx.dispose());
  const events: Event[] = [];
  await ctx.use({ name: 'persistence', setup(c) { return c.provide('persistence', {
    async append(event) { events.push(event); }, async close() {},
  }); } });
  await ctx.use(eventsPlugin()); await ctx.use(memorySessionPlugin());
  await ctx.use({ name: 'tools', setup(c) { return c.provide('tools', {
    register() { return () => {}; }, schemas() { return []; }, async execute() { throw Error('unused'); },
  }); } });
  const accounting = new Accounting({ maxModelRequests: 3, maxToolCalls: 3, maxOutputTokens: 100, maxInputChars: 2000, timeoutMs: 5000 });
  let dispatched = 0;
  await ctx.use(mockModelPlugin({ model: { endpoint: 'http://127.0.0.1:1', id: 'mock', temperature: 0 }, accounting,
    script: [() => { dispatched++; return answer('unused'); }] }));
  await ctx.use(contextManagerPlugin({ context: { estimatedWindowTokens: 1, triggerRatio: 0.5, keepRecentRounds: 1 }, enabled: true, maxOutputTokens: 100 }));
  const session = ctx.get('session');
  await session.record({ type: 'run_start', data: { input: 'task' } });
  await session.append({ role: 'user', content: 'task' });
  await session.append({ role: 'assistant', content: 'x'.repeat(4000), calls: [] });
  await session.append({ role: 'assistant', content: 'recent', calls: [] });
  await assert.rejects(ctx.get('contextManager').build({ system: 'rules', signal: new AbortController().signal }),
    (error: unknown) => error instanceof ModelCallError && error.termination === 'context_overflow');
  assert.equal(dispatched, 0); assert.equal(accounting.modelRequests, 0);
  assert.equal(events.some(e => e.type === 'request' || e.type === 'context_compacted'), false);
  assert.equal(session.messages().length, 3);
});
