import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { loadTask, materialize } from '../eval/assets.js';
import { grade } from '../eval/judge.js';
import { checkIntegrity, snapshotWorkspace } from '../eval/workspace.js';

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'judge-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'sample');
  await mkdir(join(root, 'workspace'), { recursive: true });
  await mkdir(join(root, 'acceptance'));
  await mkdir(join(root, 'reference'));
  const spec = {
    schemaVersion: 1, id: 'sample', suite: 'S', category: 'bug-fix',
    promptFile: 'prompt.md', workspaceDir: 'workspace', writable: ['code.mjs'],
    publicTest: 'public.test.mjs', acceptanceTest: 'acceptance/check.mjs',
    referencePatch: 'reference/patch.diff', testTimeoutMs: 3000,
  };
  await writeFile(join(root, 'task.json'), JSON.stringify(spec));
  await writeFile(join(root, 'prompt.md'), 'Fix the code.');
  await writeFile(join(root, 'workspace', 'code.mjs'), 'export const value = 0;\n');
  await writeFile(join(root, 'workspace', 'public.test.mjs'), "import { test } from 'node:test'; import { value } from './code.mjs'; test('public', () => { if (value < 1) throw Error('low'); });\n");
  await writeFile(join(root, 'acceptance', 'check.mjs'), "import { test } from 'node:test'; import { value } from './code.mjs'; test('hidden', () => { if (value !== 2) throw Error('wrong'); });\n");
  await writeFile(join(root, 'reference', 'patch.diff'), 'reference canary');
  const task = await loadTask(root);
  const candidate = join(base, 'candidate');
  const { before } = await materialize(task, candidate);
  return { base, root, task, candidate, before, spec };
}

test('E03 public pass, hidden failure keeps both outputs and rejects main success', async t => {
  const f = await fixture(t);
  await writeFile(join(f.candidate, 'code.mjs'), 'export const value = 1;\n');
  const result = await grade({ task: f.task, before: f.before, after: await snapshotWorkspace(f.candidate), termination: 'completed', outputDir: join(f.base, 'grade') });
  assert.equal(result.integrity.passed, true);
  assert.equal(result.publicTest.passed, true);
  assert.equal(result.acceptanceTest.passed, false);
  assert.equal(result.functionalPass, false);
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, 'acceptance_test');
  assert.match(await readFile(join(f.base, 'grade', 'public-output.txt'), 'utf8'), /public/);
  assert.match(await readFile(join(f.base, 'grade', 'acceptance-output.txt'), 'utf8'), /hidden/);
  assert.deepEqual((await readdir(join(f.base, 'grade'))).sort(), ['acceptance-output.txt', 'public-output.txt']);
});

test('E03 protected public test tampering is excluded; allowed code can still pass both checks', async t => {
  const f = await fixture(t);
  await writeFile(join(f.candidate, 'code.mjs'), 'export const value = 2;\n');
  await writeFile(join(f.candidate, 'public.test.mjs'), "import { test } from 'node:test'; test('forged', () => {});\n");
  const result = await grade({ task: f.task, before: f.before, after: await snapshotWorkspace(f.candidate), termination: 'completed', outputDir: join(f.base, 'grade') });
  assert.equal(result.integrity.passed, false);
  assert.equal(result.functionalPass, true);
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, 'integrity');
  assert.match(await readFile(join(f.base, 'grade', 'public-output.txt'), 'utf8'), /public/);
  assert.doesNotMatch(await readFile(join(f.base, 'grade', 'public-output.txt'), 'utf8'), /forged/);
  assert.equal(await readFile(join(f.root, 'workspace', 'code.mjs'), 'utf8'), 'export const value = 0;\n');
  assert.equal(await readFile(join(f.candidate, 'code.mjs'), 'utf8'), 'export const value = 2;\n');
});

test('E03 budget termination takes precedence even when functionally passing', async t => {
  const f = await fixture(t);
  await writeFile(join(f.candidate, 'code.mjs'), 'export const value = 2;\n');
  const result = await grade({ task: f.task, before: f.before, after: await snapshotWorkspace(f.candidate), termination: 'request_limit', outputDir: join(f.base, 'grade') });
  assert.equal(result.functionalPass, true);
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, 'request_limit');
});

test('E02 acceptance uses original bytes and relative import from a separate check copy', async t => {
  const f = await fixture(t);
  await writeFile(join(f.candidate, 'code.mjs'), 'export const value = 2;\n');
  const result = await grade({ task: f.task, before: f.before, after: await snapshotWorkspace(f.candidate), termination: 'completed', outputDir: join(f.base, 'grade') });
  assert.equal(result.passed, true);
  assert.equal(result.failureReason, null);
  await assert.rejects(readFile(join(f.candidate, 'acceptance.test.mjs')));
  await assert.rejects(readFile(join(f.candidate, 'reference', 'patch.diff')));
  assert.equal(await readFile(join(f.root, 'acceptance', 'check.mjs'), 'utf8').then(s => s.includes('hidden')), true);
});

