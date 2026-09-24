import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { loadTask, loadTasks, materialize } from '../eval/assets.js';
import { snapshotWorkspace } from '../eval/workspace.js';

const spec = (id: string) => ({
  schemaVersion: 1, id, suite: 'S', category: 'bug-fix', promptFile: 'prompt.md',
  workspaceDir: 'workspace', writable: ['src/code.mjs', 'src/new.mjs'],
  publicTest: 'public.test.mjs', acceptanceTest: 'acceptance/check.mjs',
  referencePatch: 'reference/patch.diff', testTimeoutMs: 1000,
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), 'assets-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'sample');
  await mkdir(join(root, 'workspace', 'src'), { recursive: true });
  await mkdir(join(root, 'acceptance'));
  await mkdir(join(root, 'reference'));
  await writeFile(join(root, 'task.json'), JSON.stringify(spec('sample')));
  await writeFile(join(root, 'prompt.md'), 'Fix the code.\r\n');
  await writeFile(join(root, 'workspace', 'src', 'code.mjs'), 'export const x = 0;\n');
  await writeFile(join(root, 'workspace', 'public.test.mjs'), 'test();\n');
  await writeFile(join(root, 'acceptance', 'check.mjs'), 'hidden canary\n');
  await writeFile(join(root, 'reference', 'patch.diff'), 'secret patch\n');
  return { base, root };
}

test('loads a complete task and hashes every package asset including unreferenced bytes', async t => {
  const { root } = await fixture(t);
  const loaded = await loadTask(root);
  assert.equal(loaded.root, root);
  assert.equal(loaded.spec.id, basename(root));
  assert.equal(loaded.prompt, 'Fix the code.\r\n');
  assert.match(loaded.taskHash, /^[a-f0-9]{64}$/);
  const original = loaded.taskHash;
  await writeFile(join(root, 'extra.bin'), Buffer.from([0xff, 0x00]));
  const withExtra = await loadTask(root);
  assert.notEqual(withExtra.taskHash, original);
  await writeFile(join(root, 'extra.bin'), Buffer.from([0xfe, 0x00]));
  assert.notEqual((await loadTask(root)).taskHash, withExtra.taskHash);
  await writeFile(join(root, 'acceptance', 'check.mjs'), 'changed canary\n');
  assert.notEqual((await loadTask(root)).taskHash, withExtra.taskHash);
  const beforeFormatting = (await loadTask(root)).taskHash;
  await writeFile(join(root, 'task.json'), `${JSON.stringify(spec('sample'))}\n`);
  assert.notEqual((await loadTask(root)).taskHash, beforeFormatting);
});

test('preserves prompt UTF-8 BOM and CRLF bytes from the hashed snapshot', async t => {
  const { root } = await fixture(t);
  const bytes = Buffer.from('\uFEFFFix the code.\r\n', 'utf8');
  await writeFile(join(root, 'prompt.md'), bytes);
  const loaded = await loadTask(root);
  assert.equal(loaded.prompt, '\uFEFFFix the code.\r\n');
  assert.equal(Buffer.compare(Buffer.from(loaded.prompt, 'utf8'), bytes), 0);
  await writeFile(join(root, 'prompt.md'), Buffer.from([0xff]));
  await assert.rejects(loadTask(root), /UTF-8/);
  await writeFile(join(root, 'prompt.md'), bytes);
  await writeFile(join(root, 'task.json'), Buffer.from([0xff]));
  await assert.rejects(loadTask(root), /UTF-8/);
});

test('rejects missing assets, leaked hidden assets, bad writable paths and mismatched IDs', async t => {
  const { root } = await fixture(t);
  await rm(join(root, 'reference', 'patch.diff'));
  await assert.rejects(loadTask(root));
  await writeFile(join(root, 'reference', 'patch.diff'), 'patch');
  for (const change of [
    { acceptanceTest: 'workspace/src/code.mjs' },
    { referencePatch: 'prompt.md' },
    { writable: ['public.test.mjs'] },
    { writable: ['src'] },
    { writable: ['src/code.mjs/child.mjs'] },
    { id: 'wrong' },
  ]) {
    await writeFile(join(root, 'task.json'), JSON.stringify({ ...spec('sample'), ...change }));
    await assert.rejects(loadTask(root));
  }
});

test('rejects symlinks anywhere in the package and duplicate task IDs', async t => {
  const { base, root } = await fixture(t);
  await symlink('prompt.md', join(root, 'alias'));
  await assert.rejects(loadTask(root));
  await rm(join(root, 'alias'));
  await symlink(root, join(base, 'package-link'));
  await assert.rejects(loadTask(join(base, 'package-link')));
  await assert.rejects(loadTasks(base, ['sample', 'sample']));
  await assert.rejects(loadTasks(base, ['../sample']));
  assert.equal((await loadTasks(base, ['sample']))[0]?.spec.id, 'sample');
});

test('materializes only independent workspace bytes and refuses existing or source paths', async t => {
  const { base, root } = await fixture(t);
  const loaded = await loadTask(root);
  const destination = join(base, 'attempt');
  const copy = await materialize(loaded, destination);
  assert.equal(copy.workspace, destination);
  assert.deepEqual(copy.before, await snapshotWorkspace(join(root, 'workspace')));
  assert.equal(await readFile(join(destination, 'src', 'code.mjs'), 'utf8'), 'export const x = 0;\n');
  await assert.rejects(readFile(join(destination, 'prompt.md')));
  await assert.rejects(readFile(join(destination, 'acceptance', 'check.mjs')));
  await writeFile(join(destination, 'src', 'code.mjs'), 'changed');
  assert.equal(await readFile(join(root, 'workspace', 'src', 'code.mjs'), 'utf8'), 'export const x = 0;\n');
  await assert.rejects(materialize(loaded, destination));
  await assert.rejects(materialize(loaded, join(root, 'workspace', 'nested')));
  await symlink(base, join(base, 'destination-link'));
  await assert.rejects(materialize(loaded, join(base, 'destination-link', 'attempt')));
  await writeFile(join(root, 'workspace', 'src', 'code.mjs'), 'mutated');
  await assert.rejects(materialize(loaded, join(base, 'later')));
});
