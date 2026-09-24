import { isDeepStrictEqual } from 'node:util';
import type { Variant } from '../src/types.js';
import { parseRunConfig } from '../src/config.js';
import type { AttemptResult, EvalManifest } from './contracts.js';
import type { JournalMetrics, RequestMetric } from './journal-metrics.js';
import { buildSchedule } from './schedule.js';
import { parseEvalConfig } from './task.js';

export interface ScalarStats { count: number; mean: number | null; median: number | null; peak: number | null }
export interface DurationStats extends ScalarStats { knownCount: number; unknownCount: number; knownSum: number; sum: number | null }
export interface TokenStat { total: number | null; known: number; knownRequests: number; dispatchedRequests: number; completeness: number | null }
export interface GroupSummary {
  success: { passed: number; count: number; rate: number | null };
  requests: { total: number; worker: number; optimizer: number; summary: number };
  tools: { calls: number; errors: number };
  tokens: { input: TokenStat; output: TokenStat; combined: TokenStat; completeUsageRequests: number };
  latencyMs: ScalarStats;
  publicCheckDurationMs: DurationStats;
  acceptanceCheckDurationMs: DurationStats;
  context: { workerRequests: number; requestChars: ScalarStats; estimatedInputTokens: ScalarStats;
    preCompressionEstimatedTokens: ScalarStats; olderRounds: ScalarStats;
    thresholdRequests: number; eligibleCompactionRequests: number };
  compactions: number;
  termination: Record<string, number>;
  failureReason: Record<string, number>;
  actualModels: string[];
  fingerprints: string[];
}
export type SuiteSummary = { S: GroupSummary; H: GroupSummary; overall: GroupSummary };
export interface Summary {
  schemaVersion: 1;
  runId: string;
  phase: EvalManifest['phase'];
  provider: EvalManifest['provider'];
  sampleCount: number;
  byVariant: Partial<Record<Variant, SuiteSummary>>;
  overall: SuiteSummary;
  fullMinusBaselinePercentagePoints: { S: number | null; H: number | null; overall: number | null };
}

