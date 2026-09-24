import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, parse, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { record, relativePath } from '../src/validation.js';
import { loadTask, loadTasks, type LoadedTask } from './assets.js';
import type { BenchmarkManifest, EvalConfig } from './contracts.js';
import { parseEvalConfig, parseTaskId } from './task.js';

const runFile = promisify(execFile);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hex64 = /^[a-f0-9]{64}$/;
const hexCommit = /^[a-f0-9]{40,64}$/;

async function git(root: string, args: string[], binary = false): Promise<string | Buffer> {
  try {
    const result = await runFile('git', args, { cwd: root, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return result.stdout;
  } catch {
    throw new Error('benchmark: Git validation failed');
  }
}

async function ordinary(path: string, final: 'file' | 'directory'): Promise<void> {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error('benchmark: symlink path');
    if (cursor === absolute ? final === 'file' ? !stat.isFile() : !stat.isDirectory() : !stat.isDirectory()) {
      throw new Error('benchmark: expected ordinary path');
    }
  }
}

function manifestFrom(bytes: Buffer): BenchmarkManifest {
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('benchmark manifest: invalid JSON or UTF-8'); }
  const value = record(decoded, 'benchmark manifest', ['schemaVersion', 'benchmarkVersion', 'tasks']);
  if (value.schemaVersion !== 1 || value.benchmarkVersion !== 'v1' || !Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new Error('benchmark manifest: invalid version or tasks');
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  const tasks = value.tasks.map((entry, index) => {
    const item = record(entry, `benchmark task ${index}`, ['id', 'suite', 'path', 'taskHash']);
    const id = parseTaskId(item.id, 'benchmark task id');
    const path = relativePath(item.path, 'benchmark task path');
    if (item.suite !== 'S' && item.suite !== 'H' || typeof item.taskHash !== 'string' || !hex64.test(item.taskHash)) {
      throw new Error('benchmark manifest: invalid task metadata');
    }
    if (ids.has(id) || paths.has(path)) throw new Error('benchmark manifest: duplicate task');
    ids.add(id); paths.add(path);
    return { id, suite: item.suite as 'S' | 'H', path, taskHash: item.taskHash };
  });
  for (const left of paths) for (const right of paths) {
    if (left !== right && right.startsWith(`${left}/`)) throw new Error('benchmark manifest: overlapping task paths');
  }
  return { schemaVersion: 1, benchmarkVersion: 'v1', tasks };
}

function gitTreeFiles(tree: Buffer, prefix: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const row of tree.toString('utf8').split('\0')) {
    if (!row) continue;
    const match = /^(100644|100755) blob ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(row);
    if (!match) throw new Error('benchmark: frozen Git tree has non-file asset');
    const path = match[3]!;
    if (!path.startsWith(`${prefix}/`) || files.has(path)) throw new Error('benchmark: invalid frozen Git tree');
    files.set(path, match[2]!);
  }
  return files;
}

