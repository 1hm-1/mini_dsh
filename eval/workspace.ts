import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import { relativePath } from '../src/validation.js';
import type { IntegrityResult } from './contracts.js';

export type SnapshotEntry =
  | { path: string; kind: 'file'; sha256: string; content: string; encoding: 'utf8' | 'base64' }
  | { path: string; kind: 'directory' }
  | { path: string; kind: 'symlink'; target: string }
  | { path: string; kind: 'special' };
export interface WorkspaceSnapshot { schemaVersion: 1; entries: SnapshotEntry[] }
export interface WorkspaceChange {
  path: string;
  kind: 'added' | 'deleted' | 'modified';
  before: SnapshotEntry | null;
  after: SnapshotEntry | null;
}

function compare(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (delta !== 0) return Math.sign(delta);
  }
  return Math.sign(left.length - right.length);
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function snapshotPath(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/')
    || value.includes('\\') || value.includes('\0') || /^[A-Za-z]:/.test(value)
    || value.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`${name}: invalid relative path`);
  }
  return value;
}

function encodedFile(relative: string, bytes: Buffer): SnapshotEntry {
  try {
    return { path: relative, kind: 'file', sha256: digest(bytes), content: decoder.decode(bytes), encoding: 'utf8' };
  } catch {
    return { path: relative, kind: 'file', sha256: digest(bytes), content: bytes.toString('base64'), encoding: 'base64' };
  }
}

async function checkedDirectoryRoot(root: string): Promise<string> {
  if (typeof root !== 'string' || root.length === 0) throw new Error('snapshot root: invalid path');
  if (root.split(path.sep).some(part => part === '..')) throw new Error('snapshot root: parent traversal is forbidden');
  const absolute = path.resolve(root);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`snapshot root: symlink parent ${current}`);
    if (!stat.isDirectory()) throw new Error(`snapshot root: not a directory ${current}`);
  }
  const stat = await lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('snapshot root: expected directory');
  return absolute;
}

export async function snapshotWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const absolute = await checkedDirectoryRoot(root);
  const entries: SnapshotEntry[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const relative = prefix ? `${prefix}/${name}` : name;
      snapshotPath(relative, 'snapshot path');
      const location = path.join(directory, name);
      const stat = await lstat(location);
      if (stat.isSymbolicLink()) {
        entries.push({ path: relative, kind: 'symlink', target: await readlink(location) });
      } else if (stat.isDirectory()) {
        entries.push({ path: relative, kind: 'directory' });
        await visit(location, relative);
      } else if (stat.isFile()) {
        const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (!(await handle.stat()).isFile()) throw new Error(`snapshot path: changed type ${relative}`);
          entries.push(encodedFile(relative, await handle.readFile()));
        } finally {
          await handle.close();
        }
      } else {
        entries.push({ path: relative, kind: 'special' });
      }
    }
  }
  await visit(absolute, '');
  entries.sort((a, b) => compare(a.path, b.path));
  return { schemaVersion: 1, entries };
}

function validEntries(snapshot: WorkspaceSnapshot, name: string): Map<string, SnapshotEntry> {
  if (snapshot === null || typeof snapshot !== 'object' || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.entries)) {
    throw new Error(`${name}: invalid snapshot`);
  }
  const entries = new Map<string, SnapshotEntry>();
  for (const entry of snapshot.entries) {
    if (entry === null || typeof entry !== 'object') throw new Error(`${name}: invalid entry`);
    const relative = snapshotPath(entry.path, `${name} path`);
    if (entries.has(relative)) throw new Error(`${name}: duplicate path ${relative}`);
    if (entry.kind === 'file') {
      if (typeof entry.content !== 'string' || (entry.encoding !== 'utf8' && entry.encoding !== 'base64')
        || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`${name}: invalid file ${relative}`);
      let bytes: Buffer;
      if (entry.encoding === 'utf8') {
        bytes = Buffer.from(entry.content, 'utf8');
        if (decoder.decode(bytes) !== entry.content) throw new Error(`${name}: invalid UTF-8 ${relative}`);
      } else {
        bytes = Buffer.from(entry.content, 'base64');
        if (bytes.toString('base64') !== entry.content) throw new Error(`${name}: invalid base64 ${relative}`);
      }
      if (digest(bytes) !== entry.sha256) throw new Error(`${name}: hash mismatch ${relative}`);
    } else if (entry.kind === 'symlink') {
      if (typeof entry.target !== 'string') throw new Error(`${name}: invalid symlink ${relative}`);
    } else if (entry.kind !== 'directory' && entry.kind !== 'special') {
      throw new Error(`${name}: invalid kind ${relative}`);
    }
    entries.set(relative, entry);
  }
  for (const relative of entries.keys()) {
    const parts = relative.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = entries.get(parts.slice(0, i).join('/'));
      if (!parent || parent.kind !== 'directory') throw new Error(`${name}: missing directory parent ${relative}`);
    }
  }
  return entries;
}

function copy(entry: SnapshotEntry | undefined): SnapshotEntry | null {
  return entry ? { ...entry } : null;
}

function equalEntries(old: SnapshotEntry, next: SnapshotEntry): boolean {
  if (old.kind !== next.kind) return false;
  if (old.kind === 'file' && next.kind === 'file') {
    return old.sha256 === next.sha256 && old.content === next.content && old.encoding === next.encoding;
  }
  if (old.kind === 'symlink' && next.kind === 'symlink') return old.target === next.target;
  return true;
}

function changesFrom(before: Map<string, SnapshotEntry>, after: Map<string, SnapshotEntry>): WorkspaceChange[] {
  const changes: WorkspaceChange[] = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const relative of [...paths].sort(compare)) {
    const old = before.get(relative);
    const next = after.get(relative);
    if (old && next && equalEntries(old, next)) continue;
    changes.push({ path: relative, kind: old ? next ? 'modified' : 'deleted' : 'added', before: copy(old), after: copy(next) });
  }
  return changes;
}

export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceChange[] {
  return changesFrom(validEntries(before, 'before'), validEntries(after, 'after'));
}

export function checkIntegrity(before: WorkspaceSnapshot, after: WorkspaceSnapshot, writable: readonly string[]): IntegrityResult {
  const old = validEntries(before, 'before');
  const next = validEntries(after, 'after');
  if (!Array.isArray(writable)) throw new Error('writable: expected array');
  const allowed = new Set(Array.from(writable, (item, index) => relativePath(item, `writable[${index}]`)));
  if (allowed.size !== writable.length) throw new Error('writable: duplicate path');
  const changes = changesFrom(old, next);
  const changed = new Set(changes.map(change => change.path));
  const violations: string[] = [];
  const allPaths = new Set([...old.keys(), ...next.keys()]);
  for (const relative of [...allPaths].sort(compare)) {
    const beforeEntry = old.get(relative);
    const afterEntry = next.get(relative);
    if (beforeEntry?.kind === 'symlink' || afterEntry?.kind === 'symlink'
      || beforeEntry?.kind === 'special' || afterEntry?.kind === 'special') {
      violations.push(`${relative}: symlink or special entry is forbidden`);
      continue;
    }
    if (changed.has(relative) && !allowed.has(relative) && (beforeEntry?.kind === 'file' || afterEntry?.kind === 'file')) {
      violations.push(`${relative}: file changed outside writable paths`);
    }
  }
  return { passed: violations.length === 0, changedPaths: changes.map(change => change.path), violations };
}
