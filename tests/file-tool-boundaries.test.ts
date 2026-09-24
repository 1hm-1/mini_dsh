import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { Context } from '../src/context.js';
import { fileToolsPlugin } from '../src/plugins/file-tools.js';
import { permissionsPlugin } from '../src/plugins/permissions.js';
import { toolsPlugin } from '../src/plugins/tools.js';

async function fixture(t: TestContext, writable: string[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-files-boundary-'));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const ctx = new Context();
  t.after(async () => { await ctx.dispose(); await rm(root, { recursive: true, force: true }); });
  await ctx.use(permissionsPlugin(writable));
  await ctx.use(toolsPlugin());
  await ctx.use(fileToolsPlugin(workspace));
  const tools = ctx.get('tools');
  const call = (name: string, args: unknown, signal = new AbortController().signal) =>
    tools.execute({ id: 'boundary-call', name, arguments: JSON.stringify(args) }, signal);
  return { root, workspace, ctx, call };
}

test('T01/T02 invalid paths and non-whitelisted mutations preserve outside and public files', async t => {
  const f = await fixture(t, ['allowed.txt']);
  await writeFile(path.join(f.root, 'sentinel.txt'), 'outside');
  await writeFile(path.join(f.workspace, 'public.test.mjs'), 'protected');
  for (const target of ['../sentinel.txt', '/etc/passwd', 'a/../allowed.txt', 'a\\b', 'a\0b', 'a//b', './allowed.txt']) {
    for (const name of ['read_file', 'write_file', 'edit_file', 'delete_file']) {
      const args = name === 'write_file' ? { path: target, content: 'changed' }
        : name === 'edit_file' ? { path: target, oldText: 'outside', newText: 'changed' } : { path: target };
      assert.equal((await f.call(name, args)).ok, false, `${name}: ${target}`);
    }
  }
  for (const [name, args] of [
    ['write_file', { path: 'public.test.mjs', content: 'changed' }],
    ['edit_file', { path: 'public.test.mjs', oldText: 'protected', newText: 'changed' }],
    ['delete_file', { path: 'public.test.mjs' }],
  ] as const) assert.equal((await f.call(name, args)).errorCode, 'permission_denied');
  assert.equal(await readFile(path.join(f.root, 'sentinel.txt'), 'utf8'), 'outside');
  assert.equal(await readFile(path.join(f.workspace, 'public.test.mjs'), 'utf8'), 'protected');
});

test('T01 symlink parents and leaves cannot reach a workspace-prefix sibling', async t => {
  const f = await fixture(t, ['linked.txt', 'linked-dir/sentinel.txt', 'linked-dir/new.txt']);
  const outside = path.join(f.root, 'workspace-other');
  await mkdir(outside);
  await writeFile(path.join(outside, 'sentinel.txt'), 'outside');
  await symlink(outside, path.join(f.workspace, 'linked-dir'));
  await symlink(path.join(outside, 'sentinel.txt'), path.join(f.workspace, 'linked.txt'));
  for (const target of ['linked.txt', 'linked-dir/sentinel.txt', 'linked-dir/new.txt']) {
    for (const [name, args] of [
      ['read_file', { path: target }], ['write_file', { path: target, content: 'changed' }],
      ['edit_file', { path: target, oldText: 'outside', newText: 'changed' }], ['delete_file', { path: target }],
    ] as const) {
      const result = await f.call(name, args);
      assert.equal(result.ok, false);
      assert.equal(result.output.includes(f.root), false);
    }
  }
  assert.equal((await f.call('list_files', {})).ok, false);
  assert.equal(await readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside');
  assert.deepEqual(await readdir(outside), ['sentinel.txt']);
});

test('T03 edit rejects overlapping matches and leaves both content and directory intact', async t => {
  const f = await fixture(t, ['file.txt']);
  await writeFile(path.join(f.workspace, 'file.txt'), 'aaa');
  for (const oldText of ['', 'aa', 'missing']) {
    assert.equal((await f.call('edit_file', { path: 'file.txt', oldText, newText: 'x' })).ok, false);
    assert.equal(await readFile(path.join(f.workspace, 'file.txt'), 'utf8'), 'aaa');
    assert.deepEqual(await readdir(f.workspace), ['file.txt']);
  }
  assert.equal((await f.call('edit_file', { path: 'file.txt', oldText: 'aaa', newText: '' })).ok, true);
  assert.equal(await readFile(path.join(f.workspace, 'file.txt'), 'utf8'), '');
});

test('T04 file byte limits protect oversized originals and oversized edit results', async t => {
  const f = await fixture(t, ['file.txt', 'new.txt']);
  const oversized = '汉'.repeat(Math.ceil(256 * 1024 / 3));
  assert.ok(oversized.length < 256 * 1024);
  assert.equal((await f.call('write_file', { path: 'new.txt', content: oversized })).ok, false);
  assert.deepEqual(await readdir(f.workspace), []);
  await writeFile(path.join(f.workspace, 'file.txt'), oversized);
  for (const [name, args] of [
    ['read_file', { path: 'file.txt' }], ['write_file', { path: 'file.txt', content: 'small' }],
    ['edit_file', { path: 'file.txt', oldText: oversized, newText: 'small' }],
  ] as const) assert.equal((await f.call(name, args)).ok, false);
  assert.equal(await readFile(path.join(f.workspace, 'file.txt'), 'utf8'), oversized);
  const exact = 'a'.repeat(256 * 1024);
  await writeFile(path.join(f.workspace, 'file.txt'), exact);
  const read = await f.call('read_file', { path: 'file.txt' });
  assert.equal(read.ok, true);
  assert.equal(read.truncated, true);
  assert.ok(read.output.length <= 16000);
  assert.equal((await f.call('edit_file', { path: 'file.txt', oldText: exact, newText: exact + 'a' })).ok, false);
  assert.equal(await readFile(path.join(f.workspace, 'file.txt'), 'utf8'), exact);
});

test('T04 recursive lists use global path ordering and flag only an actual item overflow', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.workspace, 'a'));
  await writeFile(path.join(f.workspace, 'a/z'), 'z');
  await writeFile(path.join(f.workspace, 'a.txt'), 'a');
  const first = await f.call('list_files', {});
  assert.equal(first.ok, true);
  assert.deepEqual(first.output.trim().split('\n'), ['a.txt', 'a/z']);
  assert.equal((await f.call('list_files', { path: 'a' })).output.trim(), 'a/z');
  for (let start = 0; start < 998; start += 50) {
    await Promise.all(Array.from({ length: Math.min(50, 998 - start) }, (_, i) =>
      writeFile(path.join(f.workspace, `f${String(start + i).padStart(4, '0')}`), '')));
  }
  const exact = await f.call('list_files', {});
  assert.equal(exact.truncated, false);
  assert.equal(exact.output.trim().split('\n').length, 1000);
  await writeFile(path.join(f.workspace, 'last'), '');
  const over = await f.call('list_files', {});
  assert.equal(over.ok, true);
  assert.equal(over.truncated, true);
  assert.match(over.output, /truncat/i);
  assert.deepEqual(over.output.split('\n').filter(line => line && !line.includes('truncated')), exact.output.trim().split('\n'));
});

