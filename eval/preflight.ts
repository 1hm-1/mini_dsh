import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadTask, type LoadedTask } from './assets.js';
import type { CheckResult } from './contracts.js';
import { grade, type Grade } from './judge.js';
import { applyReferencePatch } from './reference.js';
import type { WorkspaceSnapshot } from './workspace.js';

export interface PreflightResult {
  passed: boolean;
  taskId: string;
  taskHash: string;
  initial: Grade;
  reference: Grade | null;
  error: string | null;
}

function actualCompleted(check: CheckResult): boolean {
  return check.completed && !check.timedOut && check.signal === null
    && (check.exitCode === 0 || check.exitCode === 1)
    && check.testCount > 0 && check.passedTests + check.failedTests > 0;
}

async function createEvidenceDirectory(output: string, taskRoot: string): Promise<string> {
  const destination = resolve(output);
  const offset = relative(taskRoot, destination);
  if (offset === '' || offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) {
    throw new Error('preflight output must be outside task package');
  }
  let parent = dirname(destination);
  while (true) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('preflight output parent must be a real directory');
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  await mkdir(destination);
  return destination;
}

/** Offline task validation. No runtime or model invocation and no writes to task assets. */
export async function preflight(task: LoadedTask, outputDir: string): Promise<PreflightResult> {
  const fresh = await loadTask(task.root);
  if (JSON.stringify(fresh) !== JSON.stringify(task)) throw new Error('preflight task changed since loading');
  const prefix = `${fresh.spec.workspaceDir}/`;
  const before: WorkspaceSnapshot = { schemaVersion: 1, entries: fresh.assets.entries
    .filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) })) };
  const output = await createEvidenceDirectory(outputDir, fresh.root);
  const initial = await grade({ task: fresh, before, after: before, termination: 'completed', outputDir: join(output, 'initial') });
  let reference: Grade | null = null;
  let error: string | null = null;
  if (!actualCompleted(initial.publicTest)) error = 'invalid_initial_public';
  else if (!actualCompleted(initial.acceptanceTest) || initial.acceptanceTest.failedTests === 0) error = 'invalid_initial_acceptance';
  else {
    const patch = fresh.assets.entries.find(entry => entry.path === fresh.spec.referencePatch);
    let after: WorkspaceSnapshot | undefined;
    try {
      if (!patch || patch.kind !== 'file' || patch.encoding !== 'utf8') throw new Error('reference patch must be UTF-8');
      after = applyReferencePatch(before, patch.content, fresh.spec.writable);
    } catch { error = 'invalid_reference_patch'; }
    if (after) {
      reference = await grade({ task: fresh, before, after, termination: 'completed', outputDir: join(output, 'reference') });
      if (!reference.passed) error = 'reference_failed';
    }
  }
  const result: PreflightResult = { passed: error === null, taskId: fresh.spec.id, taskHash: fresh.taskHash, initial, reference, error };
  await writeFile(join(output, 'preflight.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}
