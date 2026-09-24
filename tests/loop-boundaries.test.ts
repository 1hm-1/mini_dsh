import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Accounting } from '../src/accounting.js';
import { Context } from '../src/context.js';
import { agentLoopPlugin } from '../src/plugins/agent-loop.js';
import { contextManagerPlugin } from '../src/plugins/context-manager.js';
import { eventsPlugin } from '../src/plugins/events.js';
import { memorySessionPlugin } from '../src/plugins/memory-session.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { permissionsPlugin } from '../src/plugins/permissions.js';
import { toolsPlugin } from '../src/plugins/tools.js';
import type { Budget, Event, ModelResponse, ToolCall, ToolDefinition, ToolResult } from '../src/types.js';

const budget: Budget = { maxModelRequests: 4, maxToolCalls: 3, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 20000 };
const model = { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'fixture', temperature: 0 };
const contextConfig = { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 };
const ok = (): ToolResult => ({ ok: true, output: 'file content', errorCode: null, truncated: false });
const call = (id: string): ToolCall => ({ id, name: 'read_file', arguments: '{"path":"file.txt"}' });
const response = (calls: ToolCall[] = []): ModelResponse => ({
  content: calls.length ? '' : 'done', calls, finish: calls.length ? 'tool_calls' : 'stop',
  usage: { inputTokens: 3, outputTokens: 2 }, actualModel: 'fixture', fingerprint: null,
});
async function fixture(t: TestContext, options: {
  script: readonly MockStep[];
  limits?: Partial<Budget>;
  beforeAppend?: (event: Event) => Promise<void>;
  execute?: ToolDefinition['execute'];
  optimizer?: (input: string, signal: AbortSignal) => Promise<string>;
}) {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  const events: Event[] = [];
  let toolExecutions = 0;
  const accounting = new Accounting({ ...budget, ...options.limits });
  await ctx.use(eventsPlugin());
  await ctx.use({ name: 'test-persistence', setup(c) {
    return c.provide('persistence', { async append(event) { await options.beforeAppend?.(event); events.push(event); }, async close() {} });
  } });
  await ctx.use(memorySessionPlugin());
  await ctx.use(permissionsPlugin(['allowed.txt']));
  await ctx.use(toolsPlugin());
  ctx.get('tools').register({ name: 'read_file', description: 'Read one file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    async execute(args, signal) { toolExecutions++; return options.execute ? options.execute(args, signal) : ok(); },
  });
  ctx.get('tools').register({ name: 'write_file', description: 'Write one file',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    async execute() { toolExecutions++; return ok(); },
  });
  await ctx.use(mockModelPlugin({ model, accounting, script: options.script }));
  await ctx.use(contextManagerPlugin({ context: contextConfig }));
  if (options.optimizer) await ctx.use({ name: 'test-optimizer', setup(c) { return c.provide('promptOptimizer', { optimize: options.optimizer! }); } });
  await ctx.use(agentLoopPlugin({ system: 'Follow the task. Keep protected files unchanged.', accounting }));
  return { ctx, events, accounting, executions: () => toolExecutions };
}

test('R03 only the permitted tool prefix executes and skipped suffixes never trigger another request', async t => {
  const f = await fixture(t, { script: [response([call('a'), call('b'), call('c')]), response()], limits: { maxToolCalls: 1 } });
  const result = await f.ctx.get('agentLoop').run('task', {});
  assert.equal(result.termination, 'tool_limit');
  assert.equal(result.toolCalls, 1);
  assert.equal(result.toolErrors, 0);
  assert.equal(result.modelRequests, 1);
  assert.equal(f.executions(), 1);
  const ends = f.events.filter(e => e.type === 'tool_end').map(e => e.data as { dispatched: boolean; error: string | null });
  assert.deepEqual(ends.map(e => e.dispatched), [true, false, false]);
  assert.deepEqual(ends.map(e => e.error), [null, 'tool_limit', 'tool_limit']);
  assert.equal(f.ctx.get('session').messages().filter(m => m.role === 'tool').length, 1);
  assert.deepEqual((f.events.at(-1)!.data as { result: unknown }).result, result);
});