test('public test writes cannot contaminate fresh acceptance check copy', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'workspace', 'public.test.mjs'), "import { test } from 'node:test'; import { writeFileSync } from 'node:fs'; writeFileSync('poison.txt', 'bad'); test('public', () => {});\n");
  await writeFile(join(f.root, 'acceptance', 'check.mjs'), "import { test } from 'node:test'; import { existsSync } from 'node:fs'; test('hidden', () => { if (existsSync('poison.txt')) throw Error('polluted'); });\n");
  const task = await loadTask(f.root);
  const before = await snapshotWorkspace(join(f.root, 'workspace'));
  const result = await grade({ task, before, after: before, termination: 'completed', outputDir: join(f.base, 'grade') });
  assert.equal(result.passed, true);
  assert.deepEqual((await readdir(join(f.base, 'grade'))).sort(), ['acceptance-output.txt', 'public-output.txt']);
});

test('rejects forged task or before snapshot, changed source, reserved acceptance path and existing output', async t => {
  const f = await fixture(t);
  const run = (task: typeof f.task, before = f.before, name = 'grade') => grade({ task, before, after: before, termination: 'completed', outputDir: join(f.base, name) });
  await assert.rejects(run({ ...f.task, spec: { ...f.task.spec, writable: ['public.test.mjs'] } }), /task|asset|changed/i);
  await assert.rejects(run(f.task, { schemaVersion: 1, entries: [] }), /before|workspace|snapshot/i);
  await writeFile(join(f.root, 'prompt.md'), 'changed');
  await assert.rejects(run(f.task), /task|asset|changed/i);
  await writeFile(join(f.root, 'prompt.md'), 'Fix the code.');
  await writeFile(join(f.root, 'workspace', 'acceptance.test.mjs'), 'original');
  const reserved = await loadTask(f.root);
  await assert.rejects(run(reserved), /acceptance.test.mjs|reserved/i);
  await rm(join(f.root, 'workspace', 'acceptance.test.mjs'));
  await mkdir(join(f.base, 'existing'));
  await writeFile(join(f.base, 'existing', 'keep'), 'original');
  await assert.rejects(run(f.task, f.before, 'existing'));
  assert.equal(await readFile(join(f.base, 'existing', 'keep'), 'utf8'), 'original');
});

test('writable symlink is excluded; writable file-to-directory matches checkIntegrity and check copy', async t => {
  const f = await fixture(t);
  await rm(join(f.candidate, 'code.mjs'));
  await symlink(join(f.root, 'workspace', 'code.mjs'), join(f.candidate, 'code.mjs'));
  const linkedAfter = await snapshotWorkspace(f.candidate);
  const linked = await grade({ task: f.task, before: f.before, after: linkedAfter, termination: 'completed', outputDir: join(f.base, 'linked') });
  assert.equal(linked.integrity.passed, false);
  assert.deepEqual(linked.integrity, checkIntegrity(f.before, linkedAfter, f.task.spec.writable));
  assert.equal(linked.publicTest.passed, false);
  assert.deepEqual((await readdir(join(f.base, 'linked'))).sort(), ['acceptance-output.txt', 'public-output.txt']);

  await rm(join(f.candidate, 'code.mjs'));
  await mkdir(join(f.candidate, 'code.mjs'));
  const directoryAfter = await snapshotWorkspace(f.candidate);
  const directory = await grade({ task: f.task, before: f.before, after: directoryAfter, termination: 'completed', outputDir: join(f.base, 'directory') });
  assert.deepEqual(directory.integrity, checkIntegrity(f.before, directoryAfter, f.task.spec.writable));
  assert.equal(directory.integrity.passed, true);
  assert.equal(directory.publicTest.passed, false);
  assert.equal(directory.passed, false);
});

test('writable deletion is applied before both tests', async t => {
  const f = await fixture(t);
  const check = "import { test } from 'node:test'; import { existsSync } from 'node:fs'; test('deleted', () => { if (existsSync('code.mjs')) throw Error('still present'); });\n";
  await writeFile(join(f.root, 'workspace', 'public.test.mjs'), check);
  await writeFile(join(f.root, 'acceptance', 'check.mjs'), check);
  const task = await loadTask(f.root);
  const before = await snapshotWorkspace(join(f.root, 'workspace'));
  await writeFile(join(f.candidate, 'public.test.mjs'), check);
  await rm(join(f.candidate, 'code.mjs'));
  const after = await snapshotWorkspace(f.candidate);
  const result = await grade({ task, before, after, termination: 'completed', outputDir: join(f.base, 'deleted') });
  assert.deepEqual(result.integrity, checkIntegrity(before, after, task.spec.writable));
  assert.equal(result.passed, true);
  assert.equal(await readFile(join(f.root, 'workspace', 'code.mjs'), 'utf8'), 'export const value = 0;\n');
});
