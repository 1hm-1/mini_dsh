import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '../src/context.js';
import { ModelCallError } from '../src/accounting.js';
import { contextManagerPlugin } from '../src/plugins/context-manager.js';
import { eventsPlugin } from '../src/plugins/events.js';
import type { Event, Message, ModelRequest, ModelResponse } from '../src/types.js';

const config = { estimatedWindowTokens: 1, triggerRatio: 0.5, keepRecentRounds: 1 };
const reply = (content: string): ModelResponse => ({ content, calls: [], finish: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: null, fingerprint: null });
async function fixture(outputs: ModelResponse[] = [reply('fact summary')], opts: { enabled?: boolean; recordFail?: boolean; maxOutputTokens?: number } = {}) {
  const ctx = new Context();
  const history: Message[] = [{ role: 'user', content: 'original task' }];
  const requests: ModelRequest[] = [];
  const events: Event[] = [];
  let seq = 0;
  await ctx.use(eventsPlugin());
  await ctx.use({ name: 'session', setup: c => { c.provide('session', {
    async append(message) { history.push(message); }, messages: () => history,
    async record(input) {
      if (opts.recordFail && input.type === 'context_compacted') throw Error('disk failed');
      const event: Event = { schemaVersion: 1, seq: ++seq, elapsedMs: seq, ...input };
      events.push(event); c.get('events').emit(event); return event;
    },
  }); } });
  await ctx.use({ name: 'model', setup: c => { c.provide('model', {
    async complete(request) {
      requests.push(request);
      const requestEvent: Event = { schemaVersion: 1, seq: ++seq, elapsedMs: seq, type: 'request', data: { kind: request.kind, body: '{}', requestChars: 2, estimatedInputTokens: 1, observationSeq: null } };
      events.push(requestEvent); c.get('events').emit(requestEvent);
      const response = outputs.shift() ?? reply('next summary');
      const responseEvent: Event = { schemaVersion: 1, seq: ++seq, elapsedMs: seq, type: 'response', data: { kind: request.kind, requestSeq: requestEvent.seq, dispatched: true, response, usage: response.usage, error: null } };
      events.push(responseEvent); c.get('events').emit(responseEvent);
      return response;
    },
  }); } });
  await ctx.use({ name: 'tools', setup: c => { c.provide('tools', {
    register() { throw Error('unused'); }, schemas: () => [], async execute() { throw Error('unused'); },
  }); } });
  await ctx.use(contextManagerPlugin({ context: config, enabled: opts.enabled ?? true, maxOutputTokens: opts.maxOutputTokens ?? 4096 }));
  return { ctx, history, requests, events, build: () => ctx.get('contextManager').build({ system: 'system rules', signal: new AbortController().signal }) };
}
function rounds(history: Message[], n: number) {
  for (let i = 0; i < n; i++) history.push({ role: 'assistant', content: `step ${i} ${'x'.repeat(50)}`, calls: [] });
}

test('C01 compacts old complete rounds once, preserves task/recent round and durable boundary', async t => {
  const f = await fixture(); t.after(() => f.ctx.dispose()); rounds(f.history, 3);
  const p = await f.build();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.kind, 'summary');
  assert.deepEqual(f.requests[0]?.tools, []);
  assert.equal(f.requests[0]?.maxOutputTokens, 512);
  assert.equal(f.history.length, 4);
  assert.deepEqual(p.messages[0], f.history[0]);
  assert.match(JSON.stringify(p.messages), /fact summary/);
  assert.deepEqual(p.messages.at(-1), f.history.at(-1));
  assert.equal(p.contextMetrics.preCompressionEstimatedTokens > p.contextMetrics.estimatedInputTokens, true);
  const compact = f.events.find(e => e.type === 'context_compacted');
  assert.deepEqual(compact?.data, { fromMessageIndex: 1, toMessageIndex: 3, summary: 'fact summary', summaryRequestSeq: 1, summaryResponseSeq: 2 });
  await f.build(); assert.equal(f.requests.length, 1);
});