test('R02 the last allowed model response may execute its tools before request_limit', async t => {
  const f = await fixture(t, { script: [response([call('one')]), response()], limits: { maxModelRequests: 1 } });
  const result = await f.ctx.get('agentLoop').run('task', {});
  assert.equal(result.termination, 'request_limit');
  assert.equal(result.modelRequests, 1);
  assert.equal(result.toolCalls, 1);
  assert.equal(f.executions(), 1);
  assert.equal(f.events.filter(e => e.type === 'request').length, 1);
});

test('R05 invalid arguments and permission denials consume tool quota and reach the next worker as results', async t => {
  const badCalls = [
    { id: 'bad-json', name: 'write_file', arguments: '{invalid' },
    { id: 'denied', name: 'write_file', arguments: '{"path":"public.test.mjs","content":"bad"}' },
  ];
  const f = await fixture(t, { script: [response(badCalls), input => {
    const results = input.messages.filter(m => m.role === 'tool');
    assert.deepEqual(results.map(m => JSON.parse(m.content).errorCode), ['invalid_arguments', 'permission_denied']);
    return response();
  }] });
  const result = await f.ctx.get('agentLoop').run('task', {});
  assert.equal(result.termination, 'completed');
  assert.equal(result.toolCalls, 2);
  assert.equal(result.toolErrors, 2);
  assert.equal(result.modelRequests, 2);
  assert.equal(f.executions(), 0);
});

test('R06 assistant persistence failure blocks every tool and leaves no fictitious run_end', async t => {
  const f = await fixture(t, { script: [response([call('one')])], beforeAppend: async event => {
    if (event.type === 'message' && (event.data as { message: { role: string } }).message.role === 'assistant') throw new Error('private persistence detail');
  } });
  const result = await f.ctx.get('agentLoop').run('task', {});
  assert.equal(result.termination, 'io_error');
  assert.equal(result.answer, null);
  assert.equal(result.modelRequests, 1);
  assert.equal(result.toolCalls, 0);
  assert.equal(f.executions(), 0);
  assert.equal(f.events.some(e => e.type === 'run_end'), false);
  assert.equal(JSON.stringify(result).includes('private persistence detail'), false);
});

test('R06 tool and terminal persistence failures stop at their actual durable boundary', async t => {
  for (const failureAt of ['tool_start', 'tool_end', 'run_end']) {
    await t.test(failureAt, async sub => {
      const f = await fixture(sub, { script: [response([call('one')]), response()], beforeAppend: async event => {
        if (event.type === failureAt) throw new Error('injected journal failure');
      } });
      const result = await f.ctx.get('agentLoop').run('task', {});
      assert.equal(result.termination, 'io_error');
      assert.equal(result.answer, null);
      assert.equal(f.executions(), failureAt === 'tool_start' ? 0 : 1);
      assert.equal(result.toolCalls, failureAt === 'tool_start' ? 0 : 1);
      assert.equal(result.modelRequests, failureAt === 'run_end' ? 2 : 1);
      assert.equal(f.events.some(e => e.type === 'run_end'), false);
    });
  }
});

test('R04 cancellation during assistant persistence cannot produce a late file action', async t => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const f = await fixture(t, { script: [response([call('one')])], beforeAppend: async event => {
    if (event.type === 'message' && (event.data as { message: { role: string } }).message.role === 'assistant') { entered.resolve(); await gate.promise; }
  } });
  const controller = new AbortController();
  const pending = f.ctx.get('agentLoop').run('task', { signal: controller.signal });
  await entered.promise;
  controller.abort();
  gate.resolve();
  const result = await pending;
  assert.equal(result.termination, 'cancelled');
  assert.equal(result.toolCalls, 0);
  assert.equal(f.executions(), 0);
  assert.equal(f.events.filter(e => e.type === 'run_end').length, 1);
});

