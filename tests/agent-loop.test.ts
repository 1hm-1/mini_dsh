import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounting } from '../src/accounting.js';
import { Context } from '../src/context.js';
import { readJournal } from '../src/journal.js';
import { agentLoopPlugin } from '../src/plugins/agent-loop.js';
import { contextManagerPlugin } from '../src/plugins/context-manager.js';
import { eventsPlugin } from '../src/plugins/events.js';
import { fileToolsPlugin } from '../src/plugins/file-tools.js';
import { jsonlPersistencePlugin } from '../src/plugins/jsonl-persistence.js';
import { memorySessionPlugin } from '../src/plugins/memory-session.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { permissionsPlugin } from '../src/plugins/permissions.js';
import { toolsPlugin } from '../src/plugins/tools.js';
import type { Event, ModelResponse, ToolCall, ToolResult } from '../src/types.js';

const budget = { maxModelRequests: 4, maxToolCalls: 4, timeoutMs: 5000, maxOutputTokens: 128, maxInputChars: 20000 };
const context = { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 };
const model = { endpoint: 'http://127.0.0.1:1/v1/chat/completions', id: 'test', temperature: 0 };
const call = (id: string): ToolCall => ({ id, name: 'read_file', arguments: '{}' });
const response = (calls: ToolCall[], content = ''): ModelResponse => ({
  content, calls, finish: calls.length ? 'tool_calls' : 'stop',
  usage: { inputTokens: 2, outputTokens: 1 }, actualModel: 'test', fingerprint: null,
});
const ok: ToolResult = { ok: true, output: 'contents', errorCode: null, truncated: false };

async function setup(options: {
  script: MockStep[];
  maxModelRequests?: number;
  maxToolCalls?: number;
  execute?: (call: ToolCall, signal: AbortSignal) => Promise<ToolResult>;
  failAt?: string;
  optimizer?: (input: string, signal: AbortSignal) => Promise<string>;
}): Promise<{ ctx: Context; events: Event[]; accounting: Accounting; executed: ToolCall[] }> {
  const ctx = new Context();
  const events: Event[] = [];
  const executed: ToolCall[] = [];
  const accounting = new Accounting({ ...budget, maxModelRequests: options.maxModelRequests ?? budget.maxModelRequests,
    maxToolCalls: options.maxToolCalls ?? budget.maxToolCalls });
  await ctx.use({ name: 'test-persistence', setup(c) { return c.provide('persistence', {
    async append(event) { if (event.type === options.failAt) throw new Error('disk secret'); events.push(event); },
    async close() {},
  }); } });
  await ctx.use(eventsPlugin());
  await ctx.use(memorySessionPlugin());
  await ctx.use({ name: 'test-tools', setup(c) { return c.provide('tools', {
    register() { return () => {}; }, schemas() { return []; },
    async execute(item, signal) { executed.push(item); return options.execute?.(item, signal) ?? ok; },
  }); } });
  await ctx.use(mockModelPlugin({ model, accounting, script: options.script }));
  await ctx.use(contextManagerPlugin({ context }));
  if (options.optimizer) await ctx.use({ name: 'test-optimizer', setup(c) { return c.provide('promptOptimizer', { optimize: options.optimizer! }); } });
  await ctx.use(agentLoopPlugin({ system: 'Follow instructions.', accounting }));
  return { ctx, events, accounting, executed };
}

test('R01 loop persists original task and ordered tool results before final answer', async () => {
  const fixture = await setup({ script: [response([call('a')], 'read'), response([], 'done')] });
  const result = await fixture.ctx.get('agentLoop').run('fix it', {});
  assert.equal(result.termination, 'completed');
  assert.equal(result.answer, 'done');
  assert.equal(result.modelRequests, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.toolErrors, 0);
  assert.deepEqual(fixture.events.filter(e => ['run_start', 'message', 'tool_start', 'tool_end', 'run_end'].includes(e.type))
    .map(e => e.type), ['run_start', 'message', 'message', 'tool_start', 'tool_end', 'message', 'message', 'run_end']);
  const toolMessage = fixture.events.find(e => e.type === 'message' && (e.data as { message: { role: string } }).message.role === 'tool')!;
  assert.deepEqual(JSON.parse((toolMessage.data as { message: { content: string } }).message.content), ok);
  const end = fixture.events.find(e => e.type === 'tool_end')!;
  assert.deepEqual(end.data, { startSeq: fixture.events.find(e => e.type === 'tool_start')!.seq,
    dispatched: true, result: ok, error: null });
  await fixture.ctx.dispose();
});

test('R02 request limit stops before a third request and preserves tool results', async () => {
  const fixture = await setup({ maxModelRequests: 2, script: [response([call('a')]), response([call('b')])] });
  const result = await fixture.ctx.get('agentLoop').run('fix', {});
  assert.equal(result.termination, 'request_limit');
  assert.equal(result.modelRequests, 2);
  assert.equal(result.toolCalls, 2);
  assert.equal(fixture.events.filter(e => e.type === 'request').length, 2);
  await fixture.ctx.dispose();
});

