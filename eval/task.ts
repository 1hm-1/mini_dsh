import { parseBudget, parseContextConfig, parseModelConfig, parseVariant } from '../src/config.js';
import type { Variant } from '../src/types.js';
import { positiveInteger, record, relativePath, string, uniqueStrings } from '../src/validation.js';
import type { EvalConfig, ExperimentPhase, TaskSpec } from './contracts.js';

export function parseTaskId(value: unknown, name = 'task.id'): string {
  const id = string(value, name);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error(`${name}: invalid ID`);
  return id;
}

export function parseTaskSpec(value: unknown): TaskSpec {
  const input = record(value, 'task', ['schemaVersion', 'id', 'suite', 'category', 'promptFile', 'workspaceDir', 'writable', 'publicTest', 'acceptanceTest', 'referencePatch', 'testTimeoutMs']);
  if (input.schemaVersion !== 1) throw new Error('task.schemaVersion: expected 1');
  if (input.suite !== 'S' && input.suite !== 'H') throw new Error('task.suite: invalid value');
  if (input.category !== 'bug-fix' && input.category !== 'feature' && input.category !== 'multi-file') throw new Error('task.category: invalid value');
  const publicTest = relativePath(input.publicTest, 'task.publicTest');
  const acceptanceTest = relativePath(input.acceptanceTest, 'task.acceptanceTest');
  if (!publicTest.endsWith('.mjs') || !acceptanceTest.endsWith('.mjs')) throw new Error('task tests: expected .mjs files');
  const writable = uniqueStrings(input.writable, 'task.writable', relativePath, true);
  if (writable.includes(publicTest)) throw new Error('task.writable: publicTest is protected');
  return {
    schemaVersion: 1,
    id: parseTaskId(input.id),
    suite: input.suite,
    category: input.category,
    promptFile: relativePath(input.promptFile, 'task.promptFile'),
    workspaceDir: relativePath(input.workspaceDir, 'task.workspaceDir'),
    writable,
    publicTest,
    acceptanceTest,
    referencePatch: relativePath(input.referencePatch, 'task.referencePatch'),
    testTimeoutMs: positiveInteger(input.testTimeoutMs, 'task.testTimeoutMs'),
  };
}

function parsePhase(value: unknown): ExperimentPhase {
  if (value !== 'baseline-diagnostic' && value !== 'ablation' && value !== 'comparison' && value !== 'smoke') throw new Error('eval.phase: invalid value');
  return value;
}

export function parseEvalConfig(value: unknown): EvalConfig {
  const input = record(value, 'eval', ['schemaVersion', 'phase', 'benchmarkManifest', 'taskIds', 'variants', 'repeats', 'model', 'budget', 'context', 'outputDir']);
  if (input.schemaVersion !== 1) throw new Error('eval.schemaVersion: expected 1');
  const phase = parsePhase(input.phase);
  const taskIds = uniqueStrings(input.taskIds, 'eval.taskIds', parseTaskId);
  const variants = uniqueStrings(input.variants, 'eval.variants', parseVariant) as Variant[];
  const matches = (required: Variant[]) => variants.length === required.length && required.every(item => variants.includes(item));
  if (phase === 'baseline-diagnostic' && !matches(['baseline'])
    || phase === 'ablation' && !matches(['baseline', 'context', 'optimizer', 'full'])
    || phase === 'comparison' && !matches(['baseline', 'full'])) throw new Error('eval.variants: invalid phase matrix');
  if (input.benchmarkManifest === null && phase !== 'smoke') throw new Error('eval.benchmarkManifest: required');
  const benchmarkManifest = input.benchmarkManifest === null ? null : relativePath(input.benchmarkManifest, 'eval.benchmarkManifest');
  return {
    schemaVersion: 1,
    phase,
    benchmarkManifest,
    taskIds,
    variants,
    repeats: positiveInteger(input.repeats, 'eval.repeats'),
    model: parseModelConfig(input.model),
    budget: parseBudget(input.budget),
    context: parseContextConfig(input.context),
    outputDir: string(input.outputDir, 'eval.outputDir'),
  };
}
