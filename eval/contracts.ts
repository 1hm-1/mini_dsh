import type { Budget, ContextConfig, ModelConfig, RunConfig, RunResult, Variant } from '../src/types.js';

export type ExperimentPhase = 'baseline-diagnostic' | 'ablation' | 'comparison' | 'smoke';
export interface TaskSpec {
  schemaVersion: 1;
  id: string;
  suite: 'S' | 'H';
  category: 'bug-fix' | 'feature' | 'multi-file';
  promptFile: string;
  workspaceDir: string;
  writable: string[];
  publicTest: string;
  acceptanceTest: string;
  referencePatch: string;
  testTimeoutMs: number;
}
export interface EvalConfig {
  schemaVersion: 1;
  phase: ExperimentPhase;
  benchmarkManifest: string | null;
  taskIds: string[];
  variants: Variant[];
  repeats: number;
  model: ModelConfig;
  budget: Budget;
  context: ContextConfig;
  outputDir: string;
}
export interface CheckResult {
  /** Wall time of the external check; absent only in older evidence. */
  durationMs?: number;
  passed: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  completed: boolean;
  passedTests: number;
  failedTests: number;
  testCount: number;
  outputPath: string;
  outputHash: string;
}
export interface IntegrityResult { passed: boolean; changedPaths: string[]; violations: string[] }
export interface AttemptResult {
  schemaVersion: 1;
  runId: string;
  phase: ExperimentPhase;
  implementationCommit: string | null;
  benchmarkCommit: string | null;
  taskId: string;
  suite: TaskSpec['suite'];
  variant: Variant;
  repeat: number;
  orderIndex: number;
  taskHash: string;
  config: RunConfig;
  agent: RunResult;
  integrity: IntegrityResult;
  publicTest: CheckResult;
  acceptanceTest: CheckResult;
  passed: boolean;
  failureReason: string | null;
  artifactPaths: Record<string, string>;
}
export interface BenchmarkManifest {
  schemaVersion: 1;
  benchmarkVersion: 'v1';
  tasks: { id: string; suite: TaskSpec['suite']; path: string; taskHash: string }[];
}
export interface ScheduleEntry {
  taskId: string;
  variant: Variant;
  repeat: number;
  orderIndex: number;
}
export interface EvalManifest {
  schemaVersion: 1;
  runId: string;
  phase: ExperimentPhase;
  provider: 'http' | 'mock';
  startedAt: string;
  nodeVersion: string;
  implementationCommit: string | null;
  dirty: boolean;
  benchmarkCommit: string | null;
  benchmarkHash: string | null;
  config: EvalConfig;
  tasks: { id: string; suite: TaskSpec['suite']; taskHash: string; root: string }[];
  schedule: ScheduleEntry[];
}
