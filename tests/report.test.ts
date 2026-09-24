import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttemptResult, EvalManifest, CheckResult } from '../eval/contracts.js';
import type { JournalMetrics, RequestMetric } from '../eval/journal-metrics.js';
import { summarize, renderReport } from '../eval/report.js';
import { buildSchedule } from '../eval/schedule.js';
import type { RunResult } from '../src/types.js';

const config: EvalManifest['config'] = {
  schemaVersion: 1, phase: 'smoke', benchmarkManifest: null, taskIds: ['a','b','c','d'],
  variants: ['baseline','full'], repeats: 1,
  model: { endpoint: 'https://example.test', id: 'configured', temperature: 0 },
  budget: { maxModelRequests: 16, maxToolCalls: 24, timeoutMs: 120000, maxOutputTokens: 4096, maxInputChars: 128000 },
  context: { estimatedWindowTokens: 8192, triggerRatio: .75, keepRecentRounds: 4 }, outputDir: '/tmp/runs',
};
const tasks: EvalManifest['tasks'] = ['a','b','c','d'].map((id, i) => ({ id, suite: i < 2 ? 'S' : 'H', taskHash: id.repeat(64), root: `/tasks/${id}` }));
const schedule: EvalManifest['schedule'] = buildSchedule(config.taskIds, config.variants, config.repeats);
const manifest: EvalManifest = {
  schemaVersion: 1, runId: 'run-1', phase: 'smoke', provider: 'mock', startedAt: '2026-09-24T00:00:00Z', nodeVersion: 'v24',
  implementationCommit: null, dirty: true, benchmarkCommit: null, benchmarkHash: null, config, tasks, schedule,
};
const check = (durationMs?: number): CheckResult => ({ passed: true, exitCode: 0, signal: null, timedOut: false,
  completed: true, passedTests: 1, failedTests: 0, testCount: 1, outputPath: '/tmp/output', outputHash: 'hash',
  ...(durationMs === undefined ? {} : { durationMs }),
});
const request = (seq: number, kind: RequestMetric['kind'], estimatedInputTokens: number, usage: number | null): RequestMetric => ({
  seq, kind, requestChars: estimatedInputTokens * 4, estimatedInputTokens,
  preCompressionEstimatedTokens: kind === 'worker' ? estimatedInputTokens + 10 : null,
  olderRounds: kind === 'worker' ? 1 : null,
  thresholdReached: false, compactionEligible: false,
  inputTokens: usage, outputTokens: usage, actualModel: 'actual-a', fingerprint: 'fp-a',
});
function fixture(): { attempts: AttemptResult[]; metrics: JournalMetrics[] } {
  const successes = { baseline: [false,false,true,false], full: [true,false,true,true] };
  const attempts: AttemptResult[] = [];
  const metrics: JournalMetrics[] = [];
  for (const entry of schedule) {
    const index = tasks.findIndex(task => task.id === entry.taskId);
    const passed = successes[entry.variant as 'baseline' | 'full'][index]!;
    const requests = entry.orderIndex === 0 ? [request(1, 'worker', 10, 3), request(2, 'worker', 30, null), request(3, 'optimizer', 50, 5)]
      : entry.orderIndex === 1 ? [] : [request(1, 'worker', 80, 2)];
    const workerRequests = requests.filter(item => item.kind === 'worker').length;
    const optimizerRequests = requests.filter(item => item.kind === 'optimizer').length;
    const knownInputTokens = requests.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0);
    const knownOutputTokens = requests.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0);
    const allKnown = requests.every(item => item.inputTokens !== null && item.outputTokens !== null);
    const agent: RunResult = { schemaVersion: 1, termination: passed ? 'completed' : 'request_limit', answer: null,
      modelRequests: requests.length, workerRequests, optimizerRequests, summaryRequests: 0,
      toolCalls: 2, toolErrors: passed ? 0 : 1,
      inputTokens: allKnown ? knownInputTokens : null, outputTokens: allKnown ? knownOutputTokens : null,
      knownInputTokens, knownOutputTokens, durationMs: 100 + entry.orderIndex * 10, compactions: 0, error: passed ? null : 'request_limit',
      contextStats: { workerRequests, meanEstimatedInputTokens: workerRequests ? requests.filter(item => item.kind === 'worker').reduce((s,item) => s + item.estimatedInputTokens,0) / workerRequests : null,
        peakEstimatedInputTokens: workerRequests ? Math.max(...requests.filter(item => item.kind === 'worker').map(item => item.estimatedInputTokens)) : null,
        peakRequestChars: workerRequests ? Math.max(...requests.filter(item => item.kind === 'worker').map(item => item.requestChars)) : null,
        thresholdRequests: 0, eligibleCompactionRequests: 0 },
    };
    const task = tasks[index]!;
    attempts.push({ schemaVersion: 1, runId: manifest.runId, phase: manifest.phase,
      implementationCommit: manifest.implementationCommit, benchmarkCommit: manifest.benchmarkCommit,
      taskId: task.id, suite: task.suite, variant: entry.variant, repeat: 1, orderIndex: entry.orderIndex, taskHash: task.taskHash,
      config: { schemaVersion: 1, variant: entry.variant, model: { ...config.model }, budget: { ...config.budget },
        context: { ...config.context }, workspace: `/tmp/${entry.orderIndex}`, writable: [], sessionPath: `/tmp/${entry.orderIndex}.jsonl` },
      agent, integrity: { passed: true, changedPaths: [], violations: [] }, publicTest: check(entry.orderIndex === 0 ? undefined : 10),
      acceptanceTest: check(20), passed, failureReason: passed ? null : 'request_limit', artifactPaths: {},
    });
    metrics.push({ result: structuredClone(agent), requests, inputKnownRequests: requests.filter(item => item.inputTokens !== null).length,
      outputKnownRequests: requests.filter(item => item.outputTokens !== null).length,
      completeUsageRequests: requests.filter(item => item.inputTokens !== null && item.outputTokens !== null).length });
  }
  return { attempts, metrics };
}