test('R04 cancellation of an executing tool waits for it and blocks the remaining suffix', async t => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const f = await fixture(t, { script: [response([call('one'), call('two')])], execute: async () => {
    entered.resolve(); await gate.promise; return ok();
  } });
  const controller = new AbortController();
  let settled = false;
  const pending = f.ctx.get('agentLoop').run('task', { signal: controller.signal }).then(result => { settled = true; return result; });
  await entered.promise;
  controller.abort();
  try { await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false); }
  finally { gate.resolve(); }
  const result = await pending;
  assert.equal(result.termination, 'cancelled');
  assert.equal(result.toolCalls, 1);
  assert.equal(result.toolErrors, 1);
  assert.equal(f.executions(), 1);
  assert.equal(f.ctx.get('session').messages().filter(m => m.role === 'tool').length, 0);
});

test('K04 one loop instance cannot run twice or spend budget after disposal', async t => {
  const f = await fixture(t, { script: [response(), response()] });
  const loop = f.ctx.get('agentLoop');
  assert.equal((await loop.run('task', {})).termination, 'completed');
  const count = f.events.length;
  await assert.rejects(loop.run('again', {}));
  await f.ctx.dispose();
  await assert.rejects(loop.run('closed', {}));
  assert.equal(f.events.length, count);
  assert.equal(f.accounting.snapshot().modelRequests, 1);
});

test('R06 a model journal failure prevents even an attempted run_end write', async t => {
  const f = await fixture(t, { script: [response()], beforeAppend: async event => {
    if (event.type === 'request') throw new Error('injected request journal failure');
  } });
  const session = f.ctx.get('session');
  const record = session.record.bind(session);
  const attempted: string[] = [];
  session.record = async input => { attempted.push(input.type); return record(input); };
  const result = await f.ctx.get('agentLoop').run('task', {});
  assert.equal(result.termination, 'io_error');
  assert.equal(result.modelRequests, 0);
  assert.equal(attempted.includes('run_end'), false);
});

test('R06 malformed replacement Tools results stop as internal_error without poisoning the journal', async t => {
  const f = await fixture(t, { script: [response([call('one'), call('two')]), response()] });
  let calls = 0;
  f.ctx.get('tools').execute = async () => { calls++; return { ...ok(), ok: false, errorCode: null }; };
  const result = await f.ctx.get('agentLoop').run('task', {});
  assert.equal(result.termination, 'internal_error');
  assert.equal(result.toolCalls, 1);
  assert.equal(result.toolErrors, 1);
  assert.equal(calls, 1);
  assert.equal(f.events.at(-1)!.type, 'run_end');
});

test('R04 mutating run options during logging cannot replace the cancellation signal', async t => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const f = await fixture(t, { script: [response()], beforeAppend: async event => {
    if (event.type === 'run_start') { entered.resolve(); await gate.promise; }
  } });
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const pending = f.ctx.get('agentLoop').run('task', options);
  await entered.promise;
  options.signal = new AbortController().signal;
  controller.abort();
  gate.resolve();
  const result = await pending;
  assert.equal(result.termination, 'cancelled');
  assert.equal(result.modelRequests, 0);
  assert.equal(f.events.filter(e => e.type === 'context_observation').length, 0);
});

test('R04 the shared deadline is recorded as timeout in both model response and run_end', { timeout: 3000 }, async t => {
  const f = await fixture(t, { limits: { timeoutMs: 150 }, script: [(_input, signal) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })] });
  // Keep the test alive while Accounting's unref'ed deadline waits; no external provider is involved.
  const keepAlive = setTimeout(() => {}, 2500);
  t.after(() => clearTimeout(keepAlive));
  const result = await f.ctx.get('agentLoop').run('task', {});
  assert.equal(result.termination, 'timeout');
  assert.equal(result.modelRequests, 1);
  assert.equal((f.events.find(e => e.type === 'response')!.data as { error: string }).error, 'timeout');
  assert.equal((f.events.at(-1)!.data as { result: { termination: string } }).result.termination, 'timeout');
});
