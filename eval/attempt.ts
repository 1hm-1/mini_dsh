import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { createRuntime, type RuntimeOptions } from '../src/runtime.js';
import type { RunConfig } from '../src/types.js';
import { materialize, type LoadedTask } from './assets.js';
import type { AttemptResult, EvalConfig, ScheduleEntry } from './contracts.js';
import { grade } from './judge.js';
import { diffSnapshots, snapshotWorkspace } from './workspace.js';
import { parseEvalConfig, parseTaskId } from './task.js';

function inside(parent: string, child: string): boolean {
  const offset = relative(parent, child);
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

async function assertOrdinaryDirectory(location: string): Promise<void> {
  const absolute = resolve(location);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('attempt path: expected ordinary directory');
  }
}

function saveJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

export async function runAttempt(options: {
  task: LoadedTask;
  config: EvalConfig;
  entry: ScheduleEntry;
  runId: string;
  runRoot: string;
  implementationCommit: string | null;
  benchmarkCommit: string | null;
  modelPlugin?: RuntimeOptions['modelPlugin'];
  signal?: AbortSignal;
}): Promise<AttemptResult> {
  const task = options.task;
  const config = parseEvalConfig(options.config);
  const entry = { ...options.entry };
  const runId = options.runId;
  const implementationCommit = options.implementationCommit;
  const benchmarkCommit = options.benchmarkCommit;
  const modelPlugin = options.modelPlugin;
  const signal = options.signal;
  parseTaskId(entry.taskId, 'attempt taskId');
  if (entry.taskId !== task.spec.id || !config.taskIds.includes(entry.taskId)
    || !config.variants.includes(entry.variant) || !Number.isSafeInteger(entry.repeat) || entry.repeat < 1 || entry.repeat > config.repeats
    || !Number.isSafeInteger(entry.orderIndex) || entry.orderIndex < 0) throw new Error('attempt entry: invalid');
  if (typeof runId !== 'string' || !runId || implementationCommit !== null && typeof implementationCommit !== 'string'
    || benchmarkCommit !== null && typeof benchmarkCommit !== 'string'
    || signal !== undefined && !(signal instanceof AbortSignal)
    || modelPlugin !== undefined && typeof modelPlugin !== 'function') throw new Error('attempt options: invalid');
  if (config.phase !== 'smoke' && modelPlugin || config.phase === 'smoke' && !modelPlugin) {
    throw new Error('attempt provider: mock only for smoke and required for smoke');
  }
  const runRoot = resolve(options.runRoot);
  const attemptDir = join(runRoot, 'attempts', `${entry.taskId}-${entry.variant}-${entry.repeat}`);
  if (inside(task.root, attemptDir) || inside(attemptDir, task.root)) throw new Error('attempt path: overlaps task package');
  await assertOrdinaryDirectory(runRoot);
  const attemptsDir = join(runRoot, 'attempts');
  try { await mkdir(attemptsDir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await assertOrdinaryDirectory(attemptsDir);
  }
  await mkdir(attemptDir); // exclusive: never overwrite an earlier attempt
  const workspace = join(attemptDir, '.workspace');
  const paths = {
    before: join(attemptDir, 'before.json'), after: join(attemptDir, 'after.json'),
    changes: join(attemptDir, 'changes.json'), journal: join(attemptDir, 'journal.jsonl'),
    result: join(attemptDir, 'result.json'), publicOutput: join(attemptDir, 'public-output.txt'),
    acceptanceOutput: join(attemptDir, 'acceptance-output.txt'),
  };
  const runConfig: RunConfig = {
    schemaVersion: 1, variant: entry.variant, model: { ...config.model }, budget: { ...config.budget },
    context: { ...config.context }, workspace, writable: [...task.spec.writable], sessionPath: paths.journal,
  };
  const { before } = await materialize(task, workspace);
  await saveJson(paths.before, before);
  const runtime = await createRuntime(runConfig, {
    ...(modelPlugin ? { modelPlugin } : {}),
    ...(signal ? { signal } : {}),
  });
  let agent;
  try { agent = await runtime.run(task.prompt); }
  finally { await runtime.dispose(); }
  const after = await snapshotWorkspace(workspace);
  await saveJson(paths.after, after);
  await saveJson(paths.changes, diffSnapshots(before, after));
  const gradeResult = await grade({ task, before, after, termination: agent.termination, outputDir: join(attemptDir, 'checks') });
  await copyFile(gradeResult.publicTest.outputPath, paths.publicOutput, constants.COPYFILE_EXCL);
  await copyFile(gradeResult.acceptanceTest.outputPath, paths.acceptanceOutput, constants.COPYFILE_EXCL);
  await unlink(gradeResult.publicTest.outputPath);
  await unlink(gradeResult.acceptanceTest.outputPath);
  gradeResult.publicTest.outputPath = paths.publicOutput;
  gradeResult.acceptanceTest.outputPath = paths.acceptanceOutput;
  const result: AttemptResult = {
    schemaVersion: 1, runId, phase: config.phase,
    implementationCommit, benchmarkCommit,
    taskId: task.spec.id, suite: task.spec.suite, variant: entry.variant, repeat: entry.repeat,
    orderIndex: entry.orderIndex, taskHash: task.taskHash, config: runConfig,
    agent, integrity: gradeResult.integrity, publicTest: gradeResult.publicTest,
    acceptanceTest: gradeResult.acceptanceTest, passed: gradeResult.passed,
    failureReason: gradeResult.failureReason, artifactPaths: paths,
  };
  await saveJson(paths.result, result);
  await rm(workspace, { recursive: true });
  return result;
}
