import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { runEvaluation } from '../eval/runner.js';
import { smokeConfig } from '../eval/smoke.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import { writeRunReport } from '../eval/finalize.js';

const exec = promisify(execFile);
const loader = import.meta.resolve('tsx');

test('E05 incomplete journal keeps diagnostics and has no success-rate report', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-incomplete-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.resolve('tests/fixtures/eval-smoke'), path.join(root, 'tasks/eval-smoke'), { recursive: true });
  await assert.rejects(runEvaluation({ ...smokeConfig(path.join(root, 'runs')), repeats: 1 }, {
    projectRoot: root, smokeTaskRoot: path.join(root, 'tasks'), modelPlugin: options => {
      const plugin = mockModelPlugin({ ...options, script: [{ content: 'done', calls: [], finish: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'fixture', fingerprint: null }] });
      return { ...plugin, setup(ctx) {
        const persistence = ctx.get('persistence');
        const append = persistence.append.bind(persistence);
        persistence.append = async event => {
          if (event.type === 'run_end') throw new Error('PRIVATE-DIAGNOSTIC');
          await append(event);
        };
        return plugin.setup(ctx);
      } };
    },
  }));
  const runRoot = path.join(root, 'runs', (await readdir(path.join(root, 'runs')))[0]!);
  const files = await readdir(runRoot);
  assert.ok(files.includes('diagnostic.json'));
  assert.ok(files.includes('diagnostic.md'));
  assert.ok(!files.includes('summary.json') && !files.includes('report.md'));
  const diagnostic = await readFile(path.join(runRoot, 'diagnostic.md'), 'utf8');
  assert.doesNotMatch(diagnostic, /PRIVATE-DIAGNOSTIC|Success.*Rate/i);
  assert.ok((await readFile(path.join(runRoot, 'attempts/eval-smoke-baseline-1/result.json'), 'utf8')).includes('io_error'));
});

test('eval preflight and verify command entries are offline and reject altered summaries', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-entries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env }; delete env.HARNESS_API_KEY;
  const preflight = await exec(process.execPath, ['--import', loader, path.resolve('eval/preflight-cli.ts'),
    '--task', path.resolve('tests/fixtures/eval-smoke'), '--output', path.join(root, 'preflight')], { env, timeout: 15000 });
  assert.equal(JSON.parse(preflight.stdout).passed, true);
  const run = await exec(process.execPath, ['--import', loader, path.resolve('eval/smoke.ts'), '--output', path.join(root, 'runs')], { env, timeout: 15000 });
  const runRoot = JSON.parse(run.stdout).runRoot as string;
  const args = ['--import', loader, path.resolve('eval/verify-cli.ts'), '--run', runRoot];
  const checked = await exec(process.execPath, args, { env, timeout: 15000 });
  assert.deepEqual(JSON.parse(checked.stdout), { passed: true, errors: [] });
  await assert.rejects(writeRunReport(runRoot), /already exists/);
  assert.deepEqual(JSON.parse((await exec(process.execPath, args, { env, timeout: 15000 })).stdout), { passed: true, errors: [] });
  await writeFile(path.join(runRoot, 'summary.json'), '{}');
  await assert.rejects(exec(process.execPath, args, { env, timeout: 15000 }), (error: unknown) => {
    const failure = error as { code: number; stdout: string };
    assert.equal(failure.code, 1);
    assert.equal(JSON.parse(failure.stdout).passed, false);
    return true;
  });
  assert.equal(await readFile(path.join(runRoot, 'summary.json'), 'utf8'), '{}');
});

test('report finalization rejects symlink parents without writing diagnostics through them', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'report-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'target');
  await mkdir(target);
  await symlink(target, path.join(root, 'alias'));
  await assert.rejects(writeRunReport(path.join(root, 'alias')));
  assert.deepEqual(await readdir(target), []);
});
