import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { checkIntegrity, diffSnapshots, snapshotWorkspace, type WorkspaceSnapshot } from '../eval/workspace.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mini-harness-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const file = (name: string, content: string) => ({ path: name, kind: 'file' as const, sha256: hash(content), content, encoding: 'utf8' as const });
const snapshot = (...entries: WorkspaceSnapshot['entries']): WorkspaceSnapshot => ({ schemaVersion: 1, entries });

test('E01 snapshots real file additions, edits and deletions with stable byte hashes and isolated changes', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'empty'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'edit.txt'), '\ufeffa\r\n');
  await writeFile(path.join(root, 'delete.txt'), 'old');
  const before = await snapshotWorkspace(root);
  assert.deepEqual(before.entries.map(entry => entry.path), ['delete.txt', 'empty', 'src', 'src/edit.txt']);
  assert.deepEqual(before.entries.find(entry => entry.path === 'src/edit.txt'), file('src/edit.txt', '\ufeffa\r\n'));
  await writeFile(path.join(root, 'src', 'edit.txt'), '\ufeffb\r\n');
  await rm(path.join(root, 'delete.txt'));
  await writeFile(path.join(root, 'added.txt'), 'new');
  const after = await snapshotWorkspace(root);
  const changes = diffSnapshots(before, after);
  assert.deepEqual(changes.map(change => [change.path, change.kind]), [
    ['added.txt', 'added'], ['delete.txt', 'deleted'], ['src/edit.txt', 'modified'],
  ]);
  assert.equal(checkIntegrity(before, after, ['src/edit.txt', 'added.txt']).passed, false);
  assert.deepEqual(checkIntegrity(before, after, ['src/edit.txt', 'added.txt', 'delete.txt']), {
    passed: true, changedPaths: ['added.txt', 'delete.txt', 'src/edit.txt'], violations: [],
  });
  const changed = changes[2]!;
  assert.equal(changed.before?.kind, 'file');
  if (changed.before?.kind === 'file') changed.before.content = 'corrupted';
  assert.deepEqual(before.entries.find(entry => entry.path === 'src/edit.txt'), file('src/edit.txt', '\ufeffa\r\n'));
  assert.equal((await readFile(path.join(root, 'src', 'edit.txt'))).toString(), '\ufeffb\r\n');
});

test('E03 symlink leaves and directories are recorded without reading targets; all special entries fail integrity', async t => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await writeFile(path.join(outside, 'secret.txt'), 'private');
  await symlink(outside, path.join(root, 'link-dir'));
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link-file'));
  const before = snapshot();
  const after = await snapshotWorkspace(root);
  assert.deepEqual(after.entries, [
    { path: 'link-dir', kind: 'symlink', target: outside },
    { path: 'link-file', kind: 'symlink', target: path.join(outside, 'secret.txt') },
  ]);
  assert.equal(checkIntegrity(before, after, ['link-dir', 'link-file']).passed, false);
  assert.deepEqual(checkIntegrity(after, after, ['link-dir']).changedPaths, []);
  assert.equal(checkIntegrity(after, after, ['link-dir']).passed, false);
  await assert.rejects(snapshotWorkspace(path.join(root, 'link-dir')), /symlink|directory|root/i);
  await assert.rejects(snapshotWorkspace(path.join(root, 'link-dir', 'secret.txt')), /symlink|directory|root/i);
});

test('special FIFO is not opened and binary content round trips exactly', async t => {
  const root = await fixture(t);
  const bytes = Buffer.from([0xff, 0x00, 0xc0, 0x0a]);
  await writeFile(path.join(root, 'bytes.bin'), bytes);
  execFileSync('mkfifo', [path.join(root, 'pipe')]);
  const after = await snapshotWorkspace(root);
  assert.deepEqual(after.entries, [
    { path: 'bytes.bin', kind: 'file', sha256: hash(bytes), content: bytes.toString('base64'), encoding: 'base64' },
    { path: 'pipe', kind: 'special' },
  ]);
  assert.equal(checkIntegrity(snapshot(), after, ['bytes.bin', 'pipe']).passed, false);
});

test('snapshot validation rejects duplicate, escaping, corrupt and contradictory entries', () => {
  const valid = snapshot(file('a.txt', 'hello'));
  for (const bad of [
    snapshot(file('a.txt', 'hello'), file('a.txt', 'hello')),
    snapshot(file('../escape', 'hello')),
    snapshot(file('/absolute', 'hello')),
    snapshot({ ...file('a.txt', 'hello'), sha256: '0'.repeat(64) }),
    snapshot({ path: 'parent', kind: 'file', sha256: hash('x'), content: 'x', encoding: 'utf8' }, file('parent/child', 'y')),
  ]) {
    assert.throws(() => diffSnapshots(valid, bad));
    assert.throws(() => checkIntegrity(valid, bad, []));
  }
  assert.throws(() => checkIntegrity(valid, valid, ['*.txt']));
  assert.throws(() => checkIntegrity(valid, valid, ['a.txt', 'a.txt']));
});

test('empty directory changes do not independently violate writable policy; file/type changes do', () => {
  const empty = snapshot({ path: 'empty', kind: 'directory' });
  assert.equal(checkIntegrity(snapshot(), empty, []).passed, true);
  assert.equal(checkIntegrity(empty, snapshot(), []).passed, true);
  assert.equal(checkIntegrity(snapshot(file('a', 'x')), snapshot({ path: 'a', kind: 'directory' }), []).passed, false);
  assert.equal(checkIntegrity(empty, snapshot({ path: 'empty', kind: 'special' }), ['empty']).passed, false);
});

test('snapshot and changes sort by Unicode code points', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, '\ue000.txt'), 'a');
  await writeFile(path.join(root, '\u{10000}.txt'), 'b');
  const after = await snapshotWorkspace(root);
  assert.deepEqual(after.entries.map(entry => entry.path), ['\ue000.txt', '\u{10000}.txt']);
  assert.deepEqual(diffSnapshots(snapshot(), after).map(change => change.path), ['\ue000.txt', '\u{10000}.txt']);
});

test('real filenames containing TEMPLATE or glob punctuation remain visible to integrity checks', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'TEMPLATE-notes.md'), 'protected');
  await writeFile(path.join(root, 'notes[1]?.txt'), 'protected');
  const after = await snapshotWorkspace(root);
  assert.deepEqual(after.entries.map(entry => entry.path), ['TEMPLATE-notes.md', 'notes[1]?.txt']);
  const result = checkIntegrity(snapshot(), after, []);
  assert.equal(result.passed, false);
  assert.deepEqual(result.changedPaths, ['TEMPLATE-notes.md', 'notes[1]?.txt']);
  assert.equal(result.violations.length, 2);
  assert.throws(() => checkIntegrity(snapshot(), after, ['notes[1]?.txt']), /writable/);
});

test('sparse writable arrays are rejected', () => {
  const sparse = Array<string>(1);
  assert.throws(() => checkIntegrity(snapshot(), snapshot(), sparse), /writable/);
});
