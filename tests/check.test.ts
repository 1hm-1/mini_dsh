import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCheck } from '../eval/check.js';

async function setup(t: { after: (fn: () => Promise<void>) => void }, source: string) {
  const root = await mkdtemp(join(tmpdir(), 'check-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'check.mjs'), source);
  return { root, workspace, outputPath: join(root, 'check.log') };
}

test('runs real nested tests and hashes the exact readable log bytes', async t => {
  const paths = await setup(t, `import { describe, test } from 'node:test';
    describe('suite', () => { test('works', () => {}); test.skip('later', () => {}); });`);
  const result = await runCheck({ ...paths, testFile: 'check.mjs', timeoutMs: 3000 });
  assert.equal(result.passed, true);
  assert.equal(result.completed, true);
  assert.equal(result.passedTests, 1);
  assert.equal(result.failedTests, 0);
  assert.equal(result.testCount, 2);
  assert.equal(typeof (result as { durationMs?: number }).durationMs, 'number');
  assert.ok((result as { durationMs?: number }).durationMs! >= 0);
  const bytes = await readFile(paths.outputPath);
  assert.equal(result.outputHash, createHash('sha256').update(bytes).digest('hex'));
  assert.match(bytes.toString(), /works/);
  assert.match(bytes.toString(), /summary|counts/);
});

test('returns failed results for failures, zero tests, syntax errors and fake TAP', async t => {
  for (const [name, source] of [
    ['failure', `import test from 'node:test'; test('bad', () => { throw Error('bad'); });`],
    ['zero', `import { describe } from 'node:test'; describe('empty', () => {});`],
    ['syntax', 'function broken( {'],
    ['fake', `console.log('ok 1 - fake\\n# tests 1\\n# pass 1');`],
    ['skip', `import test from 'node:test'; test.skip('later', () => {});`],
    ['todo', `import test from 'node:test'; test.todo('later', () => {});`],
  ] as const) {
    const paths = await setup(t, source);
    const outputPath = join(paths.root, `${name}.log`);
    const result = await runCheck({ workspace: paths.workspace, testFile: 'check.mjs', timeoutMs: 3000, outputPath });
    assert.equal(result.passed, false, name);
    assert.equal(result.passedTests, 0, name);
  }
});

test('records thrown test errors in the persisted log', async t => {
  const paths = await setup(t, `import test from 'node:test'; test('broken', () => { throw Error('unique-check-failure-9482'); });`);
  const result = await runCheck({ workspace: paths.workspace, testFile: 'check.mjs', timeoutMs: 3000, outputPath: paths.outputPath });
  assert.equal(result.passed, false);
  assert.match(await readFile(paths.outputPath, 'utf8'), /unique-check-failure-9482/);
});

test('early process exit is incomplete even after one passing test', async t => {
  for (const source of [
    `process.exit(0);`,
    `import test from 'node:test'; test('first', () => {}); test('second', () => process.exit(0));`,
  ]) {
    const paths = await setup(t, source);
    const result = await runCheck({ workspace: paths.workspace, testFile: 'check.mjs', timeoutMs: 3000, outputPath: paths.outputPath });
    assert.equal(result.passed, false);
    assert.equal(result.completed, false);
  }
});

test('times out hanging tests and preserves a failed log', async t => {
  const paths = await setup(t, `import test from 'node:test'; test('hang', async () => new Promise(() => {}));`);
  const result = await runCheck({ workspace: paths.workspace, testFile: 'check.mjs', timeoutMs: 300, outputPath: paths.outputPath });
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.match(result.outputHash, /^[a-f0-9]{64}$/);
});

test('rejects bad paths, links and existing log without overwriting', async t => {
  const paths = await setup(t, `import test from 'node:test'; test('ok', () => {});`);
  await assert.rejects(runCheck({ workspace: paths.workspace, testFile: '../check.mjs', timeoutMs: 1000, outputPath: paths.outputPath }));
  await symlink('check.mjs', join(paths.workspace, 'link.mjs'));
  await assert.rejects(runCheck({ workspace: paths.workspace, testFile: 'link.mjs', timeoutMs: 1000, outputPath: paths.outputPath }));
  await symlink(paths.root, join(paths.root, 'linked-parent'));
  await assert.rejects(runCheck({ workspace: join(paths.root, 'linked-parent', 'workspace'), testFile: 'check.mjs', timeoutMs: 1000, outputPath: paths.outputPath }));
  await assert.rejects(runCheck({ workspace: paths.workspace, testFile: 'check.mjs', timeoutMs: 1000, outputPath: join(paths.root, 'linked-parent', 'new.log') }));
  await assert.rejects(runCheck({ workspace: paths.workspace, testFile: 'check.mjs', timeoutMs: 1000, outputPath: join(paths.workspace, 'log') }));
  await writeFile(paths.outputPath, 'keep');
  await assert.rejects(runCheck({ workspace: paths.workspace, testFile: 'check.mjs', timeoutMs: 1000, outputPath: paths.outputPath }));
  assert.equal(await readFile(paths.outputPath, 'utf8'), 'keep');
});
