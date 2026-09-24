import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { Accounting, ModelCallError } from '../src/accounting.js';
import { Context } from '../src/context.js';
import { encodeChatRequest, decodeChatResponse } from '../src/model-protocol.js';
import { createModelService } from '../src/plugins/model-common.js';
import { httpModelPlugin } from '../src/plugins/http-model.js';
import { memorySessionPlugin } from '../src/plugins/memory-session.js';
import type { Event, ModelRequest, ModelResponse } from '../src/types.js';
import type { SessionService } from '../src/services/index.js';

const budget = { maxModelRequests: 3, maxToolCalls: 2, timeoutMs: 1000, maxOutputTokens: 128, maxInputChars: 10000 };
const model = { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'mock', temperature: 0 };
const response = (inputTokens: number | null, outputTokens: number | null): ModelResponse => ({
  content: 'done', calls: [], finish: 'stop', usage: { inputTokens, outputTokens }, actualModel: 'mock', fingerprint: null,
});
function sessionEvents() {
  const events: Event[] = [];
  const session: SessionService = {
    async append() {}, messages: () => [],
    async record(input) {
      const event: Event = { schemaVersion: 1, seq: events.length + 1, elapsedMs: 0, ...input };
      events.push(event);
      return event;
    },
  };
  return { session, events };
}
function request(kind: ModelRequest['kind']): ModelRequest {
  return {
    kind, system: 'system', messages: [{ role: 'user', content: 'task' }], tools: [],
    maxOutputTokens: 64, signal: new AbortController().signal,
    ...(kind === 'worker' ? { contextMetrics: {
      estimatedInputTokens: 1, preCompressionEstimatedTokens: 30, olderRounds: 1,
      thresholdReached: true, compactionEligible: true,
    } } : {}),
  };
}

test('R04 chat codec preserves the endpoint payload contract', () => {
  const body = encodeChatRequest({ id: 'fixture-model', temperature: 0 }, {
    kind: 'worker', system: 'system', messages: [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: '', calls: [{ id: 'call_1', name: 'read_file', arguments: '{"path":"a"}' }] },
      { role: 'tool', callId: 'call_1', content: 'file' },
    ], tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }],
    maxOutputTokens: 123, signal: new AbortController().signal,
  });
  const json = JSON.parse(body) as Record<string, unknown>;
  assert.equal(json.model, 'fixture-model');
  assert.equal(json.temperature, 0);
  assert.equal(json.max_completion_tokens, 123);
  assert.equal(json.stream, false);
  assert.equal(json.n, 1);
  assert.deepEqual((json.messages as Record<string, unknown>[])[2], {
    role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }],
  });
  assert.deepEqual((json.messages as Record<string, unknown>[])[3], { role: 'tool', tool_call_id: 'call_1', content: 'file' });
  assert.deepEqual(json.tools, [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object' } } }]);
  assert.equal(body.includes('contextMetrics'), false);
});

test('R04 chat codec rejects malformed or incompatible completions', () => {
  const valid = { model: 'fixture-model', system_fingerprint: 'fp', usage: { prompt_tokens: 4, completion_tokens: 5 }, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'id1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] } }] };
  assert.deepEqual(decodeChatResponse(valid), {
    content: '', calls: [{ id: 'id1', name: 'read_file', arguments: '{}' }], finish: 'tool_calls',
    usage: { inputTokens: 4, outputTokens: 5 }, actualModel: 'fixture-model', fingerprint: 'fp',
  });
  for (const response of [
    { ...valid, choices: [] },
    { ...valid, choices: [{ finish_reason: 'stop', message: valid.choices[0]!.message }] },
    { ...valid, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: '', type: 'function', function: { name: 'read_file', arguments: '{}' } }] } }] },
    { ...valid, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [valid.choices[0]!.message.tool_calls[0], valid.choices[0]!.message.tool_calls[0]] } }] },
    { ...valid, usage: { prompt_tokens: -1, completion_tokens: 2 } },
  ]) assert.throws(() => decodeChatResponse(response), /model_error/);
});

