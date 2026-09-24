import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Context } from '../src/context.js';
import { fileToolsPlugin, fileToolSchemas } from '../src/plugins/file-tools.js';
import { atomicWrite } from '../src/plugins/file-tools-atomic.js';
import { permissionsPlugin } from '../src/plugins/permissions.js';
import { toolsPlugin } from '../src/plugins/tools.js';

const signal = new AbortController().signal;
const call = (name: string, args: unknown) => ({ id: 'file-call', name, arguments: JSON.stringify(args) });

async function setup(root: string, writable: string[]) {
  const ctx = new Context();
  await ctx.use(permissionsPlugin(writable));
  await ctx.use(toolsPlugin());
  await ctx.use(fileToolsPlugin(root));
  return ctx;
}

test('T01/T02 file tools register five schemas and perform allowed CRUD in one workspace', async t => {
  const root = await mkdtemp(join(tmpdir(), 'file-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'a.txt'), 'first\n');
  const ctx = await setup(root, ['src/a.txt', 'src/new.txt']);
  t.after(() => ctx.dispose());
  const tools = ctx.get('tools');
  assert.equal(JSON.stringify(fileToolSchemas()), JSON.stringify(tools.schemas()));
  const changed = fileToolSchemas(); changed[0]!.description = 'mutated';
  assert.equal(JSON.stringify(fileToolSchemas()), JSON.stringify(tools.schemas()));
  assert.deepEqual(tools.schemas().map(item => item.name), ['delete_file', 'edit_file', 'list_files', 'read_file', 'write_file']);
  assert.equal((await tools.execute(call('read_file', { path: 'src/a.txt' }), signal)).output, 'first\n');
  assert.equal((await tools.execute(call('write_file', { path: 'src/new.txt', content: 'new' }), signal)).ok, true);
  assert.equal((await tools.execute(call('edit_file', { path: 'src/a.txt', oldText: 'first', newText: 'second' }), signal)).ok, true);
  assert.equal(await readFile(join(root, 'src', 'a.txt'), 'utf8'), 'second\n');
  assert.equal((await tools.execute(call('delete_file', { path: 'src/new.txt' }), signal)).ok, true);
  assert.equal((await tools.execute(call('delete_file', { path: 'src/new.txt' }), signal)).errorCode, 'file_missing');
  assert.equal((await tools.execute(call('write_file', { path: 'src/no/child.txt', content: 'x' }), signal)).ok, false);
});

test('T01/T02 traversal, symlink parent and leaf, special file, and non-whitelist writes are rejected', async t => {
  const root = await mkdtemp(join(tmpdir(), 'file-boundary-'));
  const outside = await mkdtemp(join(tmpdir(), 'file-outside-'));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await writeFile(join(outside, 'sentinel.txt'), 'safe');
  await symlink(outside, join(root, 'linkdir'));
  await symlink(join(outside, 'sentinel.txt'), join(root, 'linkfile'));
  await mkdir(join(root, 'directory'));
  const socket = createServer();
  const socketPath = join(root, 'special.sock');
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(socketPath, resolve); });
  t.after(() => new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve())));
  const ctx = await setup(root, ['linkdir/sentinel.txt', 'linkfile', 'directory', 'special.sock', 'protected.txt']);
  t.after(() => ctx.dispose());
  const tools = ctx.get('tools');
  for (const path of ['../sentinel.txt', join(outside, 'sentinel.txt'), 'linkdir/sentinel.txt', 'linkfile', 'directory', 'special.sock']) {
    assert.equal((await tools.execute(call('read_file', { path }), signal)).ok, false, path);
  }
  for (const path of ['linkdir/sentinel.txt', 'linkfile', 'directory', 'special.sock']) {
    assert.equal((await tools.execute(call('write_file', { path, content: 'bad' }), signal)).ok, false, path);
  }
  assert.equal((await tools.execute(call('write_file', { path: 'sentinel.txt', content: 'bad' }), signal)).errorCode, 'permission_denied');
  assert.equal((await tools.execute(call('list_files', {}), signal)).ok, false);
  assert.equal(await readFile(join(outside, 'sentinel.txt'), 'utf8'), 'safe');
});

