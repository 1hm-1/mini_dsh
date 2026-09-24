import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Context } from '../src/context.js';
import { jsonlPersistencePlugin } from '../src/plugins/jsonl-persistence.js';
import { eventsPlugin } from '../src/plugins/events.js';
import { memorySessionPlugin } from '../src/plugins/memory-session.js';
import { parseEvent, readJournal } from '../src/journal.js';
import type { Event, RunResult } from '../src/types.js';

const start = (): Event => ({
  schemaVersion: 1, seq: 1, type: 'run_start', elapsedMs: 0,
  data: { input: 'TEMPLATE_REQUIRED is literal user text, not a configuration value.' },
});

test('K03 JSONL checks real parent paths while allowing a workspace prefix sibling', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-session-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const sibling = path.join(root, 'workspace-other');
  await mkdir(workspace);
  await mkdir(sibling);
  await symlink(workspace, path.join(root, 'alias'));
  const rejected = new Context();
  await assert.rejects(rejected.use(jsonlPersistencePlugin({
    workspace, sessionPath: path.join(root, 'alias', 'journal.jsonl'),
  })), /workspace/i);

  const ctx = new Context();
  t.after(() => ctx.dispose());
  const sessionPath = path.join(sibling, 'journal.jsonl');
  await ctx.use(jsonlPersistencePlugin({ workspace, sessionPath }));
  const persistence = ctx.get('persistence');
  await persistence.append(start());
  await ctx.dispose();
  const saved = await readFile(sessionPath, 'utf8');
  assert.deepEqual(JSON.parse(saved), start());
  await assert.rejects(persistence.append(start()));
  assert.equal(await readFile(sessionPath, 'utf8'), saved);
});

test('K04 observer mutation and exceptions cannot change another observation or the source event', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use(eventsPlugin());
  const events = ctx.get('events');
  const observed: Event[] = [];
  events.on(item => {
    (item.data as { input: string }).input = 'changed by observer';
    throw new Error('observer failed');
  });
  const remove = events.on(item => { observed.push(item); });
  const source = start();
  assert.doesNotThrow(() => events.emit(source));
  assert.deepEqual(source, start());
  assert.deepEqual(observed, [start()]);
  remove();
  remove();
  events.emit(start());
  assert.equal(observed.length, 1);
  await ctx.dispose();
  assert.equal(ctx.has('events'), false);
  assert.throws(() => events.on(() => {}), /closed/i);
  assert.throws(() => events.emit(start()), /closed/i);
});

test('R06 event snapshots preserve fractional metrics and reject sparse tool calls', () => {
  const result: RunResult = {
    schemaVersion: 1, termination: 'completed', answer: 'done', modelRequests: 2,
    workerRequests: 2, optimizerRequests: 0, summaryRequests: 0, toolCalls: 0,
    toolErrors: 0, inputTokens: null, outputTokens: null, knownInputTokens: 0,
    knownOutputTokens: 0, durationMs: 1.5, compactions: 0, error: null,
    contextStats: { workerRequests: 2, meanEstimatedInputTokens: 2.5,
      peakEstimatedInputTokens: 3, peakRequestChars: 12,
      thresholdRequests: 0, eligibleCompactionRequests: 0 },
  };
  const event: Event = { schemaVersion: 1, seq: 2, elapsedMs: 1.5, type: 'run_end', data: { result } };
  assert.deepEqual(parseEvent(event), event);
  for (const durationMs of [NaN, Infinity, -1]) {
    assert.throws(() => parseEvent({ ...event, data: { result: { ...result, durationMs } } }));
  }
  const calls = Array<unknown>(1);
  assert.throws(() => parseEvent({ ...start(), type: 'message', data: {
    message: { role: 'assistant', content: '', calls },
  } }));
});

test('R06 parser treats a damaged final line as incomplete and never repairs input', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-journal-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'journal.jsonl');
  for (const suffix of ['{broken', '{broken\n']) {
    const body = `${JSON.stringify(start())}\n${suffix}`;
    await writeFile(file, body);
    assert.equal((await readJournal(file)).status, 'incomplete');
    assert.equal(await readFile(file, 'utf8'), body);
  }
  const secondStart = { ...start(), seq: 2, elapsedMs: 1 };
  await writeFile(file, `${JSON.stringify(start())}\n${JSON.stringify(secondStart)}\n`);
  await assert.rejects(readJournal(file), /run_start/i);
  await writeFile(file, `{broken\n${JSON.stringify(secondStart)}\n`);
  await assert.rejects(readJournal(file), /JSON/i);
});

