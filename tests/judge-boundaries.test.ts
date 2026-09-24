import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { runCheck } from '../eval/check.js';
import { grade } from '../eval/judge.js';
import { loadTask, materialize } from '../eval/assets.js';
import { checkIntegrity, snapshotWorkspace } from '../eval/workspace.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'judge-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  return { root, workspace, outputPath: path.join(root, 'output.txt') };
}

test('E04 cancelled unresolved tests are not valid completed checks', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.workspace, 'test.mjs'), "import test from 'node:test'; test('unresolved', async () => new Promise(() => {}));\n");
  const result = await runCheck({ ...f, testFile: 'test.mjs', timeoutMs: 2000 });
  assert.equal(result.passed, false);
  assert.equal(result.completed, false);
});

test('E04 printed JSON/TAP cannot manufacture completed tests, and checker does not inherit API credentials', async t => {
  const f = await fixture(t);
  const previous = process.env.HARNESS_API_KEY;
  process.env.HARNESS_API_KEY = 'boundary-secret-canary';
  try {
    await writeFile(path.join(f.workspace, 'test.mjs'), `console.log('TAP version 13\\n1..1\\nok 1 - fake');
console.log(JSON.stringify({kind:'summary',summary:{success:true,counts:{tests:1,passed:1,failed:0,cancelled:0,skipped:0,todo:0}}}));
if (process.env.HARNESS_API_KEY) console.log(process.env.HARNESS_API_KEY);
`);
    const result = await runCheck({ ...f, testFile: 'test.mjs', timeoutMs: 2000 });
    assert.equal(result.passed, false);
    assert.equal(result.passedTests, 0);
    const log = await readFile(f.outputPath);
    assert.doesNotMatch(log.toString('utf8'), /boundary-secret-canary/);
    assert.equal(result.outputHash, createHash('sha256').update(log).digest('hex'));
  } finally {
    if (previous === undefined) delete process.env.HARNESS_API_KEY;
    else process.env.HARNESS_API_KEY = previous;
  }
});

test('E04 timeout kills the check process group before a descendant can write late output', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const marker = path.join(f.root, 'late.txt');
  const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)},'late'),1000)`;
  await writeFile(path.join(f.workspace, 'test.mjs'), `import {spawn} from 'node:child_process';
spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});
setInterval(()=>{},1000);
`);
  const result = await runCheck({ ...f, testFile: 'test.mjs', timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  assert.equal(result.passed, false);
  await new Promise(resolve => setTimeout(resolve, 1100));
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('E03 integrity diagnostics preserve evidence while overwritten public tests never enter check copies', async t => {
  const f = await fixture(t);
  const task = await loadTask(path.resolve('tests/fixtures/eval-smoke'));
  const candidate = await materialize(task, path.join(f.root, 'candidate'));
  await writeFile(path.join(candidate.workspace, 'sum.mjs'), 'export const sum = (a, b) => a + b;\n');
  await writeFile(path.join(candidate.workspace, 'public.test.mjs'), 'process.exit(0);');
  const after = await snapshotWorkspace(candidate.workspace);
  const beforeBytes = JSON.stringify(after);
  const outputDir = path.join(f.root, 'grade');
  const result = await grade({ task, before: candidate.before, after, termination: 'completed', outputDir });
  assert.deepEqual(result.integrity, checkIntegrity(candidate.before, after, task.spec.writable));
  assert.equal(result.functionalPass, true);
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, 'integrity');
  assert.equal(JSON.stringify(await snapshotWorkspace(candidate.workspace)), beforeBytes);
  assert.equal(JSON.stringify(after), beforeBytes);
  assert.ok(result.publicTest.passedTests > 0);
  const saved = await readFile(result.publicTest.outputPath);
  assert.equal(createHash('sha256').update(saved).digest('hex'), result.publicTest.outputHash);
});
