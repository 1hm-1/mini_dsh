import { randomUUID } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeOptions } from '../src/runtime.js';
import { loadEvaluationInputs } from './benchmark.js';
import type { AttemptResult, EvalManifest } from './contracts.js';
import { runAttempt } from './attempt.js';
import { preflight } from './preflight.js';
import { buildSchedule } from './schedule.js';
import { parseEvalConfig } from './task.js';
import { writeRunReport } from './finalize.js';

function inside(parent: string, child: string): boolean {
  const offset = relative(parent, child);
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

async function ordinaryOrCreate(location: string): Promise<void> {
  const absolute = resolve(location);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { await mkdir(cursor); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = await lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('run output: symlink or non-directory parent');
    }
  }
}

function validateOutput(outputDir: string, projectRoot: string): string {
  if (outputDir.length === 0 || outputDir.includes('\0')) throw new Error('eval.outputDir: invalid path');
  const output = resolve(projectRoot, outputDir);
  return output;
}

export async function runEvaluation(config: unknown, options: {
  projectRoot?: string;
  smokeTaskRoot?: string;
  modelPlugin?: RuntimeOptions['modelPlugin'];
  signal?: AbortSignal;
} = {}): Promise<{ runId: string; runRoot: string; manifest: EvalManifest; attempts: AttemptResult[] }> {
  // Parse and copy caller-owned inputs before the first await.
  const parsed = parseEvalConfig(config);
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || options.projectRoot !== undefined && typeof options.projectRoot !== 'string'
    || options.smokeTaskRoot !== undefined && typeof options.smokeTaskRoot !== 'string'
    || options.modelPlugin !== undefined && typeof options.modelPlugin !== 'function'
    || options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new Error('invalid evaluation options');
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  if (parsed.phase !== 'smoke' && projectRoot !== resolve(fileURLToPath(new URL('../', import.meta.url)))) {
    throw new Error('eval projectRoot: must be the runner project');
  }
  const smokeTaskRoot = options.smokeTaskRoot === undefined ? undefined : resolve(options.smokeTaskRoot);
  const modelPlugin = options.modelPlugin;
  const signal = options.signal;
  if (parsed.variants.some(variant => variant !== 'baseline' && variant !== 'context')) {
    throw new Error('eval variant: only baseline and context are implemented');
  }
  if (parsed.phase === 'smoke' && !modelPlugin || parsed.phase !== 'smoke' && modelPlugin) {
    throw new Error('eval provider: smoke requires mock model; other phases require HTTP');
  }
  if (parsed.phase !== 'smoke' && !process.env.HARNESS_API_KEY) throw new Error('HARNESS_API_KEY is required');
  const outputDir = validateOutput(parsed.outputDir, projectRoot);
  const actualConfig = { ...parsed, outputDir };
  const loaded = await loadEvaluationInputs(actualConfig, projectRoot, smokeTaskRoot);
  const schedule = buildSchedule(loaded.tasks.map(task => task.spec.id), parsed.variants, parsed.repeats);
  const taskById = new Map(loaded.tasks.map(task => [task.spec.id, task]));
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const runRoot = join(outputDir, runId);
  for (const task of loaded.tasks) if (inside(task.root, runRoot) || inside(runRoot, task.root)) {
    throw new Error('run output: overlaps task package');
  }
  await ordinaryOrCreate(outputDir);
  await mkdir(runRoot); // exclusive; no resume or overwrite
  let stage = 'preflight';
  try {
    await mkdir(join(runRoot, 'preflight'));
    for (const task of loaded.tasks) {
      const result = await preflight(task, join(runRoot, 'preflight', task.spec.id));
      if (!result.passed) throw new Error(`preflight failed: ${task.spec.id}`);
    }
    const checked = await loadEvaluationInputs(actualConfig, projectRoot, smokeTaskRoot);
    if (checked.implementationCommit !== loaded.implementationCommit
      || parsed.phase !== 'smoke' && checked.dirty !== loaded.dirty
      || checked.benchmarkCommit !== loaded.benchmarkCommit || checked.benchmarkHash !== loaded.benchmarkHash
      || JSON.stringify(checked.tasks.map(task => [task.root, task.taskHash]))
        !== JSON.stringify(loaded.tasks.map(task => [task.root, task.taskHash]))) {
      throw new Error('preflight: task or implementation changed');
    }
    const manifest: EvalManifest = {
      schemaVersion: 1, runId, phase: parsed.phase, provider: modelPlugin ? 'mock' : 'http',
      startedAt: new Date().toISOString(), nodeVersion: process.version,
      implementationCommit: checked.implementationCommit, dirty: checked.dirty,
      benchmarkCommit: checked.benchmarkCommit, benchmarkHash: checked.benchmarkHash,
      config: actualConfig,
      tasks: loaded.tasks.map(task => ({ id: task.spec.id, suite: task.spec.suite, taskHash: task.taskHash, root: task.root })),
      schedule,
    };
    stage = 'manifest';
    await writeFile(join(runRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    const attempts: AttemptResult[] = [];
    stage = 'attempt';
    for (const entry of schedule) {
      const task = taskById.get(entry.taskId);
      if (!task) throw new Error('schedule task missing');
      attempts.push(await runAttempt({ task, config: actualConfig, entry, runId, runRoot,
        implementationCommit: loaded.implementationCommit, benchmarkCommit: loaded.benchmarkCommit,
        ...(modelPlugin ? { modelPlugin } : {}), ...(signal ? { signal } : {}),
      }));
    }
    stage = 'report';
    await writeRunReport(runRoot);
    return { runId, runRoot, manifest, attempts };
  } catch (error) {
    await writeFile(join(runRoot, 'error.json'), `${JSON.stringify({ schemaVersion: 1, stage, code: 'evaluation_failed' }, null, 2)}\n`, { flag: 'wx' });
    throw error;
  }
}
