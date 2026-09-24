import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { loadTask } from '../eval/assets.js';
import { preflight } from '../eval/preflight.js';
const source = path.resolve('tests/fixtures/eval-smoke');
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskRoot = path.join(root, 'eval-smoke');
  await cp(source, taskRoot, { recursive: true });
  return { root, taskRoot, output: path.join(root, 'evidence') };
}

test('E04 smoke preflight requires actual initial failure and both reference checks passing', async t => {
  const f = await fixture(t);
  const task = await loadTask(f.taskRoot);
  const result = await preflight(task, f.output);
  assert.equal(result.passed, true);
  assert.equal(result.initial.acceptanceTest.completed, true);
  assert.ok(result.initial.acceptanceTest.failedTests > 0);
  assert.equal(result.reference?.passed, true);
  assert.equal(result.reference?.integrity.passed, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.output, 'preflight.json'), 'utf8')), result);
  assert.equal((await loadTask(f.taskRoot)).taskHash, task.taskHash);
  assert.deepEqual(await readdir(path.join(f.output, 'reference')), ['acceptance-output.txt', 'public-output.txt']);
  await assert.rejects(preflight(task, f.output));
});

test('E04 preflight rejects initially passing acceptance, bad reference and protected patch targets', async t => {
  for (const mode of ['initial-pass', 'bad-reference', 'protected-reference'] as const) {
    await t.test(mode, async sub => {
      const f = await fixture(sub);
      if (mode === 'initial-pass') await writeFile(path.join(f.taskRoot, 'workspace/sum.mjs'), 'export const sum = (a, b) => a + b;\n');
      else {
        const original = await readFile(path.join(f.taskRoot, 'reference/patch.diff'), 'utf8');
        await writeFile(path.join(f.taskRoot, 'reference/patch.diff'), mode === 'bad-reference'
          ? original.replace('a + b;', 'a * b;') : original.replaceAll('sum.mjs', 'public.test.mjs'));
      }
      const task = await loadTask(f.taskRoot);
      const result = await preflight(task, f.output);
      assert.equal(result.passed, false);
      assert.ok(result.error);
      assert.equal((await loadTask(f.taskRoot)).taskHash, task.taskHash);
      assert.equal(result.reference === null, mode !== 'bad-reference');
    });
  }
});

test('E04 empty, early exit, syntax and timeout are not valid initial failing tests', async t => {
  for (const [label, code] of [
    ['empty', ''], ['exit-zero', 'process.exit(0);'], ['syntax', 'this is invalid syntax @'],
    ['timeout', 'setInterval(() => {}, 1000);'],
  ]) {
    await t.test(label!, async sub => {
      const f = await fixture(sub);
      await writeFile(path.join(f.taskRoot, 'acceptance/acceptance.test.mjs'), code!);
      const specPath = path.join(f.taskRoot, 'task.json');
      const spec = JSON.parse(await readFile(specPath, 'utf8'));
      spec.testTimeoutMs = 800;
      await writeFile(specPath, JSON.stringify(spec));
      const result = await preflight(await loadTask(f.taskRoot), f.output);
      assert.equal(result.passed, false);
      assert.equal(result.reference, null);
      assert.equal(result.error, 'invalid_initial_acceptance');
    });
  }
});
