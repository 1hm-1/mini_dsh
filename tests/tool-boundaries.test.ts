import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '../src/context.js';
import { permissionsPlugin } from '../src/plugins/permissions.js';
import { toolsPlugin } from '../src/plugins/tools.js';
import type { ToolDefinition, ToolResult } from '../src/types.js';

const ok = (output = 'ok'): ToolResult => ({ ok: true, output, errorCode: null, truncated: false });
const writeTool = (execute: ToolDefinition['execute']): ToolDefinition => ({
  name: 'write_file', description: 'Write one allowed file',
  parameters: {
    type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'], additionalProperties: false,
  },
  execute,
});
const call = (args: unknown) => ({ id: 'call-1', name: 'write_file', arguments: JSON.stringify(args) });

test('T02 permissions snapshot the exact whitelist and do not grant prefix or sibling access', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  const writable = ['src/file.mjs'];
  await ctx.use(permissionsPlugin(writable));
  const permissions = ctx.get('permissions');
  writable.push('public.test.mjs');
  assert.equal(permissions.check('write_file', { path: 'src/file.mjs' }).allowed, true);
  for (const tool of ['write_file', 'edit_file', 'delete_file']) {
    for (const path of ['public.test.mjs', 'src/file.mjs.bak', 'src/file.mjs/child', '../src/file.mjs']) {
      assert.equal(permissions.check(tool, { path }).allowed, false);
    }
  }
  assert.equal(permissions.check('list_files', {}).allowed, true);
  assert.equal(permissions.check('list_files', { path: '.' }).allowed, true);
  assert.equal(permissions.check('read_file', { path: 'TEMPLATE.txt' }).allowed, true);
});

test('T04 tool registration and returned schemas cannot be mutated to bypass argument checks', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use(permissionsPlugin(['target.mjs']));
  await ctx.use(toolsPlugin());
  const tools = ctx.get('tools');
  let calls = 0;
  const definition = writeTool(async () => { calls++; return ok(); });
  const remove = tools.register(definition);
  definition.name = 'different';
  (definition.parameters.required as string[]).length = 0;
  definition.execute = async () => { throw new Error('replacement must never run'); };
  const schema = tools.schemas()[0]!;
  (schema.parameters.properties as Record<string, { type: string }>).path!.type = 'number';
  const signal = new AbortController().signal;
  assert.equal((await tools.execute(call({ path: 'target.mjs' }), signal)).ok, false);
  assert.equal((await tools.execute(call({ path: 123, content: 'text' }), signal)).ok, false);
  assert.equal(calls, 0);
  assert.deepEqual(await tools.execute(call({ path: 'target.mjs', content: '' }), signal), ok());
  assert.equal(calls, 1);
  await remove();
  assert.deepEqual(tools.schemas(), []);
});

test('K04 old tool disposers cannot unregister a new definition with the same name', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use(permissionsPlugin(['target.mjs']));
  await ctx.use(toolsPlugin());
  const tools = ctx.get('tools');
  const first = tools.register(writeTool(async () => ok('first')));
  await first();
  const second = tools.register(writeTool(async () => ok('second')));
  await first();
  assert.equal((await tools.execute(call({ path: 'target.mjs', content: 'x' }), new AbortController().signal)).output, 'second');
  await second();
  assert.deepEqual(tools.schemas(), []);
});

test('T04 cancellation prevents dispatch and propagates unchanged after a handler settles', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use(permissionsPlugin(['target.mjs']));
  await ctx.use(toolsPlugin());
  const tools = ctx.get('tools');
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  tools.register(writeTool(async () => { calls++; entered.resolve(); await gate.promise; return ok(); }));
  const reason = new Error('cancelled by caller');
  const cancelled = new AbortController();
  cancelled.abort(reason);
  await assert.rejects(tools.execute(call({ path: 'target.mjs', content: 'x' }), cancelled.signal), error => error === reason);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const execution = tools.execute(call({ path: 'target.mjs', content: 'x' }), controller.signal);
  await entered.promise;
  controller.abort(reason);
  const rejected = assert.rejects(execution, error => error === reason);
  gate.resolve();
  await rejected;
  assert.equal(calls, 1);
});

test('T04 the output bound includes its truncation marker and preserves prior truncation', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use(permissionsPlugin(['target.mjs']));
  await ctx.use(toolsPlugin());
  const tools = ctx.get('tools');
  let remove = tools.register(writeTool(async () => ok('汉😀'.repeat(6000))));
  const signal = new AbortController().signal;
  const result = await tools.execute(call({ path: 'target.mjs', content: 'x' }), signal);
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.ok(result.output.length <= 16000);
  assert.match(result.output, /truncat/i);
  await remove();
  remove = tools.register(writeTool(async () => ({ ...ok('short'), truncated: true })));
  assert.equal((await tools.execute(call({ path: 'target.mjs', content: 'x' }), signal)).truncated, true);
  await remove();
});

test('T02 permission configuration rejects sparse and wildcard whitelists', () => {
  for (const writable of [Array<string>(1), ['*.mjs'], ['src/?.mjs'], ['src/[ab].mjs'], ['src/{one,two}.mjs']]) {
    assert.throws(() => permissionsPlugin(writable), /writable|path|permission/i);
  }
});

test('T04 tool results cannot carry fields outside the shared result contract', async t => {
  const ctx = new Context();
  t.after(() => ctx.dispose());
  await ctx.use(permissionsPlugin(['target.mjs']));
  await ctx.use(toolsPlugin());
  const tools = ctx.get('tools');
  tools.register(writeTool(async () => ({ ...ok(), internalDetail: 'must remain private' })));
  const result = await tools.execute(call({ path: 'target.mjs', content: 'x' }), new AbortController().signal);
  assert.deepEqual(Object.keys(result).sort(), ['errorCode', 'ok', 'output', 'truncated']);
  assert.equal(JSON.stringify(result).includes('must remain private'), false);
});
