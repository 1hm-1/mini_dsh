import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { loadTask } from '../eval/assets.js';
import { loadEvaluationInputs } from '../eval/benchmark.js';
import { parseEvalConfig } from '../eval/task.js';

const execFile = promisify(execFileCallback);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const config = (taskIds = ['eval-smoke']) => parseEvalConfig({
  schemaVersion: 1, phase: 'baseline-diagnostic', benchmarkManifest: 'benchmark/v1.json',
  taskIds, variants: ['baseline'], repeats: 1,
  model: { endpoint: 'https://example.test/v1', id: 'test', temperature: 0 },
  budget: { maxModelRequests: 2, maxToolCalls: 2, timeoutMs: 1000, maxOutputTokens: 100, maxInputChars: 1000 },
  context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 }, outputDir: 'runs',
});
async function git(root: string, ...args: string[]) { return (await execFile('git', args, { cwd: root })).stdout.trim(); }
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'benchmark-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'test@example.test');
  await git(root, 'config', 'user.name', 'Test');
  await mkdir(join(root, 'tasks'));
  const taskRoot = join(root, 'tasks', 'eval-smoke');
  await cp(join(process.cwd(), 'tests/fixtures/eval-smoke'), taskRoot, { recursive: true });
  const task = await loadTask(taskRoot);
  await mkdir(join(root, 'benchmark'));
  const manifest = { schemaVersion: 1, benchmarkVersion: 'v1', tasks: [{ id: 'eval-smoke', suite: 'S', path: 'tasks/eval-smoke', taskHash: task.taskHash }] };
  const manifestPath = join(root, 'benchmark', 'v1.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'freeze');
  const freeze = await git(root, 'rev-parse', 'HEAD');
  return { root, taskRoot, manifest, manifestPath, freeze };
}

test('loads frozen inputs and retains the last manifest commit after implementation commits', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'implementation.txt'), 'later');
  await git(f.root, 'add', '.');
  await git(f.root, 'commit', '-qm', 'implementation');
  const loaded = await loadEvaluationInputs(config(), f.root);
  assert.deepEqual(loaded.tasks.map(task => task.spec.id), ['eval-smoke']);
  assert.equal(loaded.implementationCommit, await git(f.root, 'rev-parse', 'HEAD'));
  assert.equal(loaded.benchmarkCommit, f.freeze);
  assert.equal(loaded.benchmarkHash, sha(await readFile(f.manifestPath)));
  assert.equal(loaded.dirty, false);
});

test('rejects dirty tree and task-only commits after a new manifest freeze', async t => {
  const f = await fixture(t);
  await writeFile(join(f.taskRoot, 'prompt.md'), 'changed');
  await assert.rejects(loadEvaluationInputs(config(), f.root), /clean|dirty/i);
  const updated = await loadTask(f.taskRoot);
  f.manifest.tasks[0]!.taskHash = updated.taskHash;
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await git(f.root, 'add', '.');
  await git(f.root, 'commit', '-qm', 'new version');
  // A changed manifest establishes a new freeze commit; changing only a task does not.
  assert.equal((await loadEvaluationInputs(config(), f.root)).benchmarkCommit, await git(f.root, 'rev-parse', 'HEAD'));
  await writeFile(join(f.taskRoot, 'prompt.md'), 'changed again');
  await git(f.root, 'add', '.');
  await git(f.root, 'commit', '-qm', 'task only');
  await assert.rejects(loadEvaluationInputs(config(), f.root), /freeze|frozen|commit|task/i);
});

test('rejects forged manifest metadata and selected task outside manifest', async t => {
  const f = await fixture(t);
  for (const change of [
    { ...f.manifest, extra: true },
    { ...f.manifest, tasks: [{ ...f.manifest.tasks[0], suite: 'H' }] },
    { ...f.manifest, tasks: [{ ...f.manifest.tasks[0], taskHash: '0'.repeat(64) }] },
    { ...f.manifest, tasks: [{ ...f.manifest.tasks[0], path: '../outside' }] },
    { ...f.manifest, tasks: [f.manifest.tasks[0], f.manifest.tasks[0]] },
  ]) {
    await writeFile(f.manifestPath, JSON.stringify(change));
    await assert.rejects(loadEvaluationInputs(config(), f.root));
  }
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await git(f.root, 'restore', 'benchmark/v1.json');
  await assert.rejects(loadEvaluationInputs(config(['unknown']), f.root), /task|manifest/i);
});

