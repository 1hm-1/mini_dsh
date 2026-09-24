import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '../src/context.js';
import { permissionsPlugin } from '../src/plugins/permissions.js';
import { toolsPlugin } from '../src/plugins/tools.js';
import type { MiniPlugin } from '../src/plugin.js';
import type { ToolDefinition, ToolResult } from '../src/types.js';

const ok = (output = 'ok'): ToolResult => ({ ok: true, output, errorCode: null, truncated: false });
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const stringField = { type: 'string' };
const definition = (name: string, parameters: Record<string, unknown>, execute: ToolDefinition['execute']): ToolDefinition => ({
  name, description: `${name} description`, parameters, execute,
});
const call = (name: string, args: unknown) => ({ id: 'call-1', name, arguments: JSON.stringify(args) });

async function setup(writable: string[] = []) {
  const ctx = new Context();
  await ctx.use(permissionsPlugin(writable));
  await ctx.use(toolsPlugin());
  return ctx;
}

test('T01/T02 permission checks known tools, lexical paths, and exact writable entries', async () => {
  const ctx = await setup(['src/file.ts']);
  const permission = ctx.get('permissions');
  for (const name of ['read_file', 'list_files']) {
    assert.deepEqual(permission.check(name, { path: 'src/file.ts' }), { allowed: true, reason: null });
  }
  assert.deepEqual(permission.check('list_files', {}), { allowed: true, reason: null });
  for (const name of ['write_file', 'edit_file', 'delete_file']) {
    assert.equal(permission.check(name, { path: 'src/file.ts' }).allowed, true);
    assert.equal(permission.check(name, { path: 'src/other.ts' }).allowed, false);
  }
  for (const path of ['../file.ts', 'src/../file.ts', '/tmp/file.ts', 'C:/file.ts', 'src\\file.ts', 'src//file.ts', 'src/./file.ts', 'src/\0file.ts']) {
    assert.equal(permission.check('read_file', { path }).allowed, false, path);
    assert.equal(permission.check('write_file', { path }).allowed, false, path);
  }
  assert.equal(permission.check('run_command', { path: 'src/file.ts' }).allowed, false);
  await ctx.dispose();
  const empty = await setup();
  assert.equal(empty.get('permissions').check('write_file', { path: 'src/file.ts' }).allowed, false);
  await empty.dispose();
});

test('K04 tools register sorted schemas with isolated snapshots and identity-bound disposers', async () => {
  const ctx = await setup();
  const tools = ctx.get('tools');
  const params = schema({ path: stringField }, ['path']);
  const removeZ = tools.register(definition('read_file', params, async () => ok('first')));
  const removeA = tools.register(definition('list_files', schema({ path: stringField }, []), async () => ok('list')));
  assert.deepEqual(tools.schemas().map(item => item.name), ['list_files', 'read_file']);
  assert.throws(() => tools.register(definition('read_file', params, async () => ok())), /already|duplicate/i);
  (params.properties as Record<string, unknown>).path = { type: 'number' };
  const snapshot = tools.schemas();
  assert.deepEqual(snapshot[1]?.parameters.properties, { path: stringField });
  (snapshot[1]?.parameters.properties as Record<string, unknown>).path = { type: 'number' };
  assert.deepEqual(tools.schemas()[1]?.parameters.properties, { path: stringField });
  removeZ();
  const removeReplacement = tools.register(definition('read_file', schema({ path: stringField }, ['path']), async () => ok('second')));
  removeZ();
  assert.equal((await tools.execute(call('read_file', { path: 'x' }), new AbortController().signal)).output, 'second');
  removeReplacement();
  removeA();
  assert.deepEqual(tools.schemas(), []);
  assert.equal((await tools.execute(call('read_file', { path: 'x' }), new AbortController().signal)).errorCode, 'unknown_tool');
  await ctx.dispose();
  assert.equal(ctx.has('tools'), false);
});

test('T04 registration rejects unsupported or inconsistent schema keywords', async () => {
  const ctx = await setup();
  const tools = ctx.get('tools');
  for (const parameters of [
    { ...schema({ path: stringField }, ['path']), oneOf: [] },
    schema({ path: { type: 'string', pattern: '.*' } }, ['path']),
    schema({ path: stringField }, ['missing']),
    { ...schema({ path: stringField }, ['path']), additionalProperties: true },
  ]) assert.throws(() => tools.register(definition('read_file', parameters, async () => ok())), /schema|parameters/i);
  await ctx.dispose();
});

test('T02/T04 execute validates JSON object, exact fields and types before permission or handler', async () => {
  const ctx = await setup(['allowed.ts']);
  const tools = ctx.get('tools');
  let executions = 0;
  tools.register(definition('write_file', schema({ path: stringField, content: stringField }, ['path', 'content']), async () => { executions++; return ok(); }));
  const signal = new AbortController().signal;
  const invalid = [
    { id: '1', name: 'write_file', arguments: '{' },
    call('write_file', null), call('write_file', []), call('write_file', { path: 'allowed.ts' }),
    call('write_file', { path: 'allowed.ts', content: 1 }),
    call('write_file', { path: 'allowed.ts', content: '', extra: 'x' }),
  ];
  for (const item of invalid) {
    const result = await tools.execute(item, signal);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'invalid_arguments');
    assert.equal(result.output.includes('allowed.ts'), false);
  }
  assert.equal((await tools.execute(call('write_file', { path: 'outside.ts', content: 'secret' }), signal)).errorCode, 'permission_denied');
  assert.equal(executions, 0);
  assert.equal((await tools.execute(call('write_file', { path: 'allowed.ts', content: '' }), signal)).ok, true);
  assert.equal((await tools.execute(call('write_file', { path: 'allowed.ts', content: 'TEMPLATE' }), signal)).ok, true);
  assert.equal(executions, 2);
  await ctx.dispose();
});

test('T04 ordinary handler failures are sanitized, output is bounded, and cancellation propagates', async () => {
  const ctx = await setup();
  const tools = ctx.get('tools');
  const params = schema({ path: stringField }, ['path']);
  tools.register(definition('read_file', params, async () => { throw new Error('private path and secret'); }));
  const signal = new AbortController().signal;
  assert.deepEqual(await tools.execute(call('read_file', { path: 'x' }), signal), {
    ok: false, output: 'Tool execution failed', errorCode: 'tool_error', truncated: false,
  });
  const remove = tools.register(definition('list_files', schema({ path: stringField }, []), async () => ok('x'.repeat(17000))));
  const limited = await tools.execute(call('list_files', {}), signal);
  assert.equal(limited.output.length <= 16000, true);
  assert.equal(limited.output.endsWith('[truncated]'), true);
  assert.equal(limited.truncated, true);
  remove();
  const cancelled = new AbortController();
  cancelled.abort(new Error('cancelled'));
  await assert.rejects(tools.execute(call('read_file', { path: 'x' }), cancelled.signal), /cancelled/);
  await ctx.dispose();
});

test('K04 replacement permission provider can permit a custom tool without changing ToolsService', async () => {
  const ctx = new Context();
  const custom: MiniPlugin = { name: 'permissions', setup: c => c.provide('permissions', { check: () => ({ allowed: true, reason: null }) }) };
  await ctx.use(custom);
  await ctx.use(toolsPlugin());
  ctx.get('tools').register(definition('custom', schema({ message: stringField }, ['message']), async args => ok(String(args.message))));
  assert.equal((await ctx.get('tools').execute(call('custom', { message: 'works' }), new AbortController().signal)).output, 'works');
  await ctx.dispose();
});