test('R06 append and record share durable message history and dispose waits for pending writes', async () => {
  const ctx = new Context();
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const stored: Event[] = [];
  let providerClosed = false;
  await ctx.use({ name: 'deferred-persistence', setup(c) {
    const remove = c.provide('persistence', {
      async append(item) { stored.push(item); entered.resolve(); await gate.promise; },
      async close() { providerClosed = true; },
    });
    return async () => { await c.get('persistence').close(); await remove(); };
  } });
  await ctx.use(memorySessionPlugin());
  const session = ctx.get('session');
  const input = { role: 'user' as const, content: 'original' };
  const first = session.append(input);
  input.content = 'caller mutation';
  const second = session.record({ type: 'message', data: { message: { role: 'user', content: 'second' } } });
  await entered.promise;
  assert.deepEqual(session.messages(), []);
  assert.equal(stored.length, 1);
  const disposing = ctx.dispose();
  try {
    await Promise.resolve();
    assert.equal(providerClosed, false);
  } finally {
    gate.resolve();
    await Promise.all([first, second, disposing]);
  }
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'original' }, { role: 'user', content: 'second' }]);
  assert.deepEqual(stored.map(item => item.seq), [1, 2]);
  assert.equal((await second).seq, 2);
  assert.equal(providerClosed, true);
  await assert.rejects(session.append({ role: 'user', content: 'late' }), /closed/i);
});

test('R06 one failed write prevents every queued and subsequent Session write', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  const gate = Promise.withResolvers<void>();
  const failure = new Error('injected persistence failure');
  let writes = 0;
  await ctx.use({ name: 'failing-persistence', setup(c) {
    return c.provide('persistence', {
      async append() { writes++; await gate.promise; throw failure; }, async close() {},
    });
  } });
  await ctx.use(memorySessionPlugin());
  const session = ctx.get('session');
  const writesRejected = Promise.all([
    assert.rejects(session.append({ role: 'user', content: 'first' }), error => error === failure),
    assert.rejects(session.record({ type: 'message', data: { message: { role: 'user', content: 'second' } } }), error => error === failure),
    assert.rejects(session.append({ role: 'user', content: 'third' }), error => error === failure),
  ]);
  gate.resolve();
  await writesRejected;
  assert.equal(writes, 1);
  assert.deepEqual(session.messages(), []);
  await assert.rejects(session.append({ role: 'user', content: 'fourth' }), error => error === failure);
  assert.equal(writes, 1);
});

test('R06 returned event mutation cannot alter Session history or persistence provider data', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  const saved: Event[] = [];
  await ctx.use({ name: 'memory-persistence', setup(c) {
    return c.provide('persistence', { async append(item) { saved.push(item); }, async close() {} });
  } });
  await ctx.use(memorySessionPlugin());
  const returned = await ctx.get('session').record({ type: 'message', data: {
    message: { role: 'assistant', content: '', calls: [{ id: 'one', name: 'read_file', arguments: '{}' }] },
  } });
  const data = returned.data as { message: { calls: { name: string }[] } };
  data.message.calls[0]!.name = 'mutated';
  const history = ctx.get('session').messages()[0]!;
  assert.equal(history.role, 'assistant');
  if (history.role === 'assistant') assert.equal(history.calls[0]!.name, 'read_file');
  assert.equal(((saved[0]!.data as typeof data).message.calls[0]!).name, 'read_file');
});

test('K04 an old unsubscribe cannot remove a later registration of the same listener', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use(eventsPlugin());
  const events = ctx.get('events');
  let observations = 0;
  const listener = () => { observations++; };
  const firstRemove = events.on(listener);
  firstRemove();
  const secondRemove = events.on(listener);
  firstRemove();
  events.emit(start());
  assert.equal(observations, 1);
  secondRemove();
  events.emit(start());
  assert.equal(observations, 1);
});