test('S01 S03 strict rates, suite strata and failure costs', () => {
  const { attempts, metrics } = fixture();
  const summary = summarize(manifest, attempts, metrics);
  assert.equal(summary.byVariant.baseline?.overall.success.rate, .25);
  assert.equal(summary.byVariant.full?.overall.success.rate, .75);
  assert.equal(summary.fullMinusBaselinePercentagePoints.overall, 50);
  assert.equal(summary.byVariant.baseline?.S.success.rate, 0);
  assert.equal(summary.byVariant.full?.S.success.rate, .5);
  assert.equal(summary.byVariant.baseline?.H.success.rate, .5);
  assert.equal(summary.byVariant.full?.H.success.rate, 1);
  assert.equal(summary.overall.overall.requests.total, 9);
  assert.equal(summary.byVariant.baseline?.overall.tools.calls, 8);
  assert.equal(summary.byVariant.baseline?.overall.tools.errors, 3);
  assert.equal(summary.overall.overall.termination.request_limit, 4);
  assert.equal(summary.overall.overall.failureReason.request_limit, 4);
  assert.match(renderReport(manifest, summary), /mock/i);
  assert.match(renderReport(manifest, summary), /50/);
});

test('S02 R07 missing usage, zero requests and request-weighted context stay explicit', () => {
  const { attempts, metrics } = fixture();
  const summary = summarize(manifest, attempts, metrics);
  assert.equal(summary.overall.overall.tokens.input.total, null);
  assert.equal(summary.overall.overall.tokens.input.known, 20);
  assert.equal(summary.overall.overall.tokens.input.completeness, 8 / 9);
  assert.equal(summary.byVariant.full?.S.tokens.input.total, 2);
  assert.equal(summary.byVariant.full?.S.context.estimatedInputTokens.mean, 80);
  assert.equal(summary.byVariant.baseline?.S.context.estimatedInputTokens.mean, 40); // (10 + 30 + 80) / 3, not mean of run means
  assert.equal(summary.byVariant.full?.S.publicCheckDurationMs.knownCount, 2);
  assert.equal(summary.byVariant.baseline?.S.publicCheckDurationMs.knownCount, 1);
  assert.match(renderReport(manifest, summary), /zero compactions|0 compactions/i);
});

test('incomplete, repeated and mixed samples are rejected', () => {
  const { attempts, metrics } = fixture();
  assert.throws(() => summarize(manifest, attempts.slice(1), metrics.slice(1)));
  assert.throws(() => summarize(manifest, [...attempts.slice(0, -1), attempts[0]!], metrics));
  assert.throws(() => summarize(manifest, attempts, [...metrics].reverse()));
  assert.throws(() => summarize(manifest, attempts.map((item, i) => i === 0 ? { ...item, phase: 'baseline-diagnostic' } : item), metrics));
  assert.throws(() => summarize(manifest, attempts.map((item, i) => i === 0 ? { ...item, implementationCommit: 'other' } : item), metrics));
  assert.throws(() => summarize(manifest, attempts.map((item, i) => i === 0 ? { ...item, config: { ...item.config, budget: { ...item.config.budget, maxModelRequests: 2 } } } : item), metrics));
});

