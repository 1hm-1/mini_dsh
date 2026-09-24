import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { loadTask } from '../eval/assets.js';
import { smokeConfig } from '../eval/smoke.js';

const exec = promisify(execFile);
const loader = import.meta.resolve('tsx');

test('E06/E07 eval CLI uses clean frozen Git and keeps HTTP failures in its completed matrix', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let requests = 0;
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', chunk => { body += chunk; });
    req.on('end', () => {
      bodies.push(body);
      requests++;
      if (requests === 1) { res.writeHead(429).end('LOCAL-FAKE-SECRET'); return; }
      const call = requests === 2
        ? { id: 'read', name: 'read_file', arguments: '{"path":"sum.mjs"}' }
        : requests === 3
          ? { id: 'edit', name: 'edit_file', arguments: '{"path":"sum.mjs","oldText":"a - b","newText":"a + b"}' }
          : null;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'local-fake', usage: { prompt_tokens: 10, completion_tokens: 5 },
        choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: call
          ? { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }
          : { role: 'assistant', content: 'fixed' } }] }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  // Run the copied implementation from its own clean temporary Git repository.
  for (const item of ['src', 'eval', 'specs', 'package.json']) {
    await cp(path.resolve(item), path.join(root, item), { recursive: true });
  }
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\nruns/\n');
  await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'));
  const taskRoot = path.join(root, 'benchmark/tasks/eval-smoke');
  await cp(path.resolve('tests/fixtures/eval-smoke'), taskRoot, { recursive: true });
  const task = await loadTask(taskRoot);
  await writeFile(path.join(root, 'benchmark/v1.json'), JSON.stringify({ schemaVersion: 1, benchmarkVersion: 'v1',
    tasks: [{ id: 'eval-smoke', suite: 'S', path: 'benchmark/tasks/eval-smoke', taskHash: task.taskHash }] }));
  const config = { ...smokeConfig('runs'), phase: 'baseline-diagnostic', benchmarkManifest: 'benchmark/v1.json', repeats: 1,
    model: { endpoint: `http://127.0.0.1:${address.port}/chat/completions`, id: 'local-fake', temperature: 0 } };
  await writeFile(path.join(root, 'config.json'), JSON.stringify(config));
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root })).stdout.trim();
  const commit = async (message: string) => {
    await git('add', '.');
    await git('-c', 'user.name=Offline Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  await git('init', '-q');
  const frozen = await commit('fixture-freeze');
  await writeFile(path.join(root, 'implementation-note.txt'), 'Later implementation version fixture.');
  const head = await commit('fixture-implementation');
  const env = { ...process.env, HARNESS_API_KEY: 'LOCAL-TEST-KEY' };
  const command = ['--import', loader, path.join(root, 'eval/cli.ts'), '--config', 'config.json',
    '--tasks', 'eval-smoke', '--variants', 'baseline', '--repeats', '2'];
  const completed = await exec(process.execPath, command, { cwd: root, env, timeout: 30000 });
  const info = JSON.parse(completed.stdout);
  assert.equal(info.attempts, 2);
  assert.equal(info.provider, 'http');
  assert.equal(requests, 4);
  assert.doesNotMatch(bodies.join('\n'), /CANARY|acceptance|reference/i);
  const manifest = JSON.parse(await readFile(path.join(info.runRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.config.repeats, 2);
  assert.equal(manifest.implementationCommit, head);
  assert.equal(manifest.benchmarkCommit, frozen);
  assert.equal(manifest.dirty, false);
  const first = JSON.parse(await readFile(path.join(info.runRoot, 'attempts/eval-smoke-baseline-1/result.json'), 'utf8'));
  const second = JSON.parse(await readFile(path.join(info.runRoot, 'attempts/eval-smoke-baseline-2/result.json'), 'utf8'));
  assert.equal(first.agent.termination, 'model_error');
  assert.equal(first.passed, false);
  assert.equal(second.passed, true);
  assert.doesNotMatch(await readFile(first.artifactPaths.journal, 'utf8'), /LOCAL-FAKE-SECRET|LOCAL-TEST-KEY/);
  assert.equal(await git('status', '--porcelain'), '');
  const runs = await readdir(path.join(root, 'runs'));
  // A dirty implementation must fail before another provider call or run directory.
  await mkdir(path.join(root, 'dirty'));
  await writeFile(path.join(root, 'dirty/file'), 'uncommitted');
  await assert.rejects(exec(process.execPath, command, { cwd: root, env, timeout: 10000 }),
    (error: unknown) => (error as { code: number }).code === 1);
  assert.equal(requests, 4);
  assert.deepEqual(await readdir(path.join(root, 'runs')), runs);
  // Historical verification must not require the old implementation to remain HEAD or clean.
  const verifyArgs = ['--import', loader, path.join(root, 'eval/verify-cli.ts'), '--run', info.runRoot];
  assert.equal(JSON.parse((await exec(process.execPath, verifyArgs, { cwd: root, env, timeout: 10000 })).stdout).passed, true);
  await commit('later-unrelated-implementation');
  assert.equal(JSON.parse((await exec(process.execPath, verifyArgs, { cwd: root, env, timeout: 10000 })).stdout).passed, true);
  const manifestPath = path.join(info.runRoot, 'manifest.json');
  const originalManifest = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, JSON.stringify({ ...manifest, benchmarkCommit: head }));
  await assert.rejects(exec(process.execPath, verifyArgs, { cwd: root, env, timeout: 10000 }),
    (error: unknown) => (error as { code: number }).code === 1);
  await writeFile(manifestPath, originalManifest);
  assert.equal(requests, 4, 'verification cannot call the provider');
});
