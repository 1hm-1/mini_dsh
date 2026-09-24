import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseTaskId, parseTaskSpec } from './task.js';
import type { TaskSpec } from './contracts.js';
import { snapshotWorkspace, type WorkspaceSnapshot } from './workspace.js';

export interface LoadedTask {
  root: string;
  spec: TaskSpec;
  prompt: string;
  taskHash: string;
  assets: WorkspaceSnapshot;
}

function inside(parent: string, child: string): boolean {
  const offset = relative(parent, child);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

function packageHash(snapshot: WorkspaceSnapshot): string {
  // v1 canonical descriptor: sorted package-relative paths, kinds, and raw-byte
  // SHA-256 for files. JSON.stringify fixes field order; absolute paths, mtimes,
  // and snapshot text encoding never enter the descriptor.
  const entries = snapshot.entries.map(entry => entry.kind === 'file'
    ? { path: entry.path, kind: entry.kind, sha256: entry.sha256 }
    : { path: entry.path, kind: entry.kind });
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, entries })).digest('hex');
}

function utf8Asset(snapshot: WorkspaceSnapshot, path: string, name: string): string {
  const entry = snapshot.entries.find(item => item.path === path);
  if (entry?.kind !== 'file' || entry.encoding !== 'utf8') throw new Error(`${name}: invalid UTF-8`);
  return entry.content;
}

async function requireEntry(root: string, paths: Map<string, string>, name: string, path: string, kind: 'file' | 'directory'): Promise<void> {
  if (paths.get(path) !== kind) throw new Error(`${name}: expected ${kind} asset`);
  const actual = await lstat(join(root, path));
  if (kind === 'file' && !actual.isFile() || kind === 'directory' && !actual.isDirectory()) throw new Error(`${name}: invalid asset`);
}

function parentParts(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function rejectOverlaps(spec: TaskSpec): void {
  const workspace = spec.workspaceDir;
  const hidden = [spec.acceptanceTest, spec.referencePatch];
  if (insideRelative(workspace, spec.promptFile) || insideRelative(workspace, 'task.json')) throw new Error('task.promptFile: must be outside workspace');
  for (const path of hidden) {
    if (insideRelative(workspace, path)) throw new Error('task hidden asset: must be outside workspace');
  }
  const protectedPaths = [spec.promptFile, 'task.json', ...hidden];
  if (new Set(protectedPaths).size !== protectedPaths.length) throw new Error('task assets: overlapping required files');
  if (protectedPaths.some(path => path === workspace || insideRelative(path, workspace))) throw new Error('task assets: overlapping workspace');
}

function insideRelative(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

export async function loadTask(taskDir: string): Promise<LoadedTask> {
  const root = resolve(taskDir);
  const assets = await snapshotWorkspace(root);
  if (assets.entries.some(entry => entry.kind === 'symlink' || entry.kind === 'special')) throw new Error('task package: symlink or special asset');
  const paths = new Map(assets.entries.map(entry => [entry.path, entry.kind]));
  await requireEntry(root, paths, 'task.json', 'task.json', 'file');
  const spec = parseTaskSpec(JSON.parse(utf8Asset(assets, 'task.json', 'task.json').replace(/^\uFEFF/, '')));
  if (basename(root) !== spec.id) throw new Error('task.id: does not match package directory');
  rejectOverlaps(spec);
  await requireEntry(root, paths, 'task.promptFile', spec.promptFile, 'file');
  await requireEntry(root, paths, 'task.workspaceDir', spec.workspaceDir, 'directory');
  await requireEntry(root, paths, 'task.publicTest', `${spec.workspaceDir}/${spec.publicTest}`, 'file');
  await requireEntry(root, paths, 'task.acceptanceTest', spec.acceptanceTest, 'file');
  await requireEntry(root, paths, 'task.referencePatch', spec.referencePatch, 'file');
  for (const path of spec.writable) {
    const workspacePath = `${spec.workspaceDir}/${path}`;
    for (const parent of parentParts(path)) {
      const entry = paths.get(`${spec.workspaceDir}/${parent}`);
      if (entry !== undefined && entry !== 'directory') throw new Error('task.writable: parent is not a directory');
    }
    const existing = paths.get(workspacePath);
    if (existing !== undefined && existing !== 'file') throw new Error('task.writable: expected file');
    if (path === spec.publicTest) throw new Error('task.writable: publicTest is protected');
  }
  const prompt = utf8Asset(assets, spec.promptFile, 'task.promptFile');
  if (prompt.trim() === '') throw new Error('task.promptFile: empty prompt');
  return freezeDeep({ root, spec, prompt, taskHash: packageHash(assets), assets });
}

export async function loadTasks(taskRoot: string, ids: readonly string[]): Promise<LoadedTask[]> {
  if (ids.length === 0) throw new Error('task IDs: expected nonempty list');
  const unique = new Set<string>();
  for (const id of ids) {
    parseTaskId(id);
    if (unique.has(id)) throw new Error('task IDs: duplicate');
    unique.add(id);
  }
  const root = resolve(taskRoot);
  const result: LoadedTask[] = [];
  for (const id of ids) result.push(await loadTask(join(root, id)));
  return result;
}

async function assertOrdinaryParents(path: string): Promise<void> {
  let cursor = dirname(path);
  while (true) {
    const stat = await lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('destination parent: expected real directory');
    const next = dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
}

export async function materialize(task: LoadedTask, destination: string): Promise<{ workspace: string; before: WorkspaceSnapshot }> {
  const fresh = await loadTask(task.root);
  if (fresh.taskHash !== task.taskHash || fresh.prompt !== task.prompt || JSON.stringify(fresh.spec) !== JSON.stringify(task.spec)
    || JSON.stringify(fresh.assets) !== JSON.stringify(task.assets) || fresh.root !== task.root) throw new Error('task assets changed since load');
  const workspace = resolve(destination);
  if (inside(fresh.root, workspace)) throw new Error('destination: inside task package');
  await assertOrdinaryParents(workspace);
  let owned = false;
  try {
    await mkdir(workspace);
    owned = true;
    const source = join(fresh.root, fresh.spec.workspaceDir);
    const prefix = `${fresh.spec.workspaceDir}/`;
    for (const entry of fresh.assets.entries) {
      if (!entry.path.startsWith(prefix)) continue;
      const relativePath = entry.path.slice(prefix.length);
      const target = join(workspace, relativePath);
      if (entry.kind === 'directory') await mkdir(target);
      else if (entry.kind === 'file') await copyFile(join(source, relativePath), target, constants.COPYFILE_EXCL);
      else throw new Error('task package: invalid workspace entry');
    }
    const before = await snapshotWorkspace(workspace);
    const expected = await snapshotWorkspace(source);
    if (JSON.stringify(before) !== JSON.stringify(expected) || (await loadTask(fresh.root)).taskHash !== fresh.taskHash) {
      throw new Error('workspace copy: source changed');
    }
    return { workspace, before };
  } catch (error) {
    if (owned) await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}
