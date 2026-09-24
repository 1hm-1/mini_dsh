import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { parseRunConfig } from '../src/config.js';
import { parseRunResult, readJournal } from '../src/journal.js';
import type { Termination } from '../src/types.js';
import { record } from '../src/validation.js';
import { loadTask, type LoadedTask } from './assets.js';
import { verifyFrozenInputs } from './benchmark.js';
import type { AttemptResult, CheckResult, EvalManifest, IntegrityResult } from './contracts.js';
import { inspectJournal, type JournalMetrics } from './journal-metrics.js';
import { applyReferencePatch } from './reference.js';
import { renderReport, summarize } from './report.js';
import { buildSchedule } from './schedule.js';
import { parseEvalConfig, parseTaskId } from './task.js';
import { checkIntegrity, diffSnapshots, type WorkspaceSnapshot } from './workspace.js';

const exec = promisify(execFile);
class EvidenceError extends Error {}
function requireThat(condition: unknown, label: string): asserts condition {
  if (!condition) throw new EvidenceError(label);
}
function equal(actual: unknown, expected: unknown, label: string): void {
  requireThat(isDeepStrictEqual(actual, expected), label);
}
async function section<T>(label: string, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof EvidenceError) throw error;
    throw new EvidenceError(`${label}: invalid or unreadable evidence`);
  }
}
async function ordinary(location: string, kind: 'file' | 'directory'): Promise<void> {
  const absolute = resolve(location);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    requireThat(!stat.isSymbolicLink() && (cursor === absolute && kind === 'file' ? stat.isFile() : stat.isDirectory()), 'artifact path: nonordinary entry');
  }
}
async function bytes(file: string): Promise<Buffer> {
  await ordinary(file, 'file');
  return readFile(file);
}
async function json(file: string): Promise<unknown> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(file))) as unknown;
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function sha(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function commit(value: unknown): value is string { return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value); }

function parseManifest(value: unknown, runRoot: string): EvalManifest {
  const raw = record(value, 'manifest', ['schemaVersion', 'runId', 'phase', 'provider', 'startedAt', 'nodeVersion',
    'implementationCommit', 'dirty', 'benchmarkCommit', 'benchmarkHash', 'config', 'tasks', 'schedule']);
  requireThat(raw.schemaVersion === 1 && raw.runId === basename(runRoot), 'manifest: run identity');
  const config = parseEvalConfig(raw.config);
  equal(config, raw.config, 'manifest: noncanonical config');
  requireThat(isAbsolute(config.outputDir) && resolve(config.outputDir) === dirname(runRoot), 'manifest: output directory');
  requireThat(raw.phase === config.phase && typeof raw.dirty === 'boolean', 'manifest: phase/dirty');
  requireThat(typeof raw.startedAt === 'string' && Number.isFinite(Date.parse(raw.startedAt))
    && typeof raw.nodeVersion === 'string' && /^v\d+\.\d+\.\d+/.test(raw.nodeVersion), 'manifest: time/version');
  requireThat(raw.implementationCommit === null || commit(raw.implementationCommit), 'manifest: implementation commit');
  if (config.phase === 'smoke') {
    requireThat(raw.provider === 'mock' && raw.benchmarkCommit === null && raw.benchmarkHash === null
      && config.benchmarkManifest === null && (raw.implementationCommit !== null || raw.dirty), 'manifest: smoke provenance');
  } else {
    requireThat(raw.provider === 'http' && raw.dirty === false && commit(raw.implementationCommit)
      && commit(raw.benchmarkCommit) && sha(raw.benchmarkHash), 'manifest: frozen provenance');
  }
  requireThat(Array.isArray(raw.tasks) && raw.tasks.length === config.taskIds.length, 'manifest: tasks');
  const ids = new Set<string>();
  const roots = new Set<string>();
  for (const item of raw.tasks) {
    const task = record(item, 'manifest task', ['id', 'suite', 'taskHash', 'root']);
    const id = parseTaskId(task.id);
    requireThat(!ids.has(id) && config.taskIds.includes(id) && (task.suite === 'S' || task.suite === 'H')
      && sha(task.taskHash) && typeof task.root === 'string' && isAbsolute(task.root)
      && resolve(task.root) === task.root && !roots.has(task.root), 'manifest: task metadata');
    ids.add(id); roots.add(task.root);
  }
  equal(raw.schedule, buildSchedule(config.taskIds, config.variants, config.repeats), 'manifest: schedule mismatch');
  return raw as unknown as EvalManifest;
}