test('T03/T04 missing parents and pre-cancelled writes do not create files', async t => {
  const f = await fixture(t, ['missing/new.txt', 'new.txt']);
  assert.equal((await f.call('write_file', { path: 'missing/new.txt', content: 'x' })).ok, false);
  const controller = new AbortController();
  const reason = new Error('stop');
  controller.abort(reason);
  await assert.rejects(f.call('write_file', { path: 'new.txt', content: 'x' }, controller.signal), error => error === reason);
  assert.deepEqual(await readdir(f.workspace), []);
});

test('K04 partially failed file-tool setup unregisters its earlier handlers', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-files-register-'));
  const ctx = new Context();
  t.after(async () => { await ctx.dispose(); await rm(root, { recursive: true, force: true }); });
  const active = new Set<string>();
  let registrations = 0;
  const failure = new Error('injected third registration failure');
  await ctx.use({ name: 'test-tools', setup(c) {
    return c.provide('tools', {
      register(definition) {
        if (++registrations === 3) throw failure;
        active.add(definition.name);
        const position = registrations;
        return async () => {
          active.delete(definition.name);
          if (position === 2) throw new Error('injected cleanup failure');
        };
      },
      schemas() { return []; },
      async execute() { throw new Error('not used'); },
    });
  } });
  await assert.rejects(ctx.use(fileToolsPlugin(root)), error => error === failure);
  assert.equal(registrations, 3);
  assert.deepEqual([...active], []);
});

test('T03 atomic replacement supports a full-length file basename', async t => {
  const name = 'x'.repeat(255);
  const f = await fixture(t, [name]);
  assert.equal((await f.call('write_file', { path: name, content: 'first' })).ok, true);
  assert.equal((await f.call('edit_file', { path: name, oldText: 'first', newText: 'second' })).ok, true);
  assert.equal(await readFile(path.join(f.workspace, name), 'utf8'), 'second');
  assert.deepEqual(await readdir(f.workspace), [name]);
});
