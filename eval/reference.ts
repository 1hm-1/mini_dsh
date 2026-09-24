import { createHash } from 'node:crypto';
import { relativePath } from '../src/validation.js';
import { checkIntegrity, diffSnapshots, type SnapshotEntry, type WorkspaceSnapshot } from './workspace.js';

type PatchLine = { op: ' ' | '+' | '-'; text: string };
type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: PatchLine[] };
type FilePatch = { path: string; create: boolean; remove: boolean; hunks: Hunk[] };
const fail = (): never => { throw new Error('reference patch: invalid, unsupported or mismatched diff'); };

function patchPath(header: string, prefix: 'a/' | 'b/'): string | null {
  if (header === '/dev/null') return null;
  if (!header.startsWith(prefix) || header.includes('\t') || header.includes('\r')) return fail();
  return relativePath(header.slice(2), 'reference path');
}

function parse(patch: string, allowed: Set<string>): FilePatch[] {
  if (typeof patch !== 'string' || patch.length === 0 || !patch.endsWith('\n')) return fail();
  const lines = patch.slice(0, -1).split('\n');
  const result: FilePatch[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < lines.length) {
    let gitPaths: [string, string] | undefined;
    let mode: 'new' | 'deleted' | undefined;
    if (lines[i]!.startsWith('diff --git ')) {
      const matched = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[i++]!);
      if (!matched) return fail();
      gitPaths = [relativePath(matched[1], 'reference path'), relativePath(matched[2], 'reference path')];
      if (gitPaths[0] !== gitPaths[1]) return fail();
      if (/^(new|deleted) file mode 100644$/.test(lines[i] ?? '')) {
        mode = lines[i++]!.startsWith('new') ? 'new' : 'deleted';
      }
      if (/^index [0-9a-f]+\.\.[0-9a-f]+(?: 100644)?$/.test(lines[i] ?? '')) i++;
    }
    if (!lines[i]?.startsWith('--- ') || !lines[i + 1]?.startsWith('+++ ')) return fail();
    const oldPath = patchPath(lines[i++]!.slice(4), 'a/');
    const newPath = patchPath(lines[i++]!.slice(4), 'b/');
    const name = newPath ?? oldPath;
    if (!name || oldPath && newPath && oldPath !== newPath || !allowed.has(name) || seen.has(name)) return fail();
    if (gitPaths && gitPaths[0] !== name || mode === 'new' && oldPath !== null || mode === 'deleted' && newPath !== null) return fail();
    seen.add(name);
    const hunks: Hunk[] = [];
    while (lines[i]?.startsWith('@@ ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[i++]!);
      if (!match) return fail();
      const hunk: Hunk = { oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]), newCount: Number(match[4] ?? 1), lines: [] };
      if ([hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount].some(n => !Number.isSafeInteger(n))) return fail();
      let oldLines = 0; let newLines = 0;
      while (oldLines < hunk.oldCount || newLines < hunk.newCount) {
        const value = lines[i++];
        if (value === undefined || ![' ', '+', '-'].includes(value[0] ?? '')) return fail();
        const op = value[0] as PatchLine['op'];
        hunk.lines.push({ op, text: value.slice(1) + '\n' });
        if (op !== '+') oldLines++;
        if (op !== '-') newLines++;
        if (lines[i] === '\\ No newline at end of file') {
          hunk.lines.at(-1)!.text = value.slice(1);
          i++;
        }
      }
      if (oldLines !== hunk.oldCount || newLines !== hunk.newCount || hunk.lines.length === 0) return fail();
      hunks.push(hunk);
    }
    if (!hunks.length || !hunks.some(h => h.lines.some(line => line.op !== ' '))) return fail();
    result.push({ path: name, create: oldPath === null, remove: newPath === null, hunks });
  }
  if (!result.length) return fail();
  return result;
}

function patchedText(original: string, hunks: Hunk[]): string {
  const input = original.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const oldIndex = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    const newIndex = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
    if (oldIndex < cursor || oldIndex > input.length) return fail();
    output.push(...input.slice(cursor, oldIndex));
    cursor = oldIndex;
    if (newIndex !== output.length) return fail();
    for (const line of hunk.lines) {
      if (line.op !== '+') {
        if (input[cursor++] !== line.text) return fail();
      }
      if (line.op !== '-') output.push(line.text);
    }
  }
  output.push(...input.slice(cursor));
  // A no-newline marker can only describe the final line of a file.
  if (output.slice(0, -1).some(line => !line.endsWith('\n'))) return fail();
  return output.join('');
}

/** Strict text unified diff, applied atomically to a copy; no shell or filesystem writes. */
export function applyReferencePatch(before: WorkspaceSnapshot, patch: string, writable: readonly string[]): WorkspaceSnapshot {
  const clean = checkIntegrity(before, before, writable);
  if (!clean.passed) return fail();
  const allowed = new Set(writable);
  const patches = parse(patch, allowed);
  const entries = new Map(before.entries.map(entry => [entry.path, structuredClone(entry)]));
  for (const item of patches) {
    const prior = entries.get(item.path);
    if (item.create ? prior !== undefined : prior?.kind !== 'file' || prior.encoding !== 'utf8') return fail();
    const content = patchedText(prior?.kind === 'file' ? prior.content : '', item.hunks);
    if (item.remove) {
      if (content !== '') return fail();
      entries.delete(item.path);
    } else {
      const parts = item.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/');
        const entry = entries.get(parent);
        if (entry && entry.kind !== 'directory') return fail();
        entries.set(parent, { path: parent, kind: 'directory' });
      }
      entries.set(item.path, { path: item.path, kind: 'file', encoding: 'utf8', content,
        sha256: createHash('sha256').update(content, 'utf8').digest('hex') });
    }
  }
  // diffSnapshots validates the result and provides the shared canonical path ordering.
  const unordered: WorkspaceSnapshot = { schemaVersion: 1, entries: [...entries.values()] };
  const sorted = diffSnapshots({ schemaVersion: 1, entries: [] }, unordered).map(change => change.after!);
  const result = { schemaVersion: 1 as const, entries: sorted as SnapshotEntry[] };
  if (!checkIntegrity(before, result, writable).passed) return fail();
  return result;
}
