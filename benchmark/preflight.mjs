// Offline authoring check; never invokes a model or rewrites the frozen manifest.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTask } from '../eval/assets.ts';
import { preflight } from '../eval/preflight.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2];
assert.equal(process.argv.length, 3, 'Usage: node --import tsx benchmark/preflight.mjs <new-output-directory>');
assert.ok(output);
const destination = resolve(output);
const manifest = JSON.parse(await readFile(join(root, 'benchmark/v1.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.benchmarkVersion, 'v1');
assert.equal(manifest.tasks.length, 12);
assert.equal(new Set(manifest.tasks.map(task => task.id)).size, 12);
assert.equal(manifest.tasks.filter(task => task.suite === 'S').length, 8);
assert.equal(manifest.tasks.filter(task => task.suite === 'H').length, 4);
// Resolve and check everything before creating output (including overlap).
const tasks = [];
for (const entry of manifest.tasks) {
  const task = await loadTask(join(root, entry.path));
  assert.equal(task.spec.id, entry.id);
  assert.equal(task.spec.suite, entry.suite);
  assert.equal(task.taskHash, entry.taskHash);
  const offset = relative(task.root, destination);
  assert.ok(offset === '..' || offset.startsWith('../'), 'output must be outside task packages');
  tasks.push(task);
}
await mkdir(dirname(destination), { recursive: true });
await mkdir(destination); // A second run must use a new output path.
const index = { schemaVersion: 1, kind: 'offline-preflight', provider: null, tasks: [] };
for (const task of tasks) {
  const result = await preflight(task, join(destination, task.spec.id));
  const workspaceFiles = task.assets.entries.filter(entry => entry.kind === 'file'
    && entry.path.startsWith(`${task.spec.workspaceDir}/`)).length;
  const artifacts = [];
  for (const name of ['preflight.json', 'initial/public-output.txt', 'initial/acceptance-output.txt',
    'reference/public-output.txt', 'reference/acceptance-output.txt']) {
    const bytes = await readFile(join(destination, task.spec.id, name));
    artifacts.push({ path: `${task.spec.id}/${name}`, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  index.tasks.push({ id: task.spec.id, suite: task.spec.suite, taskHash: task.taskHash,
    workspaceFiles, writableFiles: task.spec.writable.length, passed: result.passed,
    publicTests: result.reference?.publicTest.testCount,
    acceptanceTests: result.reference?.acceptanceTest.testCount, artifacts });
  // Save completed entries even if a later task fails.
  await writeFile(join(destination, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  assert.equal(result.passed, true, `${task.spec.id}: ${result.error}`);
  assert.ok(result.initial.acceptanceTest.failedTests > 0);
  assert.ok(result.reference.publicTest.testCount >= (task.spec.suite === 'S' ? 2 : 3));
  assert.ok(result.reference.acceptanceTest.testCount >= (task.spec.suite === 'S' ? 4 : 6));
  assert.ok(workspaceFiles >= (task.spec.suite === 'S' ? 1 : 8));
  assert.ok(workspaceFiles <= (task.spec.suite === 'S' ? 5 : 20));
  assert.ok(task.spec.writable.length >= 1 && task.spec.writable.length <= (task.spec.suite === 'S' ? 3 : 5));
  process.stdout.write(`${task.spec.id}: PASS (${workspaceFiles} files; ${result.reference.publicTest.testCount}/${result.reference.acceptanceTest.testCount} tests)\n`);
}
process.stdout.write(`Evidence: ${destination}\n`);
