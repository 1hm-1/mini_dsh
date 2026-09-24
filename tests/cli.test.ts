import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { readJournal } from '../src/journal.js';

const cli = path.resolve('src/cli.ts');
const tsx = import.meta.resolve('tsx');
const key = 'test-only-secret';
type ChildResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'mini-cli-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'math.mjs'), 'export const add = (a, b) => a - b;\n');
  await writeFile(path.join(root, 'math.test.mjs'), "import { strict as assert } from 'node:assert';\nimport { add } from './workspace/math.mjs';\nassert.equal(add(2, 3), 5);\n");
  const config = {
    schemaVersion: 1, variant: 'baseline', model: { endpoint: 'http://127.0.0.1:1/', id: 'fixture', temperature: 0 },
    budget: { maxModelRequests: 4, maxToolCalls: 4, timeoutMs: 10000, maxOutputTokens: 256, maxInputChars: 128000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace: 'workspace', writable: ['math.mjs'], sessionPath: 'session.jsonl',
  };
  const configPath = path.join(root, 'config.json');
  async function save() { await writeFile(configPath, JSON.stringify(config)); }
  await save();
  return { root, workspace, config, configPath, save, journal: path.join(root, 'session.jsonl') };
}

function run(args: string[], options: { cwd?: string; key?: string; onSpawn?: (child: ReturnType<typeof spawn>) => void } = {}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsx, cli, ...args], {
      cwd: options.cwd ?? process.cwd(), env: { ...process.env, HARNESS_API_KEY: options.key ?? key }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 15000);
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('CLI child exceeded 15 seconds'));
      else resolve({ code, signal, stdout, stderr });
    });
    options.onSpawn?.(child);
  });
}

function reply(call: { id: string; name: string; arguments: string } | null) {
  return { model: 'fixture', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{
    finish_reason: call ? 'tool_calls' : 'stop', message: call
      ? { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }
      : { role: 'assistant', content: 'fixed' },
  }] };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
}

test('A02 CLI runs read/edit/final over local HTTP, leaves valid JSONL and passes external check', async t => {
  const f = await fixture(t);
  let requests = 0;
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => { chunks.push(Buffer.from(chunk)); });
    req.on('end', () => {
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
    const calls = [
      { id: 'read', name: 'read_file', arguments: JSON.stringify({ path: 'math.mjs' }) },
      { id: 'edit', name: 'edit_file', arguments: JSON.stringify({ path: 'math.mjs', oldText: 'a - b', newText: 'a + b' }) },
      null,
    ];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(reply(calls[requests++] ?? null)));
    });
  });
  try {
    f.config.model.endpoint = `http://127.0.0.1:${await listen(server)}/chat`;
    await f.save();
    const result = await run(['--config', f.configPath, '--input', 'Fix add'], { cwd: f.root });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.equal(JSON.parse(result.stdout).termination, 'completed');
    assert.equal(requests, 3);
    const second = bodies[1] as { messages: Array<{ role: string; tool_call_id?: string }> };
    const third = bodies[2] as { messages: Array<{ role: string; tool_call_id?: string }> };
    assert(second.messages.some(message => message.role === 'tool' && message.tool_call_id === 'read'));
    assert(third.messages.some(message => message.role === 'tool' && message.tool_call_id === 'edit'));
    assert.match(await readFile(path.join(f.workspace, 'math.mjs'), 'utf8'), /a \+ b/);
    const external = await runExternalTest(f.root);
    assert.equal(external, 0);
    assert.equal((await readJournal(f.journal)).status, 'complete');
    assert.doesNotMatch(await readFile(f.journal, 'utf8'), new RegExp(key));
  } finally { await closeServer(server); }
});

async function runExternalTest(cwd: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['math.test.mjs'], { cwd, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('external check exceeded 5 seconds')); }, 5000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code); });
  });
}