/** Check the immutable checker trailer as well as the complete output hash. */
export async function inspectCheck(value: unknown, outputPath: string): Promise<CheckResult> {
  const optionalDuration = value !== null && typeof value === 'object' && Object.hasOwn(value, 'durationMs');
  const raw = record(value, 'check', ['passed', 'exitCode', 'signal', 'timedOut', 'completed', 'passedTests',
    'failedTests', 'testCount', 'outputPath', 'outputHash', ...(optionalDuration ? ['durationMs'] : [])]);
  requireThat(raw.outputPath === outputPath && sha(raw.outputHash), 'check: output identity');
  const contents = await bytes(outputPath);
  requireThat(createHash('sha256').update(contents).digest('hex') === raw.outputHash, 'check: output hash');
  const text = contents.toString('utf8');
  const marker = '\n[check-result] ';
  const at = text.lastIndexOf(marker);
  requireThat(at >= 0 && text.endsWith('\n'), 'check: missing final trailer');
  const body = text.slice(at + marker.length, -1);
  requireThat(!body.includes('\n'), 'check: trailing output');
  const trailer = record(JSON.parse(body), 'check trailer', ['exitCode', 'signal', 'timedOut', 'completed', 'summary',
    ...(optionalDuration ? ['durationMs'] : [])]);
  requireThat(trailer.exitCode === null || nonnegative(trailer.exitCode), 'check: exit code');
  requireThat(trailer.signal === null || typeof trailer.signal === 'string', 'check: signal');
  requireThat(typeof trailer.timedOut === 'boolean' && typeof trailer.completed === 'boolean', 'check: completion');
  if (optionalDuration) requireThat(typeof trailer.durationMs === 'number' && Number.isFinite(trailer.durationMs)
    && trailer.durationMs >= 0, 'check: duration');
  let passed = 0; let failed = 0; let tests = 0; let cancelled = 0; let success = false;
  if (trailer.summary !== null) {
    const summary = record(trailer.summary, 'check summary', ['success', 'counts']);
    requireThat(typeof summary.success === 'boolean', 'check: summary status');
    success = summary.success;
    const counts = record(summary.counts, 'check counts', ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo']);
    requireThat(Object.values(counts).every(nonnegative), 'check: invalid counts');
    tests = counts.tests as number; passed = counts.passed as number; failed = counts.failed as number; cancelled = counts.cancelled as number;
    requireThat(tests === passed + failed + (counts.skipped as number) + (counts.todo as number) && cancelled <= failed,
      'check: inconsistent counts');
  }
  const completed = trailer.summary !== null && !trailer.timedOut;
  equal(trailer.completed, completed, 'check: completion mismatch');
  const expected: CheckResult = {
    passed: completed && trailer.exitCode === 0 && trailer.signal === null && success && passed > 0 && failed === 0 && cancelled === 0,
    exitCode: trailer.exitCode as number | null, signal: trailer.signal as string | null,
    timedOut: trailer.timedOut, completed, passedTests: passed, failedTests: failed, testCount: tests,
    outputPath, outputHash: raw.outputHash,
    ...(optionalDuration ? { durationMs: trailer.durationMs as number } : {}),
  };
  equal(raw, expected, 'check: result disagrees with output trailer');
  return expected;
}

function original(task: LoadedTask): WorkspaceSnapshot {
  const prefix = `${task.spec.workspaceDir}/`;
  return { schemaVersion: 1, entries: task.assets.entries.filter(entry => entry.path.startsWith(prefix))
    .map(entry => ({ ...entry, path: entry.path.slice(prefix.length) })) };
}
function verdict(termination: Termination, integrity: IntegrityResult, publicTest: CheckResult, acceptanceTest: CheckResult) {
  const functionalPass = publicTest.passed && acceptanceTest.passed;
  return { functionalPass, passed: termination === 'completed' && integrity.passed && functionalPass,
    failureReason: termination !== 'completed' ? termination : !integrity.passed ? 'integrity'
      : !publicTest.passed ? 'public_test' : !acceptanceTest.passed ? 'acceptance_test' : null };
}
async function inspectPreflight(task: LoadedTask, directory: string): Promise<void> {
  const raw = record(await json(join(directory, 'preflight.json')), 'preflight', ['passed', 'taskId', 'taskHash', 'initial', 'reference', 'error']);
  requireThat(raw.passed === true && raw.error === null && raw.taskId === task.spec.id && raw.taskHash === task.taskHash, 'preflight: identity/status');
  const before = original(task);
  const patch = task.assets.entries.find(entry => entry.path === task.spec.referencePatch);
  requireThat(patch?.kind === 'file' && patch.encoding === 'utf8', 'preflight: reference asset');
  const after = applyReferencePatch(before, patch.content, task.spec.writable);
  for (const [name, snapshot] of [['initial', before], ['reference', after]] as const) {
    const grade = record(raw[name], 'preflight grade', ['integrity', 'publicTest', 'acceptanceTest', 'functionalPass', 'passed', 'failureReason']);
    const integrity = checkIntegrity(before, snapshot, task.spec.writable);
    equal(grade.integrity, integrity, `preflight ${name}: integrity`);
    const publicTest = await inspectCheck(grade.publicTest, join(directory, name, 'public-output.txt'));
    const acceptanceTest = await inspectCheck(grade.acceptanceTest, join(directory, name, 'acceptance-output.txt'));
    const result = verdict('completed', integrity, publicTest, acceptanceTest);
    equal({ functionalPass: grade.functionalPass, passed: grade.passed, failureReason: grade.failureReason }, result, `preflight ${name}: grading`);
    if (name === 'reference') requireThat(result.passed, 'preflight: reference did not pass');
    else {
      const actual = (check: CheckResult) => check.completed && !check.timedOut && check.signal === null
        && (check.exitCode === 0 || check.exitCode === 1) && check.testCount > 0 && check.passedTests + check.failedTests > 0;
      requireThat(actual(publicTest) && actual(acceptanceTest) && acceptanceTest.failedTests > 0, 'preflight: invalid initial failure');
    }
  }
}

export async function inspectRun(runDir: string): Promise<{ manifest: EvalManifest; attempts: AttemptResult[]; metrics: JournalMetrics[] }> {
  const runRoot = resolve(runDir);
  return section('run', async () => {
    await ordinary(runRoot, 'directory');
    const names = await readdir(runRoot);
    requireThat(!names.includes('error.json') && !names.includes('diagnostic.json'), 'run: stopped or incomplete');
    const manifest = await section('manifest', async () => parseManifest(await json(join(runRoot, 'manifest.json')), runRoot));
    const tasks = new Map<string, LoadedTask>();
    for (const meta of manifest.tasks) {
      await section(`task ${meta.id}`, async () => {
        const task = await loadTask(meta.root);
        requireThat(task.spec.id === meta.id && task.spec.suite === meta.suite && task.taskHash === meta.taskHash, `task ${meta.id}: hash/suite mismatch`);
        tasks.set(meta.id, task);
        await inspectPreflight(task, join(runRoot, 'preflight', meta.id));
      });
    }
    if (manifest.phase !== 'smoke') {
      await section('benchmark provenance', async () => {
        const root = (await exec('git', ['rev-parse', '--show-toplevel'], { cwd: manifest.tasks[0]!.root })).stdout.trim();
        const frozen = await verifyFrozenInputs(manifest.config, root, {
          implementationCommit: manifest.implementationCommit!, benchmarkCommit: manifest.benchmarkCommit!, benchmarkHash: manifest.benchmarkHash!,
        });
        for (const task of frozen) equal(tasks.get(task.spec.id), task, 'benchmark: selected task differs');
      });
    }
    const attemptRoot = join(runRoot, 'attempts');
    await ordinary(attemptRoot, 'directory');
    const expectedNames = manifest.schedule.map(entry => `${entry.taskId}-${entry.variant}-${entry.repeat}`);
    equal((await readdir(attemptRoot)).sort(), [...expectedNames].sort(), 'attempts: missing or unexpected directory');
    const attempts: AttemptResult[] = [];
    const metrics: JournalMetrics[] = [];
    for (const [index, entry] of manifest.schedule.entries()) {
      await section(`attempt ${expectedNames[index]}`, async () => {
        const directory = join(attemptRoot, expectedNames[index]!);
        await ordinary(directory, 'directory');
        const task = tasks.get(entry.taskId)!;
        const paths = { before: join(directory, 'before.json'), after: join(directory, 'after.json'), changes: join(directory, 'changes.json'),
          journal: join(directory, 'journal.jsonl'), result: join(directory, 'result.json'), publicOutput: join(directory, 'public-output.txt'),
          acceptanceOutput: join(directory, 'acceptance-output.txt') };
        const raw = record(await json(paths.result), 'attempt result', ['schemaVersion', 'runId', 'phase', 'implementationCommit', 'benchmarkCommit',
          'taskId', 'suite', 'variant', 'repeat', 'orderIndex', 'taskHash', 'config', 'agent', 'integrity', 'publicTest', 'acceptanceTest', 'passed', 'failureReason', 'artifactPaths']);
        const identity = { schemaVersion: 1, runId: manifest.runId, phase: manifest.phase, implementationCommit: manifest.implementationCommit,
          benchmarkCommit: manifest.benchmarkCommit, taskId: entry.taskId, suite: task.spec.suite, variant: entry.variant,
          repeat: entry.repeat, orderIndex: entry.orderIndex, taskHash: task.taskHash };
        for (const [key, value] of Object.entries(identity)) equal(raw[key], value, `attempt: ${key} mismatch`);
        equal(raw.artifactPaths, paths, 'attempt: artifact paths');
        const config = parseRunConfig(raw.config);
        equal(config, { schemaVersion: 1, variant: entry.variant, model: manifest.config.model, budget: manifest.config.budget,
          context: manifest.config.context, workspace: join(directory, '.workspace'), writable: task.spec.writable, sessionPath: paths.journal }, 'attempt: shared config');
        const before = await json(paths.before) as WorkspaceSnapshot;
        const after = await json(paths.after) as WorkspaceSnapshot;
        equal(before, original(task), 'snapshot: before differs from task');
        equal(await json(paths.changes), diffSnapshots(before, after), 'snapshot: changes mismatch');
        const integrity = checkIntegrity(before, after, task.spec.writable);
        equal(raw.integrity, integrity, 'snapshot: integrity mismatch');
        const publicTest = await inspectCheck(raw.publicTest, paths.publicOutput);
        const acceptanceTest = await inspectCheck(raw.acceptanceTest, paths.acceptanceOutput);
        const agent = parseRunResult(raw.agent);
        const score = verdict(agent.termination, integrity, publicTest, acceptanceTest);
        equal(raw.passed, score.passed, 'attempt: passed mismatch');
        equal(raw.failureReason, score.failureReason, 'attempt: failure reason mismatch');
        await ordinary(paths.journal, 'file');
        const journal = await readJournal(paths.journal);
        equal(journal.events[0]?.data, { input: task.prompt }, 'journal: task input mismatch');
        const measured = inspectJournal(journal, config);
        equal(measured.result, agent, 'journal: result mismatch');
        metrics.push(measured);
        attempts.push(raw as unknown as AttemptResult);
      });
    }
    return { manifest, attempts, metrics };
  });
}

/** Read-only: does not call a model, rerun tests, repair logs, or rewrite a report. */
export async function verify(runDir: string): Promise<{ passed: boolean; errors: string[] }> {
  try {
    const inspected = await inspectRun(runDir);
    const summary = summarize(inspected.manifest, inspected.attempts, inspected.metrics);
    equal(await json(join(resolve(runDir), 'summary.json')), summary, 'summary: recomputation mismatch');
    equal((await bytes(join(resolve(runDir), 'report.md'))).toString('utf8'), renderReport(inspected.manifest, summary), 'report: recomputation mismatch');
    return { passed: true, errors: [] };
  } catch (error) {
    return { passed: false, errors: [error instanceof EvidenceError ? error.message : 'run: invalid or unreadable evidence'] };
  }
}