test('rejects symlinked manifest path and empty directory missing from Git tree', async t => {
  const f = await fixture(t);
  await symlink('v1.json', join(f.root, 'benchmark', 'alias.json'));
  await assert.rejects(loadEvaluationInputs({ ...config(), benchmarkManifest: 'benchmark/alias.json' }, f.root), /symlink|real|ordinary/i);
  await rm(join(f.root, 'benchmark', 'alias.json'));
  await mkdir(join(f.taskRoot, 'empty'));
  f.manifest.tasks[0]!.taskHash = (await loadTask(f.taskRoot)).taskHash;
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await git(f.root, 'add', '.');
  await git(f.root, 'commit', '-qm', 'manifest with empty directory');
  await assert.rejects(loadEvaluationInputs(config(), f.root), /Git|tree|empty/i);
});

test('smoke without manifest uses explicit fixture root and marks unfrozen state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'benchmark-smoke-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskRoot = join(root, 'fixtures');
  await mkdir(taskRoot);
  await cp(join(process.cwd(), 'tests/fixtures/eval-smoke'), join(taskRoot, 'eval-smoke'), { recursive: true });
  const result = await loadEvaluationInputs({ ...config(), phase: 'smoke', benchmarkManifest: null }, root, taskRoot);
  assert.equal(result.tasks[0]?.spec.id, 'eval-smoke');
  assert.equal(result.implementationCommit, null);
  assert.equal(result.benchmarkCommit, null);
  assert.equal(result.benchmarkHash, null);
  assert.equal(result.dirty, true);
});

test('validates every manifest task even when only one task is selected', async t => {
  const f = await fixture(t);
  const secondRoot = join(f.root, 'tasks', 'second');
  await cp(f.taskRoot, secondRoot, { recursive: true });
  const secondSpec = JSON.parse(await readFile(join(secondRoot, 'task.json'), 'utf8')) as Record<string, unknown>;
  secondSpec.id = 'second';
  secondSpec.suite = 'H';
  await writeFile(join(secondRoot, 'task.json'), JSON.stringify(secondSpec));
  const second = await loadTask(secondRoot);
  f.manifest.tasks.push({ id: 'second', suite: 'H', path: 'tasks/second', taskHash: second.taskHash });
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await git(f.root, 'add', '.');
  await git(f.root, 'commit', '-qm', 'second frozen task');
  assert.deepEqual((await loadEvaluationInputs(config(), f.root)).tasks.map(task => task.spec.id), ['eval-smoke']);
  await assert.rejects(loadEvaluationInputs({ ...config(), outputDir: 'tasks/second/runs' }, f.root), /output|task/i);
  await writeFile(join(secondRoot, 'prompt.md'), 'tampered');
  await git(f.root, 'add', '.');
  await git(f.root, 'commit', '-qm', 'tamper unselected task');
  await assert.rejects(loadEvaluationInputs(config(), f.root), /task|frozen/i);
});

test('smoke records real Git commit and dirty state when a HEAD exists', async t => {
  const f = await fixture(t);
  const smoke = { ...config(), phase: 'smoke' as const, benchmarkManifest: null };
  const clean = await loadEvaluationInputs(smoke, f.root, join(f.root, 'tasks'));
  assert.equal(clean.implementationCommit, f.freeze);
  assert.equal(clean.dirty, false);
  assert.equal(clean.benchmarkCommit, null);
  await writeFile(join(f.root, 'untracked.txt'), 'change');
  const dirty = await loadEvaluationInputs(smoke, f.root, join(f.root, 'tasks'));
  assert.equal(dirty.implementationCommit, f.freeze);
  assert.equal(dirty.dirty, true);
});

test('copies and validates caller config before first await', async t => {
  const f = await fixture(t);
  const input = config();
  const pending = loadEvaluationInputs(input, f.root);
  input.taskIds[0] = 'unknown';
  input.taskIds.push('another');
  input.phase = 'smoke';
  input.benchmarkManifest = null;
  const result = await pending;
  assert.deepEqual(result.tasks.map(task => task.spec.id), ['eval-smoke']);
  assert.equal(result.benchmarkCommit, f.freeze);
  await assert.rejects(loadEvaluationInputs({ ...config(), taskIds: ['unknown'] }, f.root), /task|manifest/i);
});