test('R04 HTTP deadline covers pending headers and pending body bytes', async t => {
  for (const phase of ['headers', 'body'] as const) {
    await t.test(phase, async t => {
      const server = createServer((_request, result) => {
        if (phase === 'body') { result.writeHead(200, { 'content-type': 'application/json' }); result.write('{'); }
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => { server.closeAllConnections(); server.close(); });
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const endpoint = `http://127.0.0.1:${address.port}/chat/completions`;
      const ctx = new Context();
      t.after(() => ctx.dispose());
      await ctx.use({ name: 'memory-persistence', setup(c) { return c.provide('persistence', { async append() {}, async close() {} }); } });
      await ctx.use(memorySessionPlugin());
      await ctx.get('session').record({ type: 'run_start', data: { input: 'deadline' } });
      const accounting = new Accounting({ ...budget, timeoutMs: 100 });
      const before = process.env.HARNESS_API_KEY;
      process.env.HARNESS_API_KEY = 'fake-test-key';
      try { await ctx.use(httpModelPlugin({ model: { ...model, endpoint }, accounting })); }
      finally { if (before === undefined) delete process.env.HARNESS_API_KEY; else process.env.HARNESS_API_KEY = before; }
      await assert.rejects(ctx.get('model').complete(request('summary')), (error: unknown) => error instanceof ModelCallError && error.termination === 'timeout');
      assert.equal(accounting.snapshot().modelRequests, 1);
      assert.equal(accounting.snapshot().inputTokens, null);
    });
  }
});

test('R04 JSON parse failures and diagnostic finishes are model_error with spent usage retained', async () => {
  const accounting = new Accounting(budget);
  const { session, events } = sessionEvents();
  let n = 0;
  const service = createModelService(model, accounting, session, async () => {
    n++;
    if (n === 1) throw new Error('invalid JSON');
    return { ...response(9, 2), finish: n === 2 ? 'length' : 'other' };
  });
  for (let i = 0; i < 3; i++) await assert.rejects(service.complete(request('summary')), (error: unknown) => error instanceof ModelCallError && error.termination === 'model_error');
  assert.equal(accounting.snapshot().knownInputTokens, 18);
  assert.equal(accounting.snapshot().knownOutputTokens, 4);
  assert.equal(accounting.snapshot().inputTokens, null);
  const responses = events.filter(event => event.type === 'response');
  assert.equal((responses[1]!.data as { response: ModelResponse }).response.finish, 'length');
  assert.equal((responses[2]!.data as { response: ModelResponse }).response.finish, 'other');
});

test('R04 invalid JSON from an HTTP endpoint is model_error without retry', async t => {
  let hits = 0;
  const server = createServer((_request, result) => {
    hits++;
    result.writeHead(200, { 'content-type': 'application/json' });
    result.end('{invalid');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use({ name: 'memory-persistence', setup(c) { return c.provide('persistence', { async append() {}, async close() {} }); } });
  await ctx.use(memorySessionPlugin());
  await ctx.get('session').record({ type: 'run_start', data: { input: 'invalid json' } });
  const accounting = new Accounting(budget);
  const before = process.env.HARNESS_API_KEY;
  process.env.HARNESS_API_KEY = 'fake-test-key';
  try { await ctx.use(httpModelPlugin({ model: { ...model, endpoint: `http://127.0.0.1:${address.port}/chat/completions` }, accounting })); }
  finally { if (before === undefined) delete process.env.HARNESS_API_KEY; else process.env.HARNESS_API_KEY = before; }
  await assert.rejects(ctx.get('model').complete(request('summary')), (error: unknown) => error instanceof ModelCallError && error.termination === 'model_error');
  assert.equal(hits, 1);
  assert.equal(accounting.snapshot().modelRequests, 1);
});

test('R05 accounting counts auxiliary attempts, missing usage, and dispatched errors', async () => {
  const accounting = new Accounting(budget);
  const { session, events } = sessionEvents();
  let index = 0;
  const service = createModelService(model, accounting, session, async () => {
    index++;
    if (index === 3) throw new Error('provider failed');
    return index === 1 ? response(5, 7) : response(null, 3);
  });
  await service.complete(request('worker'));
  await service.complete(request('optimizer'));
  await assert.rejects(service.complete(request('summary')), (error: unknown) => error instanceof ModelCallError && error.termination === 'model_error');
  const totals = accounting.snapshot();
  assert.deepEqual([totals.modelRequests, totals.workerRequests, totals.optimizerRequests, totals.summaryRequests], [3, 1, 1, 1]);
  assert.deepEqual([totals.inputTokens, totals.outputTokens, totals.knownInputTokens, totals.knownOutputTokens], [null, null, 5, 10]);
  assert.equal(totals.contextStats.workerRequests, 1);
  assert.equal(totals.contextStats.thresholdRequests, 1);
  assert.equal(totals.contextStats.eligibleCompactionRequests, 1);
  assert.equal(events.filter(event => event.type === 'request').length, 3);
  assert.equal(events.filter(event => event.type === 'response').length, 3);
  await assert.rejects(service.complete(request('worker')), (error: unknown) => error instanceof ModelCallError && error.termination === 'request_limit');
  assert.equal(index, 3);
});

test('R07 hard input limit records observation but dispatches no worker request', async () => {
  const accounting = new Accounting({ ...budget, maxInputChars: 1 });
  const { session, events } = sessionEvents();
  let called = false;
  const service = createModelService(model, accounting, session, async () => { called = true; return response(1, 1); });
  await assert.rejects(service.complete(request('worker')), (error: unknown) => error instanceof ModelCallError && error.termination === 'context_overflow');
  assert.equal(called, false);
  assert.deepEqual(events.map(event => event.type), ['context_observation']);
  assert.equal(accounting.snapshot().modelRequests, 0);
});
