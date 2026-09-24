import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelCallError } from '../src/accounting.js';
import { Context } from '../src/context.js';
import { OPTIMIZER_SYSTEM, promptOptimizerPlugin } from '../src/plugins/prompt-optimizer.js';
import type { ModelRequest, ModelResponse } from '../src/types.js';

const response = (content: string, overrides: Partial<ModelResponse> = {}): ModelResponse => ({
  content, calls: [], finish: 'stop', usage: { inputTokens: 2, outputTokens: 1 },
  actualModel: 'test', fingerprint: null, ...overrides,
});

async function fixture(complete: (request: ModelRequest) => Promise<ModelResponse>, maxOutputTokens?: number) {
  const ctx = new Context();
  await ctx.use({ name: 'model', setup(c) { return c.provide('model', { complete }); } });
  await ctx.use(promptOptimizerPlugin(maxOutputTokens === undefined ? {} : { maxOutputTokens }));
  return { ctx, optimize: ctx.get('promptOptimizer').optimize };
}

test('O01 sends only the original user task with fixed rewrite rules, no tools, and a capped output', async t => {
  const requests: ModelRequest[] = [];
  const { ctx, optimize } = await fixture(async request => {
    requests.push(request);
    return response('  Clarify the requirement.  \n');
  }, 1024);
  t.after(() => ctx.dispose());
  const signal = new AbortController().signal;
  const input = 'Keep the error behavior, including the empty input case.';
  assert.equal(await optimize(input, signal), 'Clarify the requirement.');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { kind: 'optimizer', system: OPTIMIZER_SYSTEM,
    messages: [{ role: 'user', content: input }], tools: [], maxOutputTokens: 512, signal });
  assert.match(OPTIMIZER_SYSTEM, /constraints|约束/i);
  assert.match(OPTIMIZER_SYSTEM, /exceptions|异常/i);
  assert.match(OPTIMIZER_SYSTEM, /boundaries|边界/i);
  assert.match(OPTIMIZER_SYSTEM, /do not add/i);
  assert.match(OPTIMIZER_SYSTEM, /do not.*plan/i);
});

test('O01 uses a lower output cap and rejects repeat or concurrent optimize calls', async t => {
  const gate = Promise.withResolvers<ModelResponse>();
  let calls = 0;
  const { ctx, optimize } = await fixture(request => {
    calls++;
    assert.equal(request.maxOutputTokens, 64);
    return gate.promise;
  }, 64);
  t.after(() => ctx.dispose());
  const signal = new AbortController().signal;
  const pending = optimize('task', signal);
  await assert.rejects(optimize('second', signal), /once|concurrent/i);
  gate.resolve(response('done'));
  assert.equal(await pending, 'done');
  await assert.rejects(optimize('third', signal), /once|concurrent/i);
  assert.equal(calls, 1);
});

test('O02 rejects empty text, tool calls and every non-stop finish without retry', async () => {
  for (const invalid of [
    response(' \n '),
    response('text', { calls: [{ id: 'x', name: 'read_file', arguments: '{}' }] }),
    response('text', { finish: 'tool_calls' }),
    response('text', { finish: 'length' }),
    response('text', { finish: 'other' }),
  ]) {
    let calls = 0;
    const { ctx, optimize } = await fixture(async () => { calls++; return invalid; });
    await assert.rejects(optimize('task', new AbortController().signal),
      (error: unknown) => error instanceof ModelCallError && error.termination === 'model_error');
    assert.equal(calls, 1);
    await ctx.dispose();
  }
});

test('O02 preserves model failures and does not issue another request', async () => {
  const failure = new ModelCallError('request_limit');
  let calls = 0;
  const { ctx, optimize } = await fixture(async () => { calls++; throw failure; });
  await assert.rejects(optimize('task', new AbortController().signal), error => error === failure);
  assert.equal(calls, 1);
  await ctx.dispose();
});

test('cancellation and disposal reject calls; disposal waits for the active model request', async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  const pre = await fixture(async () => { calls++; return response('unexpected'); });
  await assert.rejects(pre.optimize('task', abort.signal),
    (error: unknown) => error instanceof ModelCallError && error.termination === 'cancelled');
  assert.equal(calls, 0);
  await pre.ctx.dispose();

  const gate = Promise.withResolvers<ModelResponse>();
  const active = await fixture(async () => gate.promise);
  const pending = active.optimize('task', new AbortController().signal);
  let disposed = false;
  const disposing = active.ctx.dispose().then(() => { disposed = true; });
  await Promise.resolve();
  assert.equal(disposed, false);
  await assert.rejects(active.optimize('late', new AbortController().signal), /closed|once/i);
  gate.resolve(response('late'));
  await assert.rejects(pending, /closed/i);
  await disposing;
  assert.equal(disposed, true);
  await assert.rejects(active.optimize('later', new AbortController().signal), /closed/i);
});

test('invalid options and signals fail before model dispatch', async () => {
  assert.throws(() => promptOptimizerPlugin({ maxOutputTokens: 0 }), /maxOutputTokens/);
  assert.throws(() => promptOptimizerPlugin({ maxOutputTokens: 1.5 }), /maxOutputTokens/);
  assert.throws(() => promptOptimizerPlugin({ extra: 1 } as never), /options/);
  const { ctx, optimize } = await fixture(async () => response('unexpected'));
  await assert.rejects(optimize('task', {} as AbortSignal), /signal/i);
  await ctx.dispose();
});