test('A02 rejects invalid args, placeholder, unsupported variant and missing key without leaking values', async t => {
  const f = await fixture(t);
  const badArgs = [[], ['--bad'], ['--config'], ['--help', '--config', f.configPath],
    ['--config', f.configPath, '--config', f.configPath, '--input', 'x'],
    ['--config', f.configPath, '--input', ' '],
    ['--config', f.configPath, '--input', 'x', '--input-file', 'x']];
  for (const args of badArgs) {
    const result = await run(args, { cwd: f.root });
    assert.equal(result.code, 1, args.join(' '));
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /test-only-secret|Fix add|stack| at /);
  }
  assert.equal((await run(['--help'])).code, 0);
  f.config.model.id = 'TEMPLATE_REQUIRED'; await f.save();
  assert.equal((await run(['--config', f.configPath, '--input', 'secret task'], { cwd: f.root })).code, 1);
  f.config.model.id = 'fixture'; f.config.variant = 'full'; await f.save();
  const unsupported = await run(['--config', f.configPath, '--input', 'secret task'], { cwd: f.root });
  assert.equal(unsupported.code, 1);
  assert.match(unsupported.stderr, /not implemented/);
  assert.doesNotMatch(unsupported.stderr, /secret task/);
  f.config.variant = 'private-invalid-variant'; await f.save();
  const unknown = await run(['--config', f.configPath, '--input', 'secret task'], { cwd: f.root });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /configuration/);
  assert.doesNotMatch(unknown.stderr, /private-invalid-variant|secret task/);
  f.config.variant = 'baseline'; await f.save();
  const noKey = await run(['--config', f.configPath, '--input', 'secret task'], { cwd: f.root, key: '' });
  assert.equal(noKey.code, 1);
  assert.match(noKey.stderr, /HARNESS_API_KEY is required/);
  f.config.workspace = ''; f.config.sessionPath = f.journal; await f.save();
  const emptyWorkspace = await run(['--config', f.configPath, '--input', 'secret task'], { cwd: f.workspace });
  assert.equal(emptyWorkspace.code, 1);
  assert.equal(emptyWorkspace.stdout, '');
  assert.doesNotMatch(emptyWorkspace.stderr, /secret task/);
  await assert.rejects(readFile(f.journal, 'utf8'), { code: 'ENOENT' });
});

test('A02 request budget exits 2 with complete journal', async t => {
  const f = await fixture(t);
  const server = createServer((_req, res) => res.end(JSON.stringify(reply({ id: 'read', name: 'read_file', arguments: '{"path":"math.mjs"}' }))));
  try {
    f.config.model.endpoint = `http://127.0.0.1:${await listen(server)}/`;
    f.config.budget.maxModelRequests = 1; await f.save();
    const result = await run(['--config', f.configPath, '--input', 'read then finish'], { cwd: f.root });
    assert.equal(result.code, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).termination, 'request_limit');
    assert.equal((await readJournal(f.journal)).status, 'complete');
  } finally { await closeServer(server); }
});

test('A02 input-file works and existing journal is never overwritten', async t => {
  const f = await fixture(t);
  const taskFile = path.join(f.root, 'task.txt');
  await writeFile(taskFile, 'Read the file and answer.');
  const server = createServer((_req, res) => res.end(JSON.stringify(reply(null))));
  try {
    f.config.model.endpoint = `http://127.0.0.1:${await listen(server)}/`;
    await f.save();
    const first = await run(['--config', 'config.json', '--input-file', 'task.txt'], { cwd: f.root });
    assert.equal(first.code, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).termination, 'completed');
    const original = await readFile(f.journal, 'utf8');
    const second = await run(['--config', 'config.json', '--input', 'again'], { cwd: f.root });
    assert.equal(second.code, 1);
    assert.equal(second.stdout, '');
    assert.equal(await readFile(f.journal, 'utf8'), original);
  } finally { await closeServer(server); }
});

test('A02 SIGINT cancels hanging HTTP, closes resources and leaves complete journal', async t => {
  const f = await fixture(t);
  let seen!: () => void;
  const received = new Promise<void>(resolve => { seen = resolve; });
  const server = createServer((_req, _res) => { seen(); });
  try {
    f.config.model.endpoint = `http://127.0.0.1:${await listen(server)}/`;
    await f.save();
    let child!: ReturnType<typeof spawn>;
    const pending = run(['--config', f.configPath, '--input', 'secret task'], { cwd: f.root, onSpawn: value => { child = value; } });
    await Promise.race([received, pending.then(() => { throw new Error('CLI child exited before HTTP request'); })]);
    child.kill('SIGINT');
    const result = await pending;
    assert.equal(result.code, 130, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(JSON.parse(result.stdout).termination, 'cancelled');
    assert.equal((await readJournal(f.journal)).status, 'complete');
    assert.doesNotMatch(result.stderr + result.stdout + await readFile(f.journal, 'utf8'), /test-only-secret/);
  } finally { await closeServer(server); }
});
