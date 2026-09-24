import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativePath } from '../src/validation.js';
import type { CheckResult } from './contracts.js';

const worker = fileURLToPath(new URL('./check-worker.mjs', import.meta.url));
type Options = { workspace: string; testFile: string; timeoutMs: number; outputPath: string };
type Summary = { success: boolean; counts: { tests: number; passed: number; failed: number; cancelled: number; skipped: number; todo: number } };

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function assertNoParentLinks(path: string, name: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`${name}: symlink forbidden`);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function parseSummary(line: string): Summary | null {
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== 'object' || !('kind' in value) || value.kind !== 'summary'
      || !('summary' in value) || value.summary === null || typeof value.summary !== 'object') return null;
    const summary = value.summary as Partial<Summary>;
    if (typeof summary.success !== 'boolean' || !summary.counts || typeof summary.counts !== 'object') return null;
    for (const key of ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'] as const) {
      if (!Number.isSafeInteger(summary.counts[key]) || (summary.counts[key] ?? -1) < 0) return null;
    }
    return summary as Summary;
  } catch { return null; }
}

export async function runCheck(options: Options): Promise<CheckResult> {
  if (!options || typeof options.workspace !== 'string' || typeof options.outputPath !== 'string'
    || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('check: invalid options');
  const testFile = relativePath(options.testFile, 'testFile');
  if (!testFile.endsWith('.mjs')) throw new Error('testFile: expected .mjs');
  await assertNoParentLinks(options.workspace, 'workspace');
  const workspace = await realpath(options.workspace);
  if (!(await lstat(workspace)).isDirectory()) throw new Error('workspace: expected directory');
  let current = workspace;
  const parts = testFile.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('testFile: symlink forbidden');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('testFile: parent is not a directory');
  }
  if (!(await lstat(current)).isFile()) throw new Error('testFile: expected ordinary file');
  const outputPath = resolve(options.outputPath);
  await assertNoParentLinks(dirname(outputPath), 'outputPath');
  const outputParent = await realpath(dirname(outputPath));
  if (!(await lstat(outputParent)).isDirectory() || inside(workspace, outputParent)) throw new Error('outputPath: expected external directory');
  const log = await open(outputPath, 'wx');
  const digest = createHash('sha256');
  let pending = Promise.resolve();
  const write = (data: string | Buffer): Promise<void> => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    pending = pending.then(async () => { await log.writeFile(bytes); digest.update(bytes); });
    return pending;
  };
  let timedOut = false;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let metadata = '';
  let metadataTooLarge = false;
  const startedAt = performance.now();
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG']) if (process.env[name] !== undefined) env[name] = process.env[name];
    const child = spawn(process.execPath, [worker, current], {
      cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    const kill = () => {
      if (child.pid === undefined) return;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
    const output = async (source: NodeJS.ReadableStream, label: string) => {
      for await (const chunk of source) await write(Buffer.concat([Buffer.from(`[${label}] `), Buffer.from(chunk as Buffer)]));
    };
    const meta = async () => {
      for await (const chunk of child.stdio[3] as NodeJS.ReadableStream) {
        const value = Buffer.from(chunk as Buffer).toString('utf8');
        if (metadata.length + value.length > 16384) metadataTooLarge = true;
        else metadata += value;
      }
    };
    const done = new Promise<void>((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, endSignal) => { exitCode = code; signal = endSignal; accept(); });
    });
    try {
      await Promise.all([done, output(child.stdout!, 'stdout'), output(child.stderr!, 'stderr'), meta()]);
    } catch (error) {
      kill();
      await done.catch(() => {});
      throw error;
    } finally { clearTimeout(timer); kill(); }
    const summary = !metadataTooLarge && metadata.endsWith('\n') && metadata.split('\n').filter(Boolean).length === 1
      ? parseSummary(metadata.trim()) : null;
    const counts = summary?.counts;
    const completed = summary !== null && !timedOut;
    const durationMs = Math.max(0, performance.now() - startedAt);
    await write(`\n[check-result] ${JSON.stringify({ exitCode, signal, timedOut, completed, summary, durationMs })}\n`);
    await pending;
    return {
      durationMs,
      passed: completed && exitCode === 0 && signal === null && summary.success && counts!.passed > 0
        && counts!.failed === 0 && counts!.cancelled === 0,
      exitCode, signal, timedOut, completed,
      passedTests: counts?.passed ?? 0, failedTests: counts?.failed ?? 0, testCount: counts?.tests ?? 0,
      outputPath, outputHash: digest.digest('hex'),
    };
  } finally {
    try { await pending; }
    finally { await log.close(); }
  }
}
