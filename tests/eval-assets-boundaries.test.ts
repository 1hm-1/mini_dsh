import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { loadTask, loadTasks, materialize } from '../eval/assets.js';
import { checkIntegrity, diffSnapshots, snapshotWorkspace } from '../eval/workspace.js';
import { createRuntime } from '../src/runtime.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import type { ModelResponse } from '../src/types.js';

const execFileAsync = promisify(execFile);
const source = path.resolve('tests/fixtures/eval-smoke');
const response = (calls: ModelResponse['calls'] = []): ModelResponse => ({ content: calls.length ? '' : 'fixed', calls,
  finish: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 2, outputTokens: 1 }, actualModel: 'offline', fingerprint: null });
async function temporary(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-assets-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function copyTask(t: TestContext) {
  const root = await temporary(t);
  const taskRoot = path.join(root, 'eval-smoke');
  await cp(source, taskRoot, { recursive: true });
  return { root, taskRoot };
}

test('E01/E02 smoke materialization isolates attempts and keeps hidden canaries out of every model request', async t => {
  const root = await temporary(t);
  const [task] = await loadTasks(path.dirname(source), ['eval-smoke']);
  assert.ok(task);
  const a = await materialize(task, path.join(root, 'attempt-a'));
  const b = await materialize(task, path.join(root, 'attempt-b'));
  assert.deepEqual(a.before, b.before);
  const serializedRequests: string[] = [];
  const runtime = await createRuntime({
    schemaVersion: 1, variant: 'baseline',
    model: { endpoint: 'http://127.0.0.1:1/chat', id: 'offline', temperature: 0 },
    budget: { maxModelRequests: 5, maxToolCalls: 4, timeoutMs: 5000, maxOutputTokens: 128, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace: a.workspace, writable: task.spec.writable, sessionPath: path.join(root, 'journal.jsonl'),
  }, { modelPlugin: options => mockModelPlugin({ ...options, script: [
    request => { serializedRequests.push(JSON.stringify(request)); return response([{ id: 'list', name: 'list_files', arguments: '{}' }]); },
    request => { serializedRequests.push(JSON.stringify(request)); return response([{ id: 'read', name: 'read_file', arguments: '{"path":"sum.mjs"}' }]); },
    request => { serializedRequests.push(JSON.stringify(request)); return response([{ id: 'edit', name: 'edit_file', arguments: '{"path":"sum.mjs","oldText":"a - b","newText":"a + b"}' }]); },
    request => { serializedRequests.push(JSON.stringify(request)); return response(); },
  ] }) });
  const result = await runtime.run(task.prompt);
  assert.equal(result.termination, 'completed');
  assert.equal(result.toolErrors, 0);
  assert.equal(result.toolCalls, 3);
  assert.equal(serializedRequests.length, 4);
  assert.doesNotMatch(serializedRequests.join('\n'), /HIDDEN_ACCEPTANCE_CANARY_M4_1|REFERENCE_CANARY_M4_1|acceptance\/|reference\//);
  assert.deepEqual(a.before.entries.map(entry => entry.path), ['public.test.mjs', 'sum.mjs']);
  const after = await snapshotWorkspace(a.workspace);
  assert.deepEqual(checkIntegrity(a.before, after, task.spec.writable), { passed: true, changedPaths: ['sum.mjs'], violations: [] });
  const changes = diffSnapshots(a.before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.kind, 'modified');
  assert.deepEqual(await snapshotWorkspace(b.workspace), b.before);
  assert.deepEqual(await snapshotWorkspace(path.join(source, 'workspace')), a.before);
  await execFileAsync(process.execPath, ['--test', 'public.test.mjs'], { cwd: a.workspace });
});

test('E07 task hash includes hidden and extra asset bytes while ignoring absolute package location', async t => {
  const f = await copyTask(t);
  const original = await loadTask(source);
  const copied = await loadTask(f.taskRoot);
  assert.equal(copied.taskHash, original.taskHash);
  for (const relative of ['prompt.md', 'workspace/public.test.mjs', 'acceptance/acceptance.test.mjs', 'reference/patch.diff', 'task.json']) {
    const file = path.join(f.taskRoot, relative);
    const bytes = await readFile(file);
    await writeFile(file, Buffer.concat([bytes, Buffer.from('\n')]));
    assert.notEqual((await loadTask(f.taskRoot)).taskHash, original.taskHash, relative);
    await writeFile(file, bytes);
  }
  await writeFile(path.join(f.taskRoot, 'extra.txt'), 'additional asset');
  assert.notEqual((await loadTask(f.taskRoot)).taskHash, original.taskHash);
  await assert.rejects(materialize(copied, path.join(f.root, 'changed-source')));
  await assert.rejects(readFile(path.join(f.root, 'changed-source', 'sum.mjs')), { code: 'ENOENT' });
});

test('E02 loader rejects hidden assets mapped into workspace and every symlink in a task package', async t => {
  const f = await copyTask(t);
  const file = path.join(f.taskRoot, 'task.json');
  const original = await readFile(file, 'utf8');
  const spec = JSON.parse(original) as Record<string, unknown>;
  await writeFile(file, JSON.stringify({ ...spec, acceptanceTest: 'workspace/public.test.mjs' }));
  await assert.rejects(loadTask(f.taskRoot));
  await writeFile(file, original);
  const outside = path.join(f.root, 'outside.txt');
  await writeFile(outside, 'OUTSIDE_CANARY');
  await symlink(outside, path.join(f.taskRoot, 'unreferenced-link'));
  await assert.rejects(loadTask(f.taskRoot));
  assert.equal(await readFile(outside, 'utf8'), 'OUTSIDE_CANARY');
});

test('E01 materialization refuses existing targets and source descendants without modifying them', async t => {
  const f = await copyTask(t);
  const task = await loadTask(f.taskRoot);
  const existing = path.join(f.root, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'sentinel'), 'keep');
  await assert.rejects(materialize(task, existing));
  assert.equal(await readFile(path.join(existing, 'sentinel'), 'utf8'), 'keep');
  await assert.rejects(materialize(task, path.join(f.taskRoot, 'nested')));
  assert.equal((await loadTask(f.taskRoot)).taskHash, task.taskHash);
  await symlink(existing, path.join(f.root, 'alias'));
  await assert.rejects(materialize(task, path.join(f.root, 'alias', 'new')));
  assert.equal(await readFile(path.join(existing, 'sentinel'), 'utf8'), 'keep');
});

test('E07 materialization rejects forged loaded metadata even when its taskHash is unchanged', async t => {
  const root = await temporary(t);
  const task = await loadTask(source);
  const forged = structuredClone(task);
  forged.spec.writable.push('public.test.mjs');
  forged.prompt = 'changed task';
  await assert.rejects(materialize(forged, path.join(root, 'forged')));
});

test('E03 snapshots retain invalid filesystem evidence without following symlink targets', async t => {
  const root = await temporary(t);
  const task = await loadTask(source);
  const attempt = await materialize(task, path.join(root, 'attempt'));
  const outside = path.join(root, 'outside.txt');
  await writeFile(outside, 'DO_NOT_COPY_THIS_TARGET');
  await rm(path.join(attempt.workspace, 'sum.mjs'));
  await symlink(outside, path.join(attempt.workspace, 'sum.mjs'));
  await writeFile(path.join(attempt.workspace, 'public.test.mjs'), 'changed protected test');
  const after = await snapshotWorkspace(attempt.workspace);
  const integrity = checkIntegrity(attempt.before, after, task.spec.writable);
  assert.equal(integrity.passed, false);
  assert.deepEqual(integrity.changedPaths, ['public.test.mjs', 'sum.mjs']);
  assert.ok(integrity.violations.some(message => message.includes('public.test.mjs')));
  assert.ok(integrity.violations.some(message => message.includes('sum.mjs')));
  assert.doesNotMatch(JSON.stringify(after), /DO_NOT_COPY_THIS_TARGET/);
  assert.equal(after.entries.find(entry => entry.path === 'sum.mjs')?.kind, 'symlink');
});