async function checkFrozenTask(root: string, commit: string, path: string, task: LoadedTask): Promise<void> {
  const tree = gitTreeFiles(await git(root, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', `:(literal)${path}`], true) as Buffer, path);
  const actual = task.assets.entries.filter(entry => entry.kind === 'file');
  if (tree.size !== actual.length) throw new Error('benchmark: task differs from frozen Git tree');
  for (const entry of task.assets.entries) {
    if (entry.kind === 'directory' && !actual.some(file => file.path.startsWith(`${entry.path}/`))) {
      throw new Error('benchmark: empty directory cannot be frozen in Git');
    }
  }
  for (const entry of actual) {
    const gitPath = `${path}/${entry.path}`;
    const oid = tree.get(gitPath);
    if (!oid) throw new Error('benchmark: task differs from frozen Git tree');
    const old = await git(root, ['cat-file', 'blob', oid], true) as Buffer;
    if (hash(old) !== entry.sha256) throw new Error('benchmark: task differs from frozen Git commit');
  }
}

export async function loadEvaluationInputs(config: EvalConfig, projectRoot: string, smokeTaskRoot?: string): Promise<{
  tasks: LoadedTask[];
  implementationCommit: string | null;
  dirty: boolean;
  benchmarkCommit: string | null;
  benchmarkHash: string | null;
}> {
  const stableConfig = parseEvalConfig(config);
  const root = resolve(projectRoot);
  const fixtureRoot = smokeTaskRoot ?? join(root, 'tests', 'fixtures');
  await ordinary(root, 'directory');
  if (stableConfig.phase === 'smoke' && stableConfig.benchmarkManifest === null) {
    await ordinary(fixtureRoot, 'directory');
    const tasks = await loadTasks(fixtureRoot, stableConfig.taskIds);
    let implementationCommit: string | null = null;
    let dirty = true;
    try {
      const candidate = (await git(root, ['rev-parse', 'HEAD']) as string).trim();
      if (hexCommit.test(candidate)) implementationCommit = candidate;
    } catch { /* No Git HEAD is valid for local smoke fixtures. */ }
    if (implementationCommit !== null) {
      dirty = (await git(root, ['status', '--porcelain', '-z', '--untracked-files=all'], true) as Buffer).length > 0;
    }
    return { tasks, implementationCommit, dirty, benchmarkCommit: null, benchmarkHash: null };
  }
  if (stableConfig.phase === 'smoke' || stableConfig.benchmarkManifest === null) throw new Error('benchmark: frozen manifest required');
  const manifestPath = relativePath(stableConfig.benchmarkManifest, 'benchmark manifest path');
  const absoluteManifest = join(root, manifestPath);
  await ordinary(absoluteManifest, 'file');
  const bytes = await readFile(absoluteManifest);
  const manifest = manifestFrom(bytes);
  const outputDir = resolve(root, stableConfig.outputDir);
  for (const item of manifest.tasks) {
    const taskDir = join(root, item.path);
    if (outputDir === taskDir || outputDir.startsWith(`${taskDir}${sep}`)) {
      throw new Error('benchmark: output directory overlaps task package');
    }
  }
  const gitRoot = (await git(root, ['rev-parse', '--show-toplevel']) as string).trim();
  if (resolve(gitRoot) !== root) throw new Error('benchmark: projectRoot must be the Git root');
  const implementationCommit = (await git(root, ['rev-parse', 'HEAD']) as string).trim();
  if (!hexCommit.test(implementationCommit)) throw new Error('benchmark: invalid implementation commit');
  const dirty = (await git(root, ['status', '--porcelain', '-z', '--untracked-files=all'], true) as Buffer).length > 0;
  if (dirty) throw new Error('benchmark: implementation Git tree must be clean');
  const benchmarkCommit = (await git(root, ['log', '-1', '--format=%H', 'HEAD', '--', `:(literal)${manifestPath}`]) as string).trim();
  if (!hexCommit.test(benchmarkCommit)) throw new Error('benchmark: manifest has no frozen commit');
  await git(root, ['merge-base', '--is-ancestor', benchmarkCommit, implementationCommit]);
  const frozenManifest = await git(root, ['show', `${benchmarkCommit}:${manifestPath}`], true) as Buffer;
  if (!frozenManifest.equals(bytes)) throw new Error('benchmark: manifest differs from frozen commit');
  if (manifest.tasks.some(task => task.path === manifestPath || manifestPath.startsWith(`${task.path}/`) || task.path.startsWith(`${manifestPath}/`))) {
    throw new Error('benchmark: manifest overlaps task path');
  }
  const all = new Map<string, LoadedTask>();
  for (const item of manifest.tasks) {
    const taskRoot = join(root, item.path);
    await ordinary(taskRoot, 'directory');
    const task = await loadTask(taskRoot);
    if (task.spec.id !== item.id || task.spec.suite !== item.suite || task.taskHash !== item.taskHash) {
      throw new Error('benchmark: task metadata or hash mismatch');
    }
    await checkFrozenTask(root, benchmarkCommit, item.path, task);
    all.set(item.id, task);
  }
  const tasks = stableConfig.taskIds.map(id => {
    const task = all.get(id);
    if (!task) throw new Error('benchmark: selected task absent from manifest');
    return task;
  });
  return { tasks, implementationCommit, dirty: false, benchmarkCommit, benchmarkHash: hash(bytes) };
}

/** Verify recorded provenance without requiring the current checkout to be the old implementation. */
export async function verifyFrozenInputs(config: EvalConfig, projectRoot: string, expected: {
  implementationCommit: string; benchmarkCommit: string; benchmarkHash: string;
}): Promise<LoadedTask[]> {
  const stable = parseEvalConfig(config);
  const root = resolve(projectRoot);
  const saved = { ...expected };
  if (stable.phase === 'smoke' || !stable.benchmarkManifest || !hexCommit.test(saved.implementationCommit)
    || !hexCommit.test(saved.benchmarkCommit) || !hex64.test(saved.benchmarkHash)) throw new Error('benchmark evidence: invalid provenance');
  await ordinary(root, 'directory');
  if (resolve((await git(root, ['rev-parse', '--show-toplevel']) as string).trim()) !== root) {
    throw new Error('benchmark evidence: invalid project root');
  }
  await git(root, ['cat-file', '-e', `${saved.implementationCommit}^{commit}`]);
  await git(root, ['cat-file', '-e', `${saved.benchmarkCommit}^{commit}`]);
  await git(root, ['merge-base', '--is-ancestor', saved.benchmarkCommit, saved.implementationCommit]);
  const manifestPath = stable.benchmarkManifest;
  const last = (await git(root, ['log', '-1', '--format=%H', saved.implementationCommit, '--', `:(literal)${manifestPath}`]) as string).trim();
  if (last !== saved.benchmarkCommit) throw new Error('benchmark evidence: wrong freeze commit');
  await ordinary(join(root, manifestPath), 'file');
  const bytes = await readFile(join(root, manifestPath));
  if (hash(bytes) !== saved.benchmarkHash
    || !(await git(root, ['show', `${saved.benchmarkCommit}:${manifestPath}`], true) as Buffer).equals(bytes)) {
    throw new Error('benchmark evidence: manifest hash mismatch');
  }
  const manifest = manifestFrom(bytes);
  const tasks = new Map<string, LoadedTask>();
  for (const item of manifest.tasks) {
    const task = await loadTask(join(root, item.path));
    if (task.spec.id !== item.id || task.spec.suite !== item.suite || task.taskHash !== item.taskHash) {
      throw new Error('benchmark evidence: task mismatch');
    }
    await checkFrozenTask(root, saved.benchmarkCommit, item.path, task);
    tasks.set(item.id, task);
  }
  return stable.taskIds.map(id => {
    const task = tasks.get(id);
    if (!task) throw new Error('benchmark evidence: selected task absent');
    return task;
  });
}
