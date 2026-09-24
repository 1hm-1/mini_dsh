import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '../src/context.js';
import { contextManagerPlugin } from '../src/plugins/context-manager.js';
import type { ContextConfig, Message, ToolSchema } from '../src/types.js';

const config: ContextConfig = { estimatedWindowTokens: 40, triggerRatio: 0.5, keepRecentRounds: 1 };
const schema: ToolSchema = { name: 'read_file', description: 'Read file', parameters: { type: 'object' } };

async function fixture(contextConfig: ContextConfig = config) {
  const ctx = new Context();
  const history: Message[] = [];
  const schemas: ToolSchema[] = [structuredClone(schema)];
  await ctx.use({ name: 'session', setup: c => { c.provide('session', {
    async append(message) { history.push(message); }, messages: () => history,
    async record() { throw new Error('unexpected record'); },
  }); } });
  await ctx.use({ name: 'model', setup: c => { c.provide('model', {
    async complete() { throw new Error('model must not be called'); },
  }); } });
  await ctx.use({ name: 'tools', setup: c => { c.provide('tools', {
    register() { throw new Error('unexpected register'); },
    schemas: () => schemas,
    async execute() { throw new Error('unexpected execute'); },
  }); } });
  await ctx.use(contextManagerPlugin({ context: contextConfig }));
  return { ctx, history, schemas, build: (system = 'rules', signal = new AbortController().signal) =>
    ctx.get('contextManager').build({ system, signal }) };
}

test('M3.2 projects full history and tools with threshold metrics without model calls', async t => {
  const { ctx, history, schemas, build } = await fixture();
  t.after(() => ctx.dispose());
  history.push(
    { role: 'user', content: 'original task' },
    { role: 'assistant', content: '', calls: [
      { id: 'a', name: 'read_file', arguments: '{}' }, { id: 'b', name: 'read_file', arguments: '{}' },
    ] },
    { role: 'tool', callId: 'b', content: 'second' },
    { role: 'tool', callId: 'a', content: 'first' },
    { role: 'assistant', content: 'finished', calls: [] },
  );
  const projected = await build('system');
  const estimate = Math.ceil(JSON.stringify({ system: 'system', messages: history, tools: schemas }).length / 4);
  assert.deepEqual(projected.messages, history);
  assert.deepEqual(projected.tools, schemas);
  assert.equal(projected.system, 'system');
  assert.deepEqual(projected.contextMetrics, {
    estimatedInputTokens: estimate, preCompressionEstimatedTokens: estimate,
    olderRounds: 1, thresholdReached: true, compactionEligible: true,
  });
  projected.messages[0]!.content = 'changed';
  projected.tools[0]!.parameters.type = 'changed';
  assert.equal(history[0]!.content, 'original task');
  assert.equal(schemas[0]!.parameters.type, 'object');
});

test('M3.2 counts only complete assistant rounds and never trims at the threshold', async t => {
  const { ctx, history, build } = await fixture({ ...config, estimatedWindowTokens: 1, keepRecentRounds: 1 });
  t.after(() => ctx.dispose());
  history.push({ role: 'user', content: 'task' }, { role: 'assistant', content: 'done', calls: [] },
    { role: 'assistant', content: '', calls: [
      { id: 'a', name: 'read_file', arguments: '{}' }, { id: 'b', name: 'read_file', arguments: '{}' },
    ] }, { role: 'tool', callId: 'b', content: 'first result' });
  const projected = await build();
  assert.deepEqual(projected.messages, history);
  assert.equal(projected.contextMetrics.olderRounds, 0);
  assert.equal(projected.contextMetrics.thresholdReached, true);
  assert.equal(projected.contextMetrics.compactionEligible, false);
  history.push({ role: 'tool', callId: 'a', content: 'second result' });
  assert.equal((await build()).contextMetrics.olderRounds, 1);
  history.push({ role: 'assistant', content: '', calls: [{ id: 'a', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', callId: 'a', content: 'reused id in later round' });
  assert.equal((await build()).contextMetrics.olderRounds, 2);
});

test('M3.2 rejects malformed call/result association without mutating Session', async t => {
  const { ctx, history, build } = await fixture();
  t.after(() => ctx.dispose());
  history.push({ role: 'user', content: 'task' }, { role: 'tool', callId: 'orphan', content: 'x' });
  await assert.rejects(build(), /tool|call|history/i);
  assert.equal(history.length, 2);
  history.pop();
  history.push({ role: 'assistant', content: '', calls: [{ id: 'a', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', callId: 'a', content: 'ok' }, { role: 'tool', callId: 'a', content: 'duplicate' });
  await assert.rejects(build(), /tool|call|history/i);
  history.pop();
  history.pop();
  history.push({ role: 'assistant', content: 'new answer', calls: [] });
  await assert.rejects(build(), /tool|call|history/i);
});

test('M3.2 rejects cancellation, invalid config and calls after disposal', async () => {
  assert.throws(() => contextManagerPlugin({ context: { ...config, keepRecentRounds: 0 } }), /keepRecentRounds/);
  assert.throws(() => contextManagerPlugin({ context: config, enabled: 'yes' } as never), /enabled/);
  assert.throws(() => contextManagerPlugin({ context: config, extra: true } as never), /options/);
  const { ctx, build } = await fixture();
  const abort = new AbortController();
  abort.abort(new Error('stopped'));
  await assert.rejects(build('rules', abort.signal), /stopped/);
  const oldBuild = ctx.get('contextManager').build;
  await ctx.dispose();
  await assert.rejects(oldBuild({ system: 'rules', signal: new AbortController().signal }), /closed/i);
});

test('M3.2 isolates config and Session state across runtimes', async t => {
  const input = { ...config, estimatedWindowTokens: 200 };
  const left = await fixture(input);
  const right = await fixture(input);
  t.after(() => Promise.all([left.ctx.dispose(), right.ctx.dispose()]));
  input.estimatedWindowTokens = 1;
  left.history.push({ role: 'user', content: 'left'.repeat(1000) });
  const a = await left.build();
  const b = await right.build();
  assert.equal(a.contextMetrics.thresholdReached, true);
  assert.equal(b.contextMetrics.thresholdReached, false);
  assert.deepEqual(b.messages, []);
});
