import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Context } from '../src/context.js';
import { eventsPlugin } from '../src/plugins/events.js';
import { jsonlPersistencePlugin } from '../src/plugins/jsonl-persistence.js';
import { memorySessionPlugin } from '../src/plugins/memory-session.js';
import { readJournal } from '../src/journal.js';
import type { Event, RunResult } from '../src/types.js';

const result: RunResult = {
  schemaVersion: 1, termination: 'completed', answer: 'done', modelRequests: 0,
  workerRequests: 0, optimizerRequests: 0, summaryRequests: 0, toolCalls: 0,
  toolErrors: 0, inputTokens: 0, outputTokens: 0, knownInputTokens: 0,
  knownOutputTokens: 0, durationMs: 1, compactions: 0, error: null,
  contextStats: { workerRequests: 0, meanEstimatedInputTokens: null,
    peakEstimatedInputTokens: null, peakRequestChars: null, thresholdRequests: 0,
    eligibleCompactionRequests: 0 },
};

function event(seq: number, type: string, data: unknown, elapsedMs = seq - 1): Event {
  return { schemaVersion: 1, seq, type, elapsedMs, data };
}

test('R06 session persists ordered events before publication and protects full message history', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-session-'));
  const workspace = path.join(root, 'workspace');
  const journal = path.join(root, 'journal.jsonl');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace);
  const ctx = new Context();
  await ctx.use(eventsPlugin());
  await ctx.use(jsonlPersistencePlugin({ workspace, sessionPath: journal }));
  await ctx.use(memorySessionPlugin());
  const observed: Event[] = [];
  const stop = ctx.get('events').on(item => { observed.push(item); });
  const session = ctx.get('session');
  assert.equal((await session.record({ type: 'run_start', data: { input: 'fix it' } })).seq, 1);
  const message = { role: 'assistant' as const, content: 'calling', calls: [{ id: 'a', name: 'read_file', arguments: '{}' }] };
  await session.append(message);
  message.calls[0]!.name = 'changed';
  const copy = session.messages();
  (copy[0] as typeof message).calls[0]!.name = 'changed again';
  observed[1]!.data = { message: { role: 'user', content: 'tampered' } };
  assert.equal((session.messages()[0] as typeof message).calls[0]!.name, 'read_file');
  await session.append({ role: 'tool', callId: 'a', content: 'contents' });
  assert.equal((await session.record({ type: 'run_end', data: { result } })).seq, 4);
  stop();
  await ctx.dispose();
  const parsed = await readJournal(journal);
  assert.equal(parsed.status, 'complete');
  assert.deepEqual(parsed.events.map(item => [item.seq, item.type]), [[1, 'run_start'], [2, 'message'], [3, 'message'], [4, 'run_end']]);
  assert.equal((parsed.events[1]!.data as { message: typeof message }).message.calls[0]!.name, 'read_file');
  assert.equal((await readFile(journal, 'utf8')).trim().split('\n').length, 4);
});

test('R06 session write failure rejects later writes without changing memory or publishing events', async () => {
  const ctx = new Context();
  let writes = 0;
  const error = new Error('disk failed');
  await ctx.use({ name: 'failed-persistence', setup(c) {
    return c.provide('persistence', { append: async () => { writes++; throw error; }, close: async () => {} });
  } });
  await ctx.use(eventsPlugin());
  await ctx.use(memorySessionPlugin());
  const session = ctx.get('session');
  let observations = 0;
  ctx.get('events').on(() => { observations++; });
  await assert.rejects(session.append({ role: 'user', content: 'first' }), e => e === error);
  await assert.rejects(session.append({ role: 'user', content: 'second' }), e => e === error);
  assert.equal(writes, 1);
  assert.equal(observations, 0);
  assert.deepEqual(session.messages(), []);
  await ctx.dispose();
});

test('K03/K04 persistence can be replaced and sessions remain isolated', async () => {
  const stores: Event[][] = [[], []];
  const contexts = [new Context(), new Context()];
  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i]!;
    const store = stores[i]!;
    await ctx.use({ name: 'alternate-persistence', setup(c) {
      return c.provide('persistence', { append: async item => { store.push(item); }, close: async () => {} });
    } });
    await ctx.use(memorySessionPlugin());
  }
  await contexts[0]!.get('session').append({ role: 'user', content: 'left' });
  assert.deepEqual(contexts[1]!.get('session').messages(), []);
  assert.equal(stores[0]!.length, 1);
  assert.equal(stores[1]!.length, 0);
  await contexts[0]!.dispose();
  assert.equal(contexts[0]!.has('session'), false);
  await contexts[1]!.dispose();
});

test('R06 journal parser marks torn tail and missing end incomplete, rejecting sequence corruption', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-journal-'));
  const journal = path.join(root, 'journal.jsonl');
  const start = JSON.stringify(event(1, 'run_start', { input: 'fix it' }, 0));
  const end = JSON.stringify(event(2, 'run_end', { result }, 1));
  await writeFile(journal, `${start}\n{broken`, 'utf8');
  assert.equal((await readJournal(journal)).status, 'incomplete');
  await writeFile(journal, `${start}\n`, 'utf8');
  assert.equal((await readJournal(journal)).status, 'incomplete');
  await writeFile(journal, `${start}\n${end}\n`, 'utf8');
  assert.equal((await readJournal(journal)).status, 'complete');
  await writeFile(journal, `${start}\n${end}\n${end}\n`, 'utf8');
  await assert.rejects(readJournal(journal), /run_end|sequence/i);
  await writeFile(journal, `${start}\n${JSON.stringify(event(3, 'run_end', { result }, 1))}\n`, 'utf8');
  await assert.rejects(readJournal(journal), /sequence/i);
});

