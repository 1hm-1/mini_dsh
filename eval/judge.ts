import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { Termination } from '../src/types.js';
import { loadTask, materialize, type LoadedTask } from './assets.js';
import { runCheck } from './check.js';
import type { CheckResult, IntegrityResult } from './contracts.js';
import { checkIntegrity, diffSnapshots, type WorkspaceSnapshot } from './workspace.js';

export interface Grade {
  integrity: IntegrityResult;
  publicTest: CheckResult;
  acceptanceTest: CheckResult;
  functionalPass: boolean;
  passed: boolean;
  failureReason: string | null;
}

function inside(parent: string, child: string): boolean {
  const offset = relative(parent, child);
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

async function ordinaryParents(location: string): Promise<void> {
  let cursor = dirname(location);
  const root = parse(cursor).root;
  while (true) {
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('grade output parent: expected real directory');
    if (cursor === root) break;
    cursor = dirname(cursor);
  }
}

function originalWorkspace(task: LoadedTask): WorkspaceSnapshot {
  const prefix = `${task.spec.workspaceDir}/`;
  return {
    schemaVersion: 1,
    entries: task.assets.entries.filter(entry => entry.path.startsWith(prefix))
      .map(entry => ({ ...entry, path: entry.path.slice(prefix.length) })),
  };
}

function assertSameTask(task: LoadedTask, fresh: LoadedTask): void {
  if (task.root !== fresh.root || task.taskHash !== fresh.taskHash || task.prompt !== fresh.prompt
    || JSON.stringify(task.spec) !== JSON.stringify(fresh.spec)
    || JSON.stringify(task.assets) !== JSON.stringify(fresh.assets)) {
    throw new Error('grade task: assets changed or task metadata does not match source');
  }
}

function assertReservedPath(task: LoadedTask, original: WorkspaceSnapshot): void {
  const reserved = 'acceptance.test.mjs';
  if (original.entries.some(entry => entry.path === reserved || entry.path.startsWith(`${reserved}/`))
    || task.spec.writable.some(path => path === reserved || path.startsWith(`${reserved}/`))) {
    throw new Error('grade task: acceptance.test.mjs is reserved for external checks');
  }
}

function bytes(entry: Extract<WorkspaceSnapshot['entries'][number], { kind: 'file' }>): Buffer {
  return Buffer.from(entry.content, entry.encoding === 'utf8' ? 'utf8' : 'base64');
}

async function ordinaryOrCreate(directory: string, workspace: string): Promise<boolean> {
  const offset = relative(workspace, directory);
  if (offset === '') return true;
  let cursor = workspace;
  for (const part of offset.split(sep)) {
    cursor = join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(cursor);
    }
  }
  return true;
}

async function applyAllowed(workspace: string, before: WorkspaceSnapshot, after: WorkspaceSnapshot, writable: readonly string[]): Promise<void> {
  const allowed = new Set(writable);
  const changes = diffSnapshots(before, after).filter(change => allowed.has(change.path));
  for (const change of changes) {
    // Remove original writable files first so a file may become a directory.
    if (change.before?.kind !== 'file' || (change.after !== null && change.after.kind !== 'directory')) continue;
    await rm(join(workspace, change.path), { force: true });
  }
  for (const change of changes) {
    if (change.after?.kind !== 'directory') continue;
    const target = join(workspace, change.path);
    if (await ordinaryOrCreate(dirname(target), workspace)) await mkdir(target);
  }
  for (const change of changes) {
    if (change.after?.kind !== 'file') continue;
    const target = join(workspace, change.path);
    if (!(await ordinaryOrCreate(dirname(target), workspace))) continue;
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) continue;
    await writeFile(target, bytes(change.after));
  }
}

export async function grade(options: {
  task: LoadedTask;
  before: WorkspaceSnapshot;
  after: WorkspaceSnapshot;
  termination: Termination;
  outputDir: string;
}): Promise<Grade> {
  const { task, before, after, termination } = options;
  const fresh = await loadTask(task.root);
  assertSameTask(task, fresh);
  const original = originalWorkspace(fresh);
  assertReservedPath(fresh, original);
  diffSnapshots(original, before);
  if (JSON.stringify(before) !== JSON.stringify(original)) throw new Error('grade before: does not match original workspace');
  const integrity = checkIntegrity(before, after, fresh.spec.writable);

  const outputDir = resolve(options.outputDir);
  if (inside(fresh.root, outputDir)) throw new Error('grade output: must be outside task package');
  await ordinaryParents(outputDir);
  await mkdir(outputDir);
  const publicWorkspace = join(outputDir, '.public-workspace');
  const acceptanceWorkspace = join(outputDir, '.acceptance-workspace');
  try {
    await materialize(fresh, publicWorkspace);
    await applyAllowed(publicWorkspace, before, after, fresh.spec.writable);
    const publicTest = await runCheck({
      workspace: publicWorkspace, testFile: fresh.spec.publicTest,
      timeoutMs: fresh.spec.testTimeoutMs, outputPath: join(outputDir, 'public-output.txt'),
    });

    await materialize(fresh, acceptanceWorkspace);
    await applyAllowed(acceptanceWorkspace, before, after, fresh.spec.writable);
    const acceptanceEntry = fresh.assets.entries.find(entry => entry.path === fresh.spec.acceptanceTest);
    if (!acceptanceEntry || acceptanceEntry.kind !== 'file') throw new Error('grade task: acceptance asset missing');
    await writeFile(join(acceptanceWorkspace, 'acceptance.test.mjs'), bytes(acceptanceEntry), { flag: 'wx' });
    const acceptanceTest = await runCheck({
      workspace: acceptanceWorkspace, testFile: 'acceptance.test.mjs',
      timeoutMs: fresh.spec.testTimeoutMs, outputPath: join(outputDir, 'acceptance-output.txt'),
    });

    const functionalPass = publicTest.passed && acceptanceTest.passed;
    const passed = termination === 'completed' && integrity.passed && functionalPass;
    const failureReason = termination !== 'completed' ? termination
      : !integrity.passed ? 'integrity'
      : !publicTest.passed ? 'public_test'
      : !acceptanceTest.passed ? 'acceptance_test' : null;
    return { integrity, publicTest, acceptanceTest, functionalPass, passed, failureReason };
  } finally {
    await Promise.all([
      rm(publicWorkspace, { recursive: true, force: true }),
      rm(acceptanceWorkspace, { recursive: true, force: true }),
    ]);
  }
}
