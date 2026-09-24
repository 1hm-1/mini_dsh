import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { parseEvalArguments, applyEvalOverrides } from '../eval/cli.js';
import { smokeConfig } from '../eval/smoke.js';

const exec = promisify(execFile);
const loader = import.meta.resolve('tsx');
const cli = path.resolve('eval/cli.ts');
const smoke = path.resolve('eval/smoke.ts');

test('eval arguments merge task, variant and repeat overrides before strict validation', () => {
  const args = parseEvalArguments(['--config', 'experiment.json', '--tasks', 'eval-smoke', '--variants', 'baseline', '--repeats', '3']);
  assert.ok(args);
  assert.equal(args.config, 'experiment.json');
  const input = smokeConfig('runs');
  const parsed = applyEvalOverrides(input, args);
  assert.deepEqual(parsed.taskIds, ['eval-smoke']);
  assert.deepEqual(parsed.variants, ['baseline']);
  assert.equal(parsed.repeats, 3);
  assert.equal(input.repeats, 2);
  assert.deepEqual(applyEvalOverrides(input, { config: 'x', variants: ['context'] }).variants, ['context']);
  assert.deepEqual(applyEvalOverrides(input, { config: 'x', variants: ['optimizer', 'full'] }).variants, ['optimizer', 'full']);
  assert.throws(() => applyEvalOverrides({ ...input, unknown: true }, args));
  assert.throws(() => applyEvalOverrides({ ...input, phase: 'baseline-diagnostic', benchmarkManifest: 'benchmark/v1.json' },
    { config: 'x', variants: ['full'] }));
});

test('eval arguments reject ambiguous, duplicated and invalid options', () => {
  assert.equal(parseEvalArguments(['--help']), null);
  for (const argv of [[], ['--config'], ['--config', 'x', '--unknown', 'x'], ['--config', 'x', '--config', 'y'],
    ['--config', 'x', '--repeats', '1.5'], ['--config', 'x', '--repeats', '0'],
    ['--config', 'x', '--tasks', 'eval-smoke,'], ['--config', 'x', '--variants', 'baseline,baseline']]) {
    assert.throws(() => parseEvalArguments(argv), JSON.stringify(argv));
  }
});

test('eval CLI help and safe rejection need no key or output artifacts', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const help = await exec(process.execPath, ['--import', loader, cli, '--help'], { cwd: root, timeout: 10000 });
  assert.match(help.stdout, /--tasks.*--variants.*--repeats/s);
  const config = path.join(root, 'config.json');
  await writeFile(config, JSON.stringify({ ...smokeConfig(path.join(root, 'runs')), secret: 'SENSITIVE-CANARY' }));
  await assert.rejects(exec(process.execPath, ['--import', loader, cli, '--config', config], { cwd: root, timeout: 10000 }),
    (error: unknown) => {
      const result = error as { code: number; stderr: string };
      assert.equal(result.code, 1);
      assert.doesNotMatch(result.stderr, /SENSITIVE-CANARY/);
      return true;
    });
  await assert.rejects(readFile(path.join(root, 'runs', 'manifest.json')), /ENOENT/);
});

test('eval smoke CLI runs independent offline attempts and persists actual config', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-smoke-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'runs');
  const env = { ...process.env };
  delete env.HARNESS_API_KEY;
  const result = await exec(process.execPath, ['--import', loader, smoke, '--output', output], { cwd: root, env, timeout: 30000 });
  const info = JSON.parse(result.stdout) as { runRoot: string; provider: string; attempts: number };
  assert.equal(info.provider, 'mock');
  assert.equal(info.attempts, 2);
  const manifest = JSON.parse(await readFile(path.join(info.runRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.phase, 'smoke');
  assert.equal(manifest.config.outputDir, output);
  assert.equal(manifest.provider, 'mock');
  assert.equal(manifest.schedule.length, 2);
  for (const repeat of [1, 2]) {
    const attempt = JSON.parse(await readFile(path.join(info.runRoot, 'attempts', `eval-smoke-baseline-${repeat}`, 'result.json'), 'utf8'));
    assert.equal(attempt.passed, true);
    assert.equal(attempt.agent.modelRequests, 3);
    assert.equal(attempt.agent.toolCalls, 2);
  }
});