test('K03 JSONL setup refuses workspace paths and existing journals without replacement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-persistence-'));
  const workspace = path.join(root, 'workspace');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace);
  const inside = new Context();
  await assert.rejects(inside.use(jsonlPersistencePlugin({ workspace, sessionPath: path.join(workspace, 'journal.jsonl') })), /workspace/i);
  const journal = path.join(root, 'journal.jsonl');
  await writeFile(journal, 'sentinel');
  const existing = new Context();
  await assert.rejects(existing.use(jsonlPersistencePlugin({ workspace, sessionPath: journal })), /exist/i);
  assert.equal(await readFile(journal, 'utf8'), 'sentinel');
});

test('R06 concurrent append/record share order and dispose waits for an active write', async () => {
  const ctx = new Context();
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const trace: string[] = [];
  const saved: Event[] = [];
  await ctx.use({ name: 'delayed-persistence', setup(c) {
    const service = {
      async append(item) {
        trace.push(`start ${item.seq}`);
        if (item.seq === 1) { entered.resolve(); await gate.promise; }
        saved.push(item);
        trace.push(`end ${item.seq}`);
      },
      async close() { trace.push('close'); },
    } satisfies import('../src/services/index.js').PersistenceService;
    const remove = c.provide('persistence', service);
    return async () => { remove(); await service.close(); };
  } });
  await ctx.use(memorySessionPlugin());
  const session = ctx.get('session');
  const first = session.record({ type: 'run_start', data: { input: 'task' } });
  const second = session.append({ role: 'user', content: 'task' });
  await entered.promise;
  const disposal = ctx.dispose();
  assert.deepEqual(trace, ['start 1']);
  gate.resolve();
  assert.equal((await first).seq, 1);
  await second;
  await disposal;
  assert.deepEqual(saved.map(item => item.seq), [1, 2]);
  assert.deepEqual(trace, ['start 1', 'end 1', 'start 2', 'end 2', 'close']);
  await assert.rejects(session.append({ role: 'user', content: 'late' }), /closed/i);
});

test('R06 rejects lossy event data and invalid caller metadata before writing', async () => {
  const ctx = new Context();
  const saved: Event[] = [];
  await ctx.use({ name: 'memory-persistence', setup(c) {
    return c.provide('persistence', { append: async item => { saved.push(item); }, close: async () => {} });
  } });
  await ctx.use(memorySessionPlugin());
  const session = ctx.get('session');
  await assert.rejects(session.record({ type: 'run_start', data: { input: undefined } }), /string/i);
  await assert.rejects(session.record({ type: 'run_start', data: { input: 'task' }, seq: 10 } as never), /fields/i);
  await assert.rejects(session.record({ type: 'run_end', data: { result: { ...result, durationMs: Number.NaN } } }), /durationMs/i);
  await assert.rejects(session.append({ role: 'assistant', content: '', calls: new Array(1) }), /call/i);
  assert.equal(saved.length, 0);
  assert.equal((await session.record({ type: 'run_start', data: { input: 'task' } })).seq, 1);
  await ctx.dispose();
});

test('R06 readJournal verifies call/result relation without treating budget endings as damage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-journal-calls-'));
  const journal = path.join(root, 'journal.jsonl');
  const start = event(1, 'run_start', { input: 'task' }, 0);
  const assistant = event(2, 'message', { message: { role: 'assistant', content: '', calls: [{ id: 'a', name: 'read_file', arguments: '{}' }] } }, 1);
  const tool = event(3, 'message', { message: { role: 'tool', callId: 'a', content: 'ok' } }, 2);
  const end = event(3, 'run_end', { result: { ...result, termination: 'tool_limit' } }, 2);
  await writeFile(journal, [start, assistant, end].map(item => JSON.stringify(item)).join('\n') + '\n');
  assert.equal((await readJournal(journal)).status, 'complete');
  await writeFile(journal, [start, assistant, event(3, 'run_end', { result }, 2)].map(item => JSON.stringify(item)).join('\n') + '\n');
  await assert.rejects(readJournal(journal), /missing tool results/i);
  await writeFile(journal, [start, assistant, tool, event(4, 'message', { message: { role: 'tool', callId: 'a', content: 'again' } }, 3)].map(item => JSON.stringify(item)).join('\n') + '\n');
  await assert.rejects(readJournal(journal), /duplicate tool result/i);
});

test('R06 record(message) updates history and run_end forbids queued later writes', async () => {
  const ctx = new Context();
  const saved: Event[] = [];
  await ctx.use({ name: 'memory-persistence', setup(c) {
    return c.provide('persistence', { append: async item => { saved.push(item); }, close: async () => {} });
  } });
  await ctx.use(memorySessionPlugin());
  const session = ctx.get('session');
  await session.record({ type: 'run_start', data: { input: 'task' } });
  await session.record({ type: 'message', data: { message: { role: 'user', content: 'task' } } });
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'task' }]);
  const ending = session.record({ type: 'run_end', data: { result } });
  const after = session.append({ role: 'user', content: 'late' });
  await ending;
  await assert.rejects(after, /ended/i);
  await assert.rejects(session.record({ type: 'run_end', data: { result } }), /ended/i);
  assert.deepEqual(saved.map(item => item.type), ['run_start', 'message', 'run_end']);
  await ctx.dispose();
});
