import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { applyReferencePatch } from '../eval/reference.js';
import type { WorkspaceSnapshot } from '../eval/workspace.js';
const file = (path: string, content: string) => ({ path, kind: 'file' as const, content, encoding: 'utf8' as const,
  sha256: createHash('sha256').update(content).digest('hex') });
const before: WorkspaceSnapshot = { schemaVersion: 1, entries: [file('a.mjs', 'one\ntwo\nthree\n'), file('public.test.mjs', 'protected\n')] };
const patch = 'diff --git a/a.mjs b/a.mjs\n--- a/a.mjs\n+++ b/a.mjs\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n';

test('E04 reference patches match exact context and preserve the original snapshot', () => {
  const copy = structuredClone(before);
  const after = applyReferencePatch(before, patch, ['a.mjs']);
  assert.equal(after.entries.find(e => e.path === 'a.mjs')?.kind, 'file');
  assert.deepEqual(after.entries.find(e => e.path === 'a.mjs'), file('a.mjs', 'one\nTWO\nthree\n'));
  assert.deepEqual(before, copy);
  assert.throws(() => applyReferencePatch(before, patch.replace('-two', '-wrong'), ['a.mjs']));
  assert.throws(() => applyReferencePatch(before, patch.replace('+1,3', '+2,3'), ['a.mjs']));
  assert.throws(() => applyReferencePatch(before, patch.replace('-1,3', '-1,2'), ['a.mjs']));
  assert.deepEqual(before, copy);
});

test('E04 reference patch supports file creation, deletion and no-final-newline markers', () => {
  const value = applyReferencePatch(before,
    'diff --git a/new/x.mjs b/new/x.mjs\nnew file mode 100644\n--- /dev/null\n+++ b/new/x.mjs\n@@ -0,0 +1 @@\n+new\n\\ No newline at end of file\n'
    + 'diff --git a/a.mjs b/a.mjs\ndeleted file mode 100644\n--- a/a.mjs\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-one\n-two\n-three\n', ['a.mjs', 'new/x.mjs']);
  assert.deepEqual(value.entries, [{ path: 'new', kind: 'directory' }, file('new/x.mjs', 'new'), file('public.test.mjs', 'protected\n')]);
});

test('E04 patch rejects protected targets, traversal, unsupported metadata and partial multi-file application', () => {
  for (const invalid of [patch.replaceAll('a.mjs', 'public.test.mjs'), patch.replaceAll('a.mjs', '../outside'),
    patch.replace('--- a/a.mjs', 'old mode 100644\nnew mode 100755\n--- a/a.mjs'),
    patch.replace('--- a/a.mjs', 'rename from old\nrename to a.mjs\n--- a/a.mjs'),
    patch + patch, '', patch + 'unexpected\n']) {
    assert.throws(() => applyReferencePatch(before, invalid, ['a.mjs']));
  }
  const illegalSecond = patch + '--- a/public.test.mjs\n+++ b/public.test.mjs\n@@ -1 +1 @@\n-protected\n+changed\n';
  const copy = structuredClone(before);
  assert.throws(() => applyReferencePatch(before, illegalSecond, ['a.mjs']));
  assert.deepEqual(before, copy);
});

test('E04 multiple hunks preserve untouched bytes and CRLF payloads', () => {
  const original: WorkspaceSnapshot = { schemaVersion: 1, entries: [file('a.mjs', 'a\r\nb\r\nc\r\nd\r\ne\r\n')] };
  const after = applyReferencePatch(original, '--- a/a.mjs\n+++ b/a.mjs\n@@ -1 +1 @@\n-a\r\n+A\r\n@@ -5 +5 @@\n-e\r\n+E\r\n', ['a.mjs']);
  assert.deepEqual(after.entries, [file('a.mjs', 'A\r\nb\r\nc\r\nd\r\nE\r\n')]);
});