function stats(values: readonly number[]): ScalarStats {
  if (!values.length) return { count: 0, mean: null, median: null, peak: null };
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: ordered.length % 2 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2,
    peak: ordered[ordered.length - 1]! };
}
function duration(values: readonly (number | null)[]): DurationStats {
  const known = values.filter((value): value is number => value !== null);
  const knownSum = known.reduce((a, b) => a + b, 0);
  return { ...stats(known), knownCount: known.length, unknownCount: values.length - known.length,
    knownSum, sum: known.length === values.length ? knownSum : null };
}
function checkDuration(check: AttemptResult['publicTest']): number | null {
  const value = (check as typeof check & { durationMs?: unknown }).durationMs;
  if (value === undefined) return null; // old evidence predates wall-clock check timing
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('report: invalid check duration');
  return value;
}
function token(values: readonly (number | null)[]): TokenStat {
  const known = values.filter((value): value is number => value !== null);
  return { total: known.length === values.length ? known.reduce((a, b) => a + b, 0) : null,
    known: known.reduce((a, b) => a + b, 0), knownRequests: known.length,
    dispatchedRequests: values.length, completeness: values.length ? known.length / values.length : null };
}
function distribution(values: readonly (string | null)[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? 'none';
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function group(attempts: readonly AttemptResult[], metrics: readonly JournalMetrics[]): GroupSummary {
  const requests = metrics.flatMap(item => item.requests);
  const workers = requests.filter(item => item.kind === 'worker');
  const numeric = (values: readonly (number | null)[]): number[] => values.filter((value): value is number => value !== null);
  const input = token(requests.map(item => item.inputTokens));
  const output = token(requests.map(item => item.outputTokens));
  const combined = token(requests.map(item => item.inputTokens === null || item.outputTokens === null ? null : item.inputTokens + item.outputTokens));
  combined.known = input.known + output.known;
  const passed = attempts.filter(item => item.passed).length;
  return {
    success: { passed, count: attempts.length, rate: attempts.length ? passed / attempts.length : null },
    requests: { total: requests.length, worker: workers.length,
      optimizer: requests.filter(item => item.kind === 'optimizer').length,
      summary: requests.filter(item => item.kind === 'summary').length },
    tools: { calls: attempts.reduce((sum, item) => sum + item.agent.toolCalls, 0),
      errors: attempts.reduce((sum, item) => sum + item.agent.toolErrors, 0) },
    tokens: { input, output, combined, completeUsageRequests: combined.knownRequests },
    latencyMs: stats(attempts.map(item => item.agent.durationMs)),
    publicCheckDurationMs: duration(attempts.map(item => checkDuration(item.publicTest))),
    acceptanceCheckDurationMs: duration(attempts.map(item => checkDuration(item.acceptanceTest))),
    context: { workerRequests: workers.length, requestChars: stats(workers.map(item => item.requestChars)),
      estimatedInputTokens: stats(workers.map(item => item.estimatedInputTokens)),
      preCompressionEstimatedTokens: stats(numeric(workers.map(item => item.preCompressionEstimatedTokens))),
      olderRounds: stats(numeric(workers.map(item => item.olderRounds))),
      thresholdRequests: workers.filter(item => item.thresholdReached === true).length,
      eligibleCompactionRequests: workers.filter(item => item.compactionEligible === true).length },
    compactions: attempts.reduce((sum, item) => sum + item.agent.compactions, 0),
    termination: distribution(attempts.map(item => item.agent.termination)),
    failureReason: distribution(attempts.filter(item => !item.passed).map(item => item.failureReason)),
    actualModels: [...new Set(requests.map(item => item.actualModel).filter((value): value is string => value !== null))].sort(),
    fingerprints: [...new Set(requests.map(item => item.fingerprint).filter((value): value is string => value !== null))].sort(),
  };
}
function suite(attempts: readonly AttemptResult[], metrics: readonly JournalMetrics[]): SuiteSummary {
  const select = (suite: 'S' | 'H'): [AttemptResult[], JournalMetrics[]] => {
    const selected: AttemptResult[] = []; const selectedMetrics: JournalMetrics[] = [];
    attempts.forEach((item, index) => { if (item.suite === suite) { selected.push(item); selectedMetrics.push(metrics[index]!); } });
    return [selected, selectedMetrics];
  };
  const [sAttempts, sMetrics] = select('S');
  const [hAttempts, hMetrics] = select('H');
  return { S: group(sAttempts, sMetrics), H: group(hAttempts, hMetrics), overall: group(attempts, metrics) };
}
function validate(manifest: EvalManifest, attempts: readonly AttemptResult[], metrics: readonly JournalMetrics[]): void {
  if (!Array.isArray(attempts) || !Array.isArray(metrics) || attempts.length !== manifest.schedule.length || metrics.length !== attempts.length) {
    throw new Error('report: incomplete attempt or metrics schedule');
  }
  if (manifest.schemaVersion !== 1 || manifest.config.phase !== manifest.phase || !manifest.runId) throw new Error('report: invalid manifest');
  parseEvalConfig(manifest.config); // also enforces the phase-specific variant matrix
  if (manifest.provider !== (manifest.phase === 'smoke' ? 'mock' : 'http')) throw new Error('report: provider/phase mismatch');
  if (!isDeepStrictEqual(manifest.schedule, buildSchedule(manifest.config.taskIds, manifest.config.variants, manifest.config.repeats))) {
    throw new Error('report: manifest schedule does not match selected matrix');
  }
  if (manifest.tasks.length !== manifest.config.taskIds.length || new Set(manifest.tasks.map(task => task.id)).size !== manifest.tasks.length
    || !isDeepStrictEqual([...manifest.tasks.map(task => task.id)].sort(), [...manifest.config.taskIds].sort())) throw new Error('report: task selection mismatch');
  const taskById = new Map(manifest.tasks.map(task => [task.id, task]));
  attempts.forEach((item, index) => {
    const entry = manifest.schedule[index]!;
    const task = taskById.get(entry.taskId);
    if (!task || item.schemaVersion !== 1 || item.runId !== manifest.runId || item.phase !== manifest.phase
      || item.implementationCommit !== manifest.implementationCommit || item.benchmarkCommit !== manifest.benchmarkCommit
      || item.taskId !== entry.taskId || item.suite !== task.suite || item.taskHash !== task.taskHash
      || item.variant !== entry.variant || item.repeat !== entry.repeat || item.orderIndex !== entry.orderIndex
      || item.config.schemaVersion !== 1 || item.config.variant !== entry.variant
      || !isDeepStrictEqual(item.config.model, manifest.config.model)
      || !isDeepStrictEqual(item.config.budget, manifest.config.budget)
      || !isDeepStrictEqual(item.config.context, manifest.config.context)) throw new Error(`report: mixed or invalid attempt ${index}`);
    parseRunConfig(item.config);
    const expectedPassed = item.agent.termination === 'completed' && item.integrity.passed
      && item.publicTest.passed && item.acceptanceTest.passed;
    const expectedReason = item.agent.termination !== 'completed' ? item.agent.termination
      : !item.integrity.passed ? 'integrity'
      : !item.publicTest.passed ? 'public_test'
      : !item.acceptanceTest.passed ? 'acceptance_test' : null;
    if (item.passed !== expectedPassed || item.failureReason !== expectedReason) {
      throw new Error(`report: grade mismatch ${index}`);
    }
    const metric = metrics[index]!;
    if (!isDeepStrictEqual(metric.result, item.agent)) throw new Error(`report: journal result mismatch ${index}`);
    const requests: readonly RequestMetric[] = metric.requests;
    const count = (kind: RequestMetric['kind']) => requests.filter(request => request.kind === kind).length;
    if (requests.length !== item.agent.modelRequests || count('worker') !== item.agent.workerRequests
      || count('optimizer') !== item.agent.optimizerRequests || count('summary') !== item.agent.summaryRequests
      || metric.inputKnownRequests !== requests.filter(request => request.inputTokens !== null).length
      || metric.outputKnownRequests !== requests.filter(request => request.outputTokens !== null).length
      || metric.completeUsageRequests !== requests.filter(request => request.inputTokens !== null && request.outputTokens !== null).length
      || item.agent.knownInputTokens !== requests.reduce((sum, request) => sum + (request.inputTokens ?? 0), 0)
      || item.agent.knownOutputTokens !== requests.reduce((sum, request) => sum + (request.outputTokens ?? 0), 0)) {
      throw new Error(`report: journal counters mismatch ${index}`);
    }
  });
}

export function summarize(manifest: EvalManifest, attempts: readonly AttemptResult[], metrics: readonly JournalMetrics[]): Summary {
  validate(manifest, attempts, metrics);
  const byVariant: Summary['byVariant'] = {};
  for (const variant of manifest.config.variants) {
    const selected: AttemptResult[] = []; const selectedMetrics: JournalMetrics[] = [];
    attempts.forEach((item, index) => { if (item.variant === variant) { selected.push(item); selectedMetrics.push(metrics[index]!); } });
    byVariant[variant] = suite(selected, selectedMetrics);
  }
  const overall = suite(attempts, metrics);
  const delta = (level: keyof SuiteSummary): number | null => {
    const baseline = byVariant.baseline?.[level].success.rate;
    const full = byVariant.full?.[level].success.rate;
    return baseline == null || full == null ? null : (full - baseline) * 100;
  };
  return { schemaVersion: 1, runId: manifest.runId, phase: manifest.phase, provider: manifest.provider,
    sampleCount: attempts.length, byVariant, overall,
    fullMinusBaselinePercentagePoints: { S: delta('S'), H: delta('H'), overall: delta('overall') } };
}

function format(value: number | null): string { return value === null ? 'unknown' : Number.isInteger(value) ? String(value) : value.toFixed(2); }
function stat(value: ScalarStats): string { return `${format(value.mean)} / ${format(value.median)} / ${format(value.peak)} (n=${value.count})`; }
function tokens(value: TokenStat): string { return `${format(value.total)} (known ${value.known}; ${value.knownRequests}/${value.dispatchedRequests}, completeness ${value.completeness === null ? 'unknown' : `${(value.completeness * 100).toFixed(1)}%`})`; }
export function renderReport(manifest: EvalManifest, summary: Summary): string {
  if (summary.runId !== manifest.runId || summary.phase !== manifest.phase || summary.provider !== manifest.provider) throw new Error('report: summary identity mismatch');
  const lines = [
    `# Evaluation report: ${manifest.runId}`,
    '',
    `Provider: **${manifest.provider === 'mock' ? 'mock (engineering validation; no real-model performance claim)' : 'HTTP'}**. Phase: **${manifest.phase}**.`,
    `Selected tasks: ${manifest.config.taskIds.join(', ')}; variants: ${manifest.config.variants.join(', ')}; repeats: ${manifest.config.repeats}; samples: ${summary.sampleCount}.`,
    `Implementation commit: ${manifest.implementationCommit ?? 'unknown'}; dirty: ${manifest.dirty}; benchmark commit: ${manifest.benchmarkCommit ?? 'unknown'}; benchmark hash: ${manifest.benchmarkHash ?? 'unknown'}.`,
    `Started at: ${manifest.startedAt}; Node: ${manifest.nodeVersion}.`,
    `Configured model: ${manifest.config.model.id}; endpoint: ${manifest.config.model.endpoint}; temperature: ${manifest.config.model.temperature}; budget: ${JSON.stringify(manifest.config.budget)}; context: ${JSON.stringify(manifest.config.context)}.`,
    '',
    '| Variant | Suite | Success | Rate | Full − baseline (pp) | Requests total / worker / optimizer / summary | Tools calls / errors |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
  ];
  for (const [variant, suites] of [...Object.entries(summary.byVariant), ['all', summary.overall] as const]) {
    for (const level of ['S', 'H', 'overall'] as const) {
      const item = suites[level];
      const delta = variant === 'full' ? summary.fullMinusBaselinePercentagePoints[level] : null;
      lines.push(`| ${variant} | ${level} | ${item.success.passed}/${item.success.count} | ${item.success.rate === null ? 'unknown' : `${(item.success.rate * 100).toFixed(1)}%`} | ${format(delta)} | ${item.requests.total} / ${item.requests.worker} / ${item.requests.optimizer} / ${item.requests.summary} | ${item.tools.calls} / ${item.tools.errors} |`);
    }
  }
  lines.push('', 'All costs include failed attempts and auxiliary requests. Token totals become unknown when any dispatched request lacks that usage field; known portions and completeness remain visible. Zero dispatched requests have total 0 and completeness unknown.', '');
  for (const [variant, suites] of [...Object.entries(summary.byVariant), ['all', summary.overall] as const]) {
    for (const level of ['S', 'H', 'overall'] as const) {
      const item = suites[level];
      lines.push(`## ${variant} / ${level}`, '',
        `Tokens input: ${tokens(item.tokens.input)}; output: ${tokens(item.tokens.output)}; combined: ${tokens(item.tokens.combined)}.`,
        `Agent latency ms mean / median / peak: ${stat(item.latencyMs)}.`,
        `Public check duration ms mean / median / peak: ${stat(item.publicCheckDurationMs)}; known ${item.publicCheckDurationMs.knownCount}, unknown ${item.publicCheckDurationMs.unknownCount}, known sum ${format(item.publicCheckDurationMs.knownSum)}; total ${format(item.publicCheckDurationMs.sum)}.`,
        `Acceptance check duration ms mean / median / peak: ${stat(item.acceptanceCheckDurationMs)}; known ${item.acceptanceCheckDurationMs.knownCount}, unknown ${item.acceptanceCheckDurationMs.unknownCount}, known sum ${format(item.acceptanceCheckDurationMs.knownSum)}; total ${format(item.acceptanceCheckDurationMs.sum)}.`,
        `Worker context request chars mean / median / peak: ${stat(item.context.requestChars)}; estimated input tokens: ${stat(item.context.estimatedInputTokens)}; precompression estimate: ${stat(item.context.preCompressionEstimatedTokens)}; older rounds: ${stat(item.context.olderRounds)}.`,
        `Threshold requests: ${item.context.thresholdRequests}; compaction eligible: ${item.context.eligibleCompactionRequests}; compactions: ${item.compactions}.`,
        `Termination: ${JSON.stringify(item.termination)}; failure reasons: ${JSON.stringify(item.failureReason)}.`,
        `Actual models: ${JSON.stringify(item.actualModels)}; fingerprints: ${JSON.stringify(item.fingerprints)}.`, '');
    }
  }
  if (summary.overall.overall.compactions === 0) lines.push('Zero compactions: this run provides no evidence about the effect of active compression.', '');
  return `${lines.join('\n')}\n`;
}