test('R03 tool quota executes only the prefix and journals explicit skipped suffix', async () => {
  const fixture = await setup({ maxToolCalls: 1, script: [response([call('a'), call('b'), call('c')])] });
  const result = await fixture.ctx.get('agentLoop').run('fix', {});
  assert.equal(result.termination, 'tool_limit');
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(fixture.executed.map(item => item.id), ['a']);
  assert.deepEqual(fixture.events.filter(e => e.type === 'tool_end').map(e => e.data), [
    { startSeq: fixture.events.find(e => e.type === 'tool_start')!.seq, dispatched: true, result: ok, error: null },
    ...fixture.events.filter(e => e.type === 'tool_start').slice(1).map(e => ({ startSeq: e.seq, dispatched: false, result: null, error: 'tool_limit' })),
  ]);
  assert.equal(fixture.events.filter(e => e.type === 'message' && (e.data as { message: { role: string } }).message.role === 'tool').length, 1);
  await fixture.ctx.dispose();
});

test('R05 invalid tool results consume quota and remain feedback for next model request', async () => {
  const bad = { ok: false, output: 'Invalid tool arguments', errorCode: 'invalid_arguments', truncated: false };
  const fixture = await setup({ script: [response([call('a')]), response([], 'recovered')], execute: async () => bad });
  const result = await fixture.ctx.get('agentLoop').run('fix', {});
  assert.equal(result.termination, 'completed');
  assert.equal(result.toolCalls, 1);
  assert.equal(result.toolErrors, 1);
  await fixture.ctx.dispose();
});

test('R06 journal failure stops actions and cannot fabricate run_end', async () => {
  const fixture = await setup({ script: [response([call('a')])], failAt: 'tool_start' });
  const result = await fixture.ctx.get('agentLoop').run('fix', {});
  assert.equal(result.termination, 'io_error');
  assert.equal(result.answer, null);
  assert.equal(result.toolCalls, 0);
  assert.equal(fixture.executed.length, 0);
  assert.equal(fixture.events.some(e => e.type === 'run_end'), false);
  await fixture.ctx.dispose();
});

test('loop rejects concurrent and repeat runs without additional journal entries', async () => {
  const gate = Promise.withResolvers<ModelResponse>();
  const fixture = await setup({ script: [async () => gate.promise] });
  const run = fixture.ctx.get('agentLoop').run('first', {});
  await assert.rejects(fixture.ctx.get('agentLoop').run('second', {}), /already|once|used/i);
  gate.resolve(response([], 'done'));
  await run;
  const count = fixture.events.length;
  await assert.rejects(fixture.ctx.get('agentLoop').run('third', {}), /already|once|used/i);
  assert.equal(fixture.events.length, count);
  await fixture.ctx.dispose();
});

test('optimizer suggestion is lower priority and preserves the original user message', async () => {
  let optimized = 0;
  const fixture = await setup({ script: [request => {
    assert.equal(request.system.startsWith('Follow instructions.'), true);
    assert.equal(request.system.includes('shorter task'), true);
    assert.deepEqual(request.messages[0], { role: 'user', content: 'original task' });
    return response([], 'done');
  }], optimizer: async () => { optimized++; return 'shorter task'; } });
  assert.equal((await fixture.ctx.get('agentLoop').run('original task', {})).termination, 'completed');
  assert.equal(optimized, 1);
  await fixture.ctx.dispose();
});

test('R01 real file read-edit-final flow persists a replayable JSONL journal', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'loop-file-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const source = path.join(workspace, 'math.txt');
  const journal = path.join(root, 'run.jsonl');
  await writeFile(source, 'one plus one = three\n');
  const accounting = new Accounting(budget);
  const ctx = new Context();
  try {
    await ctx.use(jsonlPersistencePlugin({ workspace, sessionPath: journal }));
    await ctx.use(eventsPlugin());
    await ctx.use(memorySessionPlugin());
    await ctx.use(permissionsPlugin(['math.txt']));
    await ctx.use(toolsPlugin());
    await ctx.use(fileToolsPlugin(workspace));
    await ctx.use(mockModelPlugin({ model, accounting, script: [
      request => {
        assert.deepEqual(request.messages, [{ role: 'user', content: 'Correct math.txt' }]);
        return response([{ id: 'read', name: 'read_file', arguments: JSON.stringify({ path: 'math.txt' }) }]);
      },
      request => {
        const last = request.messages.at(-1);
        assert.equal(last?.role, 'tool');
        if (last?.role === 'tool') assert.equal(JSON.parse(last.content).output, 'one plus one = three\n');
        return response([{ id: 'edit', name: 'edit_file', arguments: JSON.stringify({
          path: 'math.txt', oldText: 'three', newText: 'two',
        }) }]);
      },
      request => {
        const last = request.messages.at(-1);
        assert.equal(last?.role, 'tool');
        if (last?.role === 'tool') assert.equal(JSON.parse(last.content).ok, true);
        return response([], 'Corrected math.txt');
      },
    ] }));
    await ctx.use(contextManagerPlugin({ context }));
    await ctx.use(agentLoopPlugin({ system: 'Edit the requested file.', accounting }));
    const result = await ctx.get('agentLoop').run('Correct math.txt', {});
    assert.equal(result.termination, 'completed');
    assert.equal(result.answer, 'Corrected math.txt');
    assert.equal(result.modelRequests, 3);
    assert.equal(result.toolCalls, 2);
    assert.equal(await readFile(source, 'utf8'), 'one plus one = two\n');
    await ctx.dispose();
    const replay = await readJournal(journal);
    assert.equal(replay.status, 'complete');
    assert.deepEqual((replay.events.at(-1)?.data as { result: typeof result }).result, result);
    assert.equal(replay.events.filter(e => e.type === 'tool_end').length, 2);
  } finally {
    await ctx.dispose();
  }
});