test('C03 advances boundary incrementally without splitting tool call/result pairs', async t => {
  const f = await fixture([reply('first'), reply('second')]); t.after(() => f.ctx.dispose());
  f.history.push({ role: 'assistant', content: '', calls: [{ id: 'a', name: 'x', arguments: '{}' }] },
    { role: 'tool', callId: 'a', content: 'result' }, { role: 'assistant', content: 'recent', calls: [] });
  await f.build();
  f.history.push({ role: 'assistant', content: 'new1', calls: [] }, { role: 'assistant', content: 'new2', calls: [] });
  await f.build();
  const compact = f.events.filter(e => e.type === 'context_compacted');
  assert.deepEqual(compact.map(e => (e.data as { fromMessageIndex: number; toMessageIndex: number }).fromMessageIndex), [1, 3]);
  assert.deepEqual(compact.map(e => (e.data as { toMessageIndex: number }).toMessageIndex), [3, 5]);
  assert.equal(f.requests.length, 2);
  assert.match(JSON.stringify(f.requests[1]?.messages), /first/);
});

test('C02 disabled and insufficient rounds skip summary', async t => {
  const f = await fixture([], { enabled: false }); t.after(() => f.ctx.dispose()); rounds(f.history, 3);
  assert.deepEqual((await f.build()).messages, f.history); assert.equal(f.requests.length, 0);
  const g = await fixture(); t.after(() => g.ctx.dispose()); rounds(g.history, 1);
  await g.build(); assert.equal(g.requests.length, 0);
});

test('C03 invalid summary and persistence failure do not advance boundary', async t => {
  const f = await fixture([reply('  ')]); t.after(() => f.ctx.dispose()); rounds(f.history, 3);
  await assert.rejects(f.build(), (e: unknown) => e instanceof ModelCallError && e.termination === 'model_error');
  const g = await fixture([reply('summary')], { recordFail: true }); t.after(() => g.ctx.dispose()); rounds(g.history, 3);
  await assert.rejects(g.build(), (e: unknown) => e instanceof ModelCallError && e.termination === 'io_error');
  assert.equal(g.events.some(e => e.type === 'context_compacted'), false);
});


test('C02 below threshold skips summary, and C01 honors a smaller shared output cap', async t => {
  const ctx = new Context();
  const history: Message[] = [{ role: 'user', content: 'short task' }, { role: 'assistant', content: 'one', calls: [] }, { role: 'assistant', content: 'two', calls: [] }];
  await ctx.use({ name: 'session', setup: c => { c.provide('session', { async append() {}, messages: () => history, async record() { throw Error('unused'); } }); } });
  await ctx.use({ name: 'model', setup: c => { c.provide('model', { async complete() { throw Error('unexpected summary'); } }); } });
  await ctx.use({ name: 'tools', setup: c => { c.provide('tools', { register() { throw Error('unused'); }, schemas: () => [], async execute() { throw Error('unused'); } }); } });
  await ctx.use(eventsPlugin());
  await ctx.use(contextManagerPlugin({ context: { ...config, estimatedWindowTokens: 10000 }, enabled: true }));
  t.after(() => ctx.dispose());
  assert.deepEqual((await ctx.get('contextManager').build({ system: 'rules', signal: new AbortController().signal })).messages, history);
  const f = await fixture([reply('small cap')], { maxOutputTokens: 64 }); t.after(() => f.ctx.dispose()); rounds(f.history, 3);
  await f.build(); assert.equal(f.requests[0]?.maxOutputTokens, 64);
});

test('C03 rejects summary tool calls and malformed options', async t => {
  const f = await fixture([{ ...reply('bad'), calls: [{ id: 'a', name: 'x', arguments: '{}' }] }]);
  t.after(() => f.ctx.dispose()); rounds(f.history, 3);
  await assert.rejects(f.build(), (e: unknown) => e instanceof ModelCallError && e.termination === 'model_error');
  assert.equal(f.events.some(e => e.type === 'context_compacted'), false);
  assert.throws(() => contextManagerPlugin({ context: config, enabled: null } as never), /enabled/);
  assert.throws(() => contextManagerPlugin({ context: config, maxOutputTokens: null } as never), /maxOutputTokens/);
});