test('single-variant zero-request sample has null delta and unknown completeness', () => {
  const { attempts, metrics } = fixture();
  const single: EvalManifest = { ...manifest,
    config: { ...config, taskIds: ['a'], variants: ['full'] },
    tasks: [tasks[0]!], schedule: buildSchedule(['a'], ['full'], 1) };
  const attempt = { ...attempts[1]!, orderIndex: 0 };
  const result = summarize(single, [attempt], [metrics[1]!]);
  assert.equal(result.byVariant.full?.overall.requests.total, 0);
  assert.equal(result.byVariant.full?.overall.tokens.input.total, 0);
  assert.equal(result.byVariant.full?.overall.tokens.input.completeness, null);
  assert.equal(result.byVariant.full?.overall.context.requestChars.mean, null);
  assert.equal(result.fullMinusBaselinePercentagePoints.overall, null);
  assert.equal(result.byVariant.full?.H.publicCheckDurationMs.sum, 0); // empty group has a known zero total
});

test('phase matrix and provider must be valid before aggregation', () => {
  const { attempts, metrics } = fixture();
  assert.throws(() => summarize({ ...manifest, phase: 'ablation', config: { ...config, phase: 'ablation', benchmarkManifest: 'benchmark/v1.json' } }, attempts, metrics), /phase matrix/);
  assert.throws(() => summarize({ ...manifest, provider: 'http' }, attempts, metrics), /provider/);
});

test('tampered scoring cannot enter a successful-looking table', () => {
  const { attempts, metrics } = fixture();
  assert.throws(() => summarize(manifest, attempts.map((item, index) => index === 0 ? { ...item, passed: true } : item), metrics), /grade mismatch/);
  assert.throws(() => summarize(manifest, attempts.map((item, index) => index === 0 ? { ...item, failureReason: 'acceptance_test' } : item), metrics), /grade mismatch/);
  assert.throws(() => summarize(manifest, attempts.map((item, index) => index === 1 ? { ...item, acceptanceTest: { ...item.acceptanceTest, passed: false } } : item), metrics), /grade mismatch/);
});

test('combined known tokens retain the known side of partial usage', () => {
  const { attempts, metrics } = fixture();
  const altered = structuredClone(metrics);
  const request = altered[0]!.requests[1]!;
  request.outputTokens = 2;
  altered[0]!.result.knownOutputTokens += 2;
  altered[0]!.outputKnownRequests += 1;
  altered[0]!.result.outputTokens = altered[0]!.result.knownOutputTokens;
  const adjusted = attempts.map((item, index) => index === 0 ? { ...item, agent: structuredClone(altered[0]!.result) } : item);
  const summary = summarize(manifest, adjusted, altered);
  assert.equal(summary.overall.overall.tokens.combined.total, null);
  assert.equal(summary.overall.overall.tokens.combined.known, summary.overall.overall.tokens.input.known + summary.overall.overall.tokens.output.known);
  assert.equal(summary.overall.overall.tokens.combined.known, 42);
  assert.equal(summary.overall.overall.tokens.combined.knownRequests, 8);
});

test('check duration total stays unknown when any attempt lacks timing', () => {
  const { attempts, metrics } = fixture();
  const partial = summarize(manifest, attempts, metrics).byVariant.baseline!.S.publicCheckDurationMs;
  assert.equal(partial.knownCount, 1);
  assert.equal(partial.unknownCount, 1);
  assert.equal(partial.knownSum, 10);
  assert.equal(partial.sum, null);
  const allKnown = summarize(manifest, attempts, metrics).byVariant.full!.S.publicCheckDurationMs;
  assert.equal(allKnown.sum, 20);
  assert.match(renderReport(manifest, summarize(manifest, attempts, metrics)), /known sum 10; total unknown/i);
  const single: EvalManifest = { ...manifest, config: { ...config, taskIds: ['a'], variants: ['baseline'] },
    tasks: [tasks[0]!], schedule: buildSchedule(['a'], ['baseline'], 1) };
  const unknown = summarize(single, [attempts[0]!], [metrics[0]!]).overall.overall.publicCheckDurationMs;
  assert.equal(unknown.knownCount, 0);
  assert.equal(unknown.knownSum, 0);
  assert.equal(unknown.sum, null);
});
