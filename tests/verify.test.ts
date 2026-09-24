import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runEvaluation } from '../eval/runner.js';
import { smokeConfig } from '../eval/smoke.js';
import { inspectRun, verify } from '../eval/verify.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';

test('E05 verify recomputes failed attempts and rejects missing, altered or escaped evidence', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tasks'));
  await cp(path.resolve('tests/fixtures/eval-smoke'), path.join(root, 'tasks/eval-smoke'), { recursive: true });
  const result = await runEvaluation(smokeConfig(path.join(root, 'runs')), {
    projectRoot: root, smokeTaskRoot: path.join(root, 'tasks'),
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script: [{ content: 'unchanged', calls: [], finish: 'stop',
      usage: { inputTokens: null, outputTokens: 2 }, actualModel: 'fixture', fingerprint: null }] }),
  });
  assert.deepEqual(await verify(result.runRoot), { passed: true, errors: [] });
  assert.equal((await inspectRun(result.runRoot)).attempts.length, 2);
  assert.equal(result.attempts[0]?.passed, false);
  const attempt = result.attempts[0]!;
  const attemptDir = path.dirname(attempt.artifactPaths.result!);
  const change = async (name: string, file: string, transform: (old: string) => string) => {
    await t.test(name, async () => {
      const old = await readFile(file, 'utf8');
      await writeFile(file, transform(old));
      try {
        const checked = await verify(result.runRoot);
        assert.equal(checked.passed, false);
        assert.ok(checked.errors.length > 0);
        assert.equal(await readFile(file, 'utf8'), transform(old), 'verify must be read-only');
      } finally { await writeFile(file, old); }
    });
  };
  await t.test('missing failed attempt', async () => {
    const saved = path.join(root, 'removed');
    await rename(attemptDir, saved);
    try { assert.equal((await verify(result.runRoot)).passed, false); }
    finally { await rename(saved, attemptDir); }
  });
  await change('alter summary', path.join(result.runRoot, 'summary.json'), old => JSON.stringify({ ...JSON.parse(old), altered: true }));
  await change('alter report', path.join(result.runRoot, 'report.md'), old => old + '\nFAKE SUCCESS\n');
  await change('snapshot bytes and hash disagree', attempt.artifactPaths.after!, old => {
    const value = JSON.parse(old); value.entries.find((entry: { kind: string }) => entry.kind === 'file').content += 'tamper'; return JSON.stringify(value);
  });
  await change('changes omitted', attempt.artifactPaths.changes!, () => '[{"fake":true}]');
  await change('test output changed', attempt.publicTest.outputPath, old => old + 'tamper');
  await change('journal missing run_end', attempt.artifactPaths.journal!, old => old.trimEnd().split('\n').slice(0, -1).join('\n') + '\n');
  await change('forged counters in result', attempt.artifactPaths.result!, old => {
    const value = JSON.parse(old); value.agent.modelRequests++; return JSON.stringify(value);
  });
  await change('mixed phase', attempt.artifactPaths.result!, old => {
    const value = JSON.parse(old); value.phase = 'ablation'; return JSON.stringify(value);
  });
  await change('escaped artifact pointer', attempt.artifactPaths.result!, old => {
    const value = JSON.parse(old); value.artifactPaths.journal = '/etc/passwd'; return JSON.stringify(value);
  });
  await change('task drift', path.join(root, 'tasks/eval-smoke/prompt.md'), old => old + 'changed');
  await change('invalid preflight', path.join(result.runRoot, 'preflight/eval-smoke/preflight.json'), old => {
    const value = JSON.parse(old); value.reference.passed = false; return JSON.stringify(value);
  });
  await t.test('symlink journal is rejected without reading its target', async () => {
    const journal = attempt.artifactPaths.journal!;
    const saved = path.join(root, 'journal-save');
    await rename(journal, saved);
    await symlink(saved, journal);
    try { assert.equal((await verify(result.runRoot)).passed, false); }
    finally { await rm(journal); await rename(saved, journal); }
  });
  assert.deepEqual(await verify(result.runRoot), { passed: true, errors: [] });
  assert.equal((await readdir(path.join(result.runRoot, 'attempts'))).length, 2);
});
