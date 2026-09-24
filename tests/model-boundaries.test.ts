import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import { Accounting, ModelCallError } from '../src/accounting.js';
import { Context } from '../src/context.js';
import { httpModelPlugin } from '../src/plugins/http-model.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import { memorySessionPlugin } from '../src/plugins/memory-session.js';
import type { Budget, Event, ModelRequest, ModelResponse } from '../src/types.js';

const budget: Budget = { maxModelRequests: 3, maxToolCalls: 3, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 10000 };
const config = { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'fixture-model', temperature: 0 };
const answer = (inputTokens: number | null = 2, outputTokens: number | null = 3): ModelResponse => ({
  content: 'done', calls: [], finish: 'stop', usage: { inputTokens, outputTokens }, actualModel: 'fixture-model', fingerprint: null,
});
function request(kind: ModelRequest['kind'] = 'summary', signal = new AbortController().signal): ModelRequest {
  const value: ModelRequest = { kind, system: 'rules', messages: [{ role: 'user', content: '汉😀 task' }], tools: [], maxOutputTokens: 40, signal };
  if (kind === 'worker') {
    const estimatedInputTokens = Math.ceil(JSON.stringify({ system: value.system, messages: value.messages, tools: value.tools }).length / 4);
    value.contextMetrics = { estimatedInputTokens, preCompressionEstimatedTokens: estimatedInputTokens, olderRounds: 0, thresholdReached: false, compactionEligible: false };
  }
  return value;
}
const failure = (termination: string) => (error: unknown) => error instanceof ModelCallError && error.termination === termination;
async function context(t: TestContext, beforeAppend?: (event: Event) => Promise<void>) {
  const ctx = new Context();
  const events: Event[] = [];
  t.after(() => ctx.dispose());
  await ctx.use({ name: 'test-persistence', setup(c) {
    return c.provide('persistence', {
      async append(event) { await beforeAppend?.(event); events.push(event); }, async close() {},
    });
  } });
  await ctx.use(memorySessionPlugin());
  await ctx.get('session').record({ type: 'run_start', data: { input: 'task' } });
  return { ctx, events };
}
async function http(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/chat/completions`;
}
async function installHttp(ctx: Context, endpoint: string, accounting: Accounting) {
  const previous = process.env.HARNESS_API_KEY;
  process.env.HARNESS_API_KEY = 'fixture-secret-not-for-logs';
  try { await ctx.use(httpModelPlugin({ model: { ...config, endpoint }, accounting })); }
  finally { if (previous === undefined) delete process.env.HARNESS_API_KEY; else process.env.HARNESS_API_KEY = previous; }
}

test('R02/R05 shared budget counts all kinds and preserves per-side unknown usage', async t => {
  const { ctx, events } = await context(t);
  const limits = { ...budget };
  const accounting = new Accounting(limits);
  limits.maxModelRequests = 99;
  accounting.budget.maxModelRequests = 99;
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [answer(2, 3), answer(null, 4), answer(5, null)] }));
  for (const kind of ['worker', 'optimizer', 'summary'] as const) await ctx.get('model').complete(request(kind));
  await assert.rejects(ctx.get('model').complete(request()), failure('request_limit'));
  const stats = accounting.snapshot();
  assert.equal(stats.modelRequests, 3);
  assert.deepEqual([stats.workerRequests, stats.optimizerRequests, stats.summaryRequests], [1, 1, 1]);
  assert.equal(stats.inputTokens, null);
  assert.equal(stats.outputTokens, null);
  assert.equal(stats.knownInputTokens, 7);
  assert.equal(stats.knownOutputTokens, 7);
  assert.equal(stats.contextStats.workerRequests, 1);
  assert.equal(events.filter(e => e.type === 'request').length, 3);
  assert.equal(events.filter(e => e.type === 'response').length, 3);
});

test('R07 overflowing worker projections leave an observation without dispatch or worker statistics', async t => {
  const { ctx, events } = await context(t);
  const accounting = new Accounting({ ...budget, maxInputChars: 10 });
  let calls = 0;
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [() => { calls++; return answer(); }] }));
  await assert.rejects(ctx.get('model').complete(request('worker')), failure('context_overflow'));
  assert.equal(calls, 0);
  assert.equal(accounting.snapshot().modelRequests, 0);
  assert.equal(accounting.snapshot().contextStats.meanEstimatedInputTokens, null);
  assert.deepEqual(events.map(e => e.type), ['run_start', 'context_observation']);
  assert.ok((events[1]!.data as { metrics: { requestChars: number } }).metrics.requestChars > 10);
});

test('R06 request-log failure blocks dispatch and seals the model wrapper', async t => {
  const { ctx } = await context(t, async event => { if (event.type === 'request') throw new Error('private disk detail'); });
  const accounting = new Accounting(budget);
  let calls = 0;
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [() => { calls++; return answer(); }] }));
  for (let i = 0; i < 2; i++) await assert.rejects(ctx.get('model').complete(request()), failure('io_error'));
  assert.equal(calls, 0);
  assert.equal(accounting.snapshot().modelRequests, 0);
});

test('R06 response-log failure retains consumed usage and prevents another dispatch', async t => {
  const { ctx } = await context(t, async event => { if (event.type === 'response') throw new Error('private disk detail'); });
  const accounting = new Accounting(budget);
  let calls = 0;
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [() => { calls++; return answer(11, 7); }] }));
  for (let i = 0; i < 2; i++) await assert.rejects(ctx.get('model').complete(request()), failure('io_error'));
  assert.equal(calls, 1);
  assert.equal(accounting.snapshot().modelRequests, 1);
  assert.equal(accounting.snapshot().knownInputTokens, 11);
  assert.equal(accounting.snapshot().knownOutputTokens, 7);
});

test('R04 HTTP errors do not retry, follow redirects, or leak provider error text and keys', async t => {
  let hits = 0;
  const endpoint = await http(t, (req, res) => {
    hits++;
    if (hits === 1) { res.writeHead(429); res.end('fixture-secret-not-for-logs private provider detail'); }
    else { res.writeHead(307, { location: '/redirect-target' }); res.end(); }
  });
  const { ctx, events } = await context(t);
  const accounting = new Accounting(budget);
  await installHttp(ctx, endpoint, accounting);
  for (let i = 0; i < 2; i++) {
    await assert.rejects(ctx.get('model').complete(request()), error => {
      assert.ok(failure('model_error')(error));
      assert.equal(String(error).includes('fixture-secret-not-for-logs'), false);
      assert.equal(String(error).includes('private provider detail'), false);
      return true;
    });
  }
  assert.equal(hits, 2);
  assert.equal(accounting.snapshot().modelRequests, 2);
  assert.equal(accounting.snapshot().inputTokens, null);
  assert.equal(JSON.stringify(events).includes('fixture-secret-not-for-logs'), false);
});

test('R04 cancelling while an HTTP response body hangs settles and preserves the spent request', async t => {
  const headers = Promise.withResolvers<void>();
  const endpoint = await http(t, (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); headers.resolve(); });
  const { ctx, events } = await context(t);
  const accounting = new Accounting(budget);
  await installHttp(ctx, endpoint, accounting);
  const controller = new AbortController();
  const pending = ctx.get('model').complete(request('summary', controller.signal));
  const rejected = assert.rejects(pending, failure('cancelled'));
  await headers.promise;
  controller.abort(new Error('user secret must not become error output'));
  await rejected;
  assert.equal(accounting.snapshot().modelRequests, 1);
  assert.equal(accounting.snapshot().inputTokens, null);
  const last = events.at(-1)!;
  assert.equal(last.type, 'response');
  assert.equal((last.data as { error: string }).error, 'cancelled');
});

test('R04/R05 invalid completion structure retains independently valid usage in durable evidence', async t => {
  const endpoint = await http(t, (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [], usage: { prompt_tokens: 13, completion_tokens: 8 } }));
  });
  const { ctx, events } = await context(t);
  const accounting = new Accounting(budget);
  await installHttp(ctx, endpoint, accounting);
  await assert.rejects(ctx.get('model').complete(request()), failure('model_error'));
  assert.equal(accounting.snapshot().knownInputTokens, 13);
  assert.equal(accounting.snapshot().knownOutputTokens, 8);
  const data = events.at(-1)!.data as { response: unknown; dispatched: boolean; usage: ModelResponse['usage'] };
  assert.equal(data.response, null);
  assert.equal(data.dispatched, true);
  assert.deepEqual(data.usage, { inputTokens: 13, outputTokens: 8 });
});

test('R06 a replaceable Session failure seals dispatch even if that Session would later recover', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  let records = 0;
  let calls = 0;
  await ctx.use({ name: 'recovering-session', setup(c) {
    return c.provide('session', {
      async append() {}, messages() { return []; },
      async record(input) {
        if (++records === 1) throw new Error('transient log failure');
        return { schemaVersion: 1, seq: records, elapsedMs: records, ...input };
      },
    });
  } });
  const accounting = new Accounting(budget);
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [() => { calls++; return answer(); }] }));
  for (let i = 0; i < 2; i++) await assert.rejects(ctx.get('model').complete(request()), failure('io_error'));
  assert.equal(calls, 0);
  assert.equal(records, 1);
});

test('R05 request mutation during durable logging cannot change dispatch kind or model input', async t => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const { ctx, events } = await context(t, async event => {
    if (event.type === 'request') { entered.resolve(); await gate.promise; }
  });
  const accounting = new Accounting(budget);
  let seen: ModelRequest | undefined;
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [input => { seen = input; return answer(); }] }));
  const input = request();
  const pending = ctx.get('model').complete(input);
  await entered.promise;
  input.kind = 'optimizer';
  input.messages[0]!.content = 'changed after invocation';
  gate.resolve();
  await pending;
  assert.equal(seen!.kind, 'summary');
  assert.equal(seen!.messages[0]!.content, '汉😀 task');
  assert.equal(accounting.snapshot().summaryRequests, 1);
  assert.equal(accounting.snapshot().optimizerRequests, 0);
  assert.equal((events.at(-1)!.data as { kind: string }).kind, 'summary');
});

test('K04 a disposed model service cannot spend budget through an earlier reference', async t => {
  const { ctx } = await context(t);
  const accounting = new Accounting(budget);
  let calls = 0;
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [() => { calls++; return answer(); }] }));
  const model = ctx.get('model');
  await ctx.dispose();
  await assert.rejects(model.complete(request()));
  assert.equal(calls, 0);
  assert.equal(accounting.snapshot().modelRequests, 0);
});

test('R04 cancellation waits for a scripted provider to settle and rejects its late success', async t => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const { ctx, events } = await context(t);
  const accounting = new Accounting(budget);
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [async () => {
    entered.resolve(); await gate.promise; return answer(17, 4);
  }] }));
  const controller = new AbortController();
  let settled = false;
  const pending = ctx.get('model').complete(request('summary', controller.signal));
  const rejected = assert.rejects(pending, failure('cancelled')).then(() => { settled = true; });
  await entered.promise;
  controller.abort();
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { gate.resolve(); await rejected; }
  assert.equal(accounting.snapshot().knownInputTokens, 17);
  assert.equal(accounting.snapshot().knownOutputTokens, 4);
  assert.equal((events.at(-1)!.data as { error: string }).error, 'cancelled');
});

test('R07 actual HTTP body equals durable request and diagnostics stay outside the provider payload', async t => {
  let receivedBody = '';
  let receivedUrl = '';
  let authorization: string | undefined;
  const endpoint = await http(t, (req, res) => {
    receivedUrl = req.url ?? '';
    authorization = req.headers.authorization;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { receivedBody += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'resolved-model', system_fingerprint: 'fp-fixture', choices: [{
        message: { role: 'assistant', content: 'result' }, finish_reason: 'stop',
      }], usage: { prompt_tokens: 9 } }));
    });
  });
  const { ctx, events } = await context(t);
  const accounting = new Accounting(budget);
  await installHttp(ctx, endpoint + '?version=fixture', accounting);
  const input = request('worker');
  const result = await ctx.get('model').complete(input);
  assert.equal(receivedUrl, '/chat/completions?version=fixture');
  assert.equal(authorization, 'Bearer fixture-secret-not-for-logs');
  assert.equal(result.actualModel, 'resolved-model');
  assert.equal(result.fingerprint, 'fp-fixture');
  const obs = events.find(e => e.type === 'context_observation')!;
  const logged = events.find(e => e.type === 'request')!.data as {
    body: string; requestChars: number; estimatedInputTokens: number; observationSeq: number;
  };
  assert.equal(logged.body, receivedBody);
  assert.equal(logged.requestChars, receivedBody.length);
  assert.equal(logged.observationSeq, obs.seq);
  assert.equal(logged.estimatedInputTokens, input.contextMetrics!.estimatedInputTokens);
  assert.equal((obs.data as { metrics: { requestChars: number } }).metrics.requestChars, receivedBody.length);
  const parsed = JSON.parse(receivedBody) as Record<string, unknown>;
  for (const key of ['kind', 'contextMetrics', 'requestChars', 'observationSeq', 'signal', 'authorization']) assert.equal(Object.hasOwn(parsed, key), false);
  assert.equal(accounting.snapshot().contextStats.peakRequestChars, receivedBody.length);
  assert.equal(accounting.snapshot().inputTokens, 9);
  assert.equal(accounting.snapshot().outputTokens, null);
});

test('R04 cancellation during response persistence cannot return a late successful completion', async t => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const { ctx } = await context(t, async event => {
    if (event.type === 'response') { entered.resolve(); await gate.promise; }
  });
  const accounting = new Accounting(budget);
  await ctx.use(mockModelPlugin({ model: config, accounting, script: [answer(3, 5)] }));
  const controller = new AbortController();
  const pending = ctx.get('model').complete(request('summary', controller.signal));
  const rejected = assert.rejects(pending, failure('cancelled'));
  await entered.promise;
  controller.abort();
  gate.resolve();
  await rejected;
  assert.equal(accounting.snapshot().modelRequests, 1);
  assert.equal(accounting.snapshot().knownInputTokens, 3);
});
