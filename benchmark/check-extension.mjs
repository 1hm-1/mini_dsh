// B02 engineering evidence only: two mock runs of a thirteenth fixture.
// This fixture is outside the frozen v1 manifest and is never a model score.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTask } from '../eval/assets.ts';
import { runEvaluation } from '../eval/runner.ts';
import { smokeConfig } from '../eval/smoke.ts';
import { verify } from '../eval/verify.ts';
import { mockModelPlugin } from '../src/plugins/mock-model.ts';

assert.equal(process.argv.length, 3, 'Usage: node --import tsx benchmark/check-extension.mjs <new-output-directory>');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2]);
assert.ok(!output.startsWith(join(root, 'benchmark/tasks') + '/'));
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const id = 'b13-extension';
const runs = [];
for (const revision of ['original', 'one-byte-change']) {
  const fixtures = join(output, revision, 'fixtures');
  const taskRoot = join(fixtures, id);
  await mkdir(fixtures, { recursive: true });
  await cp(join(root, 'benchmark/tasks/b01-normalize'), taskRoot, { recursive: true, errorOnExist: true });
  const spec = JSON.parse(await readFile(join(taskRoot, 'task.json'), 'utf8'));
  spec.id = id;
  await writeFile(join(taskRoot, 'task.json'), `${JSON.stringify(spec, null, 2)}\n`);
  if (revision === 'one-byte-change') {
    const prompt = await readFile(join(taskRoot, 'prompt.md'));
    await writeFile(join(taskRoot, 'prompt.md'), Buffer.concat([prompt, Buffer.from(' ')]));
  }
  const task = await loadTask(taskRoot);
  const response = (content, calls = []) => ({ content, calls,
    finish: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 3, outputTokens: 2 },
    actualModel: 'offline-smoke', fingerprint: null });
  const result = await runEvaluation({ ...smokeConfig(join(output, revision, 'runs')), taskIds: [id], repeats: 1 }, {
    projectRoot: root, smokeTaskRoot: fixtures,
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script: [
      response('', [{ id: 'read', name: 'read_file', arguments: JSON.stringify({ path: 'normalize.mjs' }) }]),
      response('', [{ id: 'edit', name: 'edit_file', arguments: JSON.stringify({ path: 'normalize.mjs',
        oldText: 'return value.trim().toLowerCase();', newText: "return value.trim().replace(/\\s+/gu, ' ').toLowerCase();" }) }]),
      response('Fixed whitespace normalization (scripted engineering check).'),
    ] }),
  });
  assert.equal(result.manifest.provider, 'mock');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].passed, true);
  const verified = await verify(result.runRoot);
  assert.equal(verified.passed, true, JSON.stringify(verified));
  const report = await readFile(join(result.runRoot, 'report.md'), 'utf8');
  assert.ok(report.includes(result.runId), 'report must identify its run');
  assert.equal(result.manifest.tasks[0].taskHash, task.taskHash);
  assert.equal(result.attempts[0].taskHash, task.taskHash);
  runs.push({ revision, taskId: id, taskHash: task.taskHash,
    runRoot: relative(output, result.runRoot), runId: result.runId, provider: 'mock', passed: true, verified: true });
}
assert.notEqual(runs[0].taskHash, runs[1].taskHash);
await writeFile(join(output, 'index.json'), `${JSON.stringify({ schemaVersion: 1, acceptance: 'B02',
  note: 'Engineering mock only. Not part of benchmark-v1 or real model results.', runs }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