test('T03 edit requires exactly one match, including overlapping occurrences, and writes stay atomic on rename failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'file-edit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'target.txt');
  await writeFile(target, 'aaaa');
  const ctx = await setup(root, ['target.txt']);
  t.after(() => ctx.dispose());
  const tools = ctx.get('tools');
  assert.equal((await tools.execute(call('edit_file', { path: 'target.txt', oldText: '', newText: 'x' }), signal)).ok, false);
  assert.equal((await tools.execute(call('edit_file', { path: 'target.txt', oldText: 'missing', newText: 'x' }), signal)).errorCode, 'edit_no_match');
  assert.equal((await tools.execute(call('edit_file', { path: 'target.txt', oldText: 'aa', newText: 'x' }), signal)).errorCode, 'edit_multiple_matches');
  assert.equal(await readFile(target, 'utf8'), 'aaaa');
  assert.equal((await tools.execute(call('edit_file', { path: 'target.txt', oldText: 'aaaa', newText: 'ok' }), signal)).ok, true);
  assert.equal(await readFile(target, 'utf8'), 'ok');
  await assert.rejects(atomicWrite(target, 'replacement', signal, async () => { throw new Error('injected rename failure'); }));
  assert.equal(await readFile(target, 'utf8'), 'ok');
  assert.deepEqual(await readdir(root), ['target.txt']);
  await assert.rejects(atomicWrite(target, 'replacement', signal, undefined, async handle => {
    await handle.writeFile('partial');
    throw new Error('injected partial write failure');
  }));
  assert.equal(await readFile(target, 'utf8'), 'ok');
  assert.deepEqual(await readdir(root), ['target.txt']);
  const cancelled = new AbortController();
  const reason = new Error('cancel before rename');
  await assert.rejects(atomicWrite(target, 'replacement', cancelled.signal, async () => {
    assert.fail('rename ran after cancellation');
  }, async handle => {
    await handle.writeFile('partial');
    cancelled.abort(reason);
  }), error => error === reason);
  assert.equal(await readFile(target, 'utf8'), 'ok');
  assert.deepEqual(await readdir(root), ['target.txt']);
});

test('T04 file limits use UTF-8 bytes and preserve oversized originals', async t => {
  const root = await mkdtemp(join(tmpdir(), 'file-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'large.txt');
  await writeFile(target, 'a'.repeat(256 * 1024 + 1));
  const ctx = await setup(root, ['large.txt', 'new.txt']);
  t.after(() => ctx.dispose());
  const tools = ctx.get('tools');
  assert.equal((await tools.execute(call('read_file', { path: 'large.txt' }), signal)).errorCode, 'file_too_large');
  assert.equal((await tools.execute(call('write_file', { path: 'large.txt', content: 'small' }), signal)).errorCode, 'file_too_large');
  assert.equal((await tools.execute(call('write_file', { path: 'new.txt', content: '界'.repeat(90_000) }), signal)).errorCode, 'file_too_large');
  assert.equal((await tools.execute(call('read_file', { path: 'missing.txt' }), signal)).errorCode, 'file_missing');
  assert.equal((await tools.execute(call('delete_file', { path: 'new.txt' }), signal)).errorCode, 'file_missing');
  assert.equal((await readFile(target)).byteLength, 256 * 1024 + 1);
});

test('T04 listing has global lexical order and a 1000-entry truncation flag', async t => {
  const root = await mkdtemp(join(tmpdir(), 'file-list-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'a'));
  await writeFile(join(root, 'a.txt'), 'x');
  await writeFile(join(root, 'a', 'child.txt'), 'x');
  for (let i = 0; i < 1000; i++) await writeFile(join(root, `z${String(i).padStart(4, '0')}.txt`), 'x');
  const ctx = await setup(root, []);
  t.after(() => ctx.dispose());
  const result = await ctx.get('tools').execute(call('list_files', {}), signal);
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.output.split('\n').slice(0, 2), ['a.txt', 'a/child.txt']);
  assert.equal(result.output.split('\n').length, 1001);
  assert.equal(result.output.split('\n').at(-1), '[truncated]');
});

test('K04 two file-tool lifecycles keep workspace and registration isolated', async () => {
  const left = await mkdtemp(join(tmpdir(), 'file-left-'));
  const right = await mkdtemp(join(tmpdir(), 'file-right-'));
  try {
    await writeFile(join(left, 'x.txt'), 'left');
    await writeFile(join(right, 'x.txt'), 'right');
    const a = await setup(left, []);
    const b = await setup(right, []);
    try {
      assert.equal((await a.get('tools').execute(call('read_file', { path: 'x.txt' }), signal)).output, 'left');
      assert.equal((await b.get('tools').execute(call('read_file', { path: 'x.txt' }), signal)).output, 'right');
      await a.dispose();
      assert.equal((await b.get('tools').execute(call('read_file', { path: 'x.txt' }), signal)).output, 'right');
    } finally { await a.dispose(); await b.dispose(); }
  } finally { await rm(left, { recursive: true, force: true }); await rm(right, { recursive: true, force: true }); }
});
