#!/usr/bin/env node
// Build M9 report tables and trace references from a completed run and its derived metrics.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const runRoot = path.resolve(process.argv[2] ?? '');
const evidenceRoot = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw new Error('usage: build-evidence.mjs RUN_ROOT EVIDENCE_ROOT');
const metricsDir = path.join(evidenceRoot, 'metrics');
const tracesDir = path.join(evidenceRoot, 'traces');
await mkdir(tracesDir);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const esc = value => `"${String(value === null || value === undefined ? '' : value).replaceAll('"', '""')}"`;
const csv = (file, columns, rows) => writeFile(file,
  `${columns.map(esc).join(',')}\n${rows.map(row => columns.map(key => esc(typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : row[key])).join(',')).join('\n')}\n`, { flag: 'wx' });

const manifest = await json(path.join(runRoot, 'manifest.json'));
const official = await json(path.join(runRoot, 'summary.json'));
const index = await json(path.join(metricsDir, 'index.json'));
const allAttempts = new Map();
for (const entry of manifest.schedule) {
  const stem = `${entry.taskId}-${entry.variant}-${entry.repeat}`;
  const attempt = await json(path.join(metricsDir, 'attempts', `${stem}.json`));
  allAttempts.set(stem, { entry, attempt });
}
if (manifest.phase !== 'ablation' || official.sampleCount !== 144 || index.processedAttempts !== 144 || !index.complete) {
  throw new Error('M9 run must contain exactly 144 complete attempts');
}
const variants = manifest.config.variants;
const suites = ['S', 'H', 'overall'];
const summaryRows = [];
for (const variant of variants) for (const suite of suites) {
  const x = official.byVariant[variant][suite];
  summaryRows.push({ variant, suite, passed: x.success.passed, attempts: x.success.count,
    rate: x.success.rate, requestsTotal: x.requests.total, worker: x.requests.worker,
    optimizer: x.requests.optimizer, summary: x.requests.summary,
    tokensInputKnown: x.tokens.input.known, tokensInputTotal: x.tokens.input.total,
    tokensOutputKnown: x.tokens.output.known, tokensOutputTotal: x.tokens.output.total,
    tokensCombinedKnown: x.tokens.combined.known, tokensCombinedTotal: x.tokens.combined.total,
    tokensCompleteness: x.tokens.combined.completeness,
    latencyMeanMs: x.latencyMs.mean, latencyMedianMs: x.latencyMs.median, latencyPeakMs: x.latencyMs.peak,
    workerContextMeanEstimatedTokens: x.context.estimatedInputTokens.mean,
    workerContextPeakEstimatedTokens: x.context.estimatedInputTokens.peak,
    requestCharsMean: x.context.requestChars.mean, requestCharsPeak: x.context.requestChars.peak,
    toolCalls: x.tools.calls, toolErrors: x.tools.errors, compactions: x.compactions,
    thresholdRequests: x.context.thresholdRequests, eligibleCompactionRequests: x.context.eligibleCompactionRequests,
    termination: x.termination });
}
await csv(path.join(evidenceRoot, 'summary.csv'), Object.keys(summaryRows[0]), summaryRows);
await save(path.join(evidenceRoot, 'summary.json'), { runId: manifest.runId, sampleCount: official.sampleCount,
  byVariant: official.byVariant, fullMinusBaselinePercentagePoints: official.fullMinusBaselinePercentagePoints });

const contrasts = [];
for (const suite of suites) {
  const rate = variant => official.byVariant[variant][suite].success.rate * 100;
  for (const [contrast, left, right] of [
    ['context-baseline', 'context', 'baseline'], ['optimizer-baseline', 'optimizer', 'baseline'],
    ['full-optimizer', 'full', 'optimizer'], ['full-context', 'full', 'context'],
    ['full-baseline', 'full', 'baseline'],
  ]) contrasts.push({ suite, contrast, left, right, leftRatePct: rate(left), rightRatePct: rate(right), differencePp: rate(left) - rate(right) });
}
await csv(path.join(evidenceRoot, 'contrasts.csv'), Object.keys(contrasts[0]), contrasts);

const taskRows = [];
for (const taskId of manifest.config.taskIds) {
  const row = { taskId, suite: manifest.tasks.find(task => task.id === taskId)?.suite ?? null };
  for (const variant of variants) {
    const attempts = [1, 2, 3].map(repeat => allAttempts.get(`${taskId}-${variant}-${repeat}`).attempt);
    row[`${variant}Passed`] = attempts.filter(attempt => attempt.passed).length;
    row[`${variant}Of3`] = attempts.map((attempt, index) => `${index + 1}:${attempt.passed ? 'P' : 'F'}`).join(' ');
  }
  taskRows.push(row);
}
await csv(path.join(evidenceRoot, 'task-success.csv'), Object.keys(taskRows[0]), taskRows);

const compactions = await json(path.join(metricsDir, 'compactions.json'));
const compactionMap = new Map();
for (const row of compactions) {
  const stem = `${row.taskId}-${row.variant}-${row.repeat}`;
  if (!compactionMap.has(stem)) compactionMap.set(stem, []);
  compactionMap.get(stem).push(row);
}
const compactionAttempts = [...compactionMap].map(([stem, rows]) => ({
  stem, taskId: rows[0].taskId, variant: rows[0].variant, repeat: rows[0].repeat,
  compactions: rows.length, compactedSeqs: rows.map(row => row.compactedSeq),
  summaryResponseSeqs: rows.map(row => row.summaryResponseSeq), postObservationSeqs: rows.map(row => row.postObservationSeq),
  preToPostEstimatedTokens: rows.map(row => `${row.preCompressionEstimatedTokens}→${row.postCompressionEstimatedTokens}`),
  reductions: rows.map(row => row.estimatedTokenReduction),
  dsmlCount: rows.filter(row => row.containsDSMLCalls).length,
  invokedToolNames: [...new Set(rows.flatMap(row => row.invokedToolNames))],
})).sort((a, b) => a.stem.localeCompare(b.stem));
await csv(path.join(evidenceRoot, 'compaction-attempts.csv'), Object.keys(compactionAttempts[0]), compactionAttempts);
const dsmlCount = compactions.filter(row => row.containsDSMLCalls).length;
const compressionSummary = { totalCompactions: compactions.length, triggerAttempts: compactionAttempts.length,
  withDSMLCalls: dsmlCount, withoutDSMLCalls: compactions.length - dsmlCount,
  byVariant: Object.fromEntries(variants.map(variant => [variant, {
    attempts: compactionAttempts.filter(row => row.variant === variant).length,
    compactions: compactions.filter(row => row.variant === variant).length,
    withDSMLCalls: compactions.filter(row => row.variant === variant && row.containsDSMLCalls).length,
  }])),
  reductions: { minimum: Math.min(...compactions.map(row => row.estimatedTokenReduction)),
    maximum: Math.max(...compactions.map(row => row.estimatedTokenReduction)) } };
await save(path.join(evidenceRoot, 'compression-summary.json'), compressionSummary);

const optimizerOutputs = await json(path.join(metricsDir, 'optimizer-outputs.json'));
const optimizerStats = { outputs: optimizerOutputs.length,
  dispatched: optimizerOutputs.filter(row => row.dispatched).length,
  withText: optimizerOutputs.filter(row => typeof row.acceptedText === 'string' && row.acceptedText.trim().length > 0).length,
  responseErrors: optimizerOutputs.filter(row => row.responseError !== null).length,
  byVariant: Object.fromEntries(variants.map(variant => [variant, optimizerOutputs.filter(row => row.variant === variant).length])) };
await save(path.join(evidenceRoot, 'optimizer-summary.json'), optimizerStats);

const failures = await json(path.join(metricsDir, 'index.json'));
if (failures.failedAttempts !== 51) throw new Error(`expected 51 strict failures, got ${failures.failedAttempts}`);
const reasonSelections = new Map();
for (const { entry, attempt } of allAttempts.values()) if (!attempt.passed) {
  const reasons = [attempt.failureReason ?? attempt.termination];
  for (const reason of reasons) {
    const previous = reasonSelections.get(reason);
    if (!previous || entry.orderIndex < previous.entry.orderIndex) reasonSelections.set(reason, { entry, attempt });
  }
}
const selected = new Map();
const addSelection = (reason, value) => {
  const { entry, attempt } = value;
  const stem = `${entry.taskId}-${entry.variant}-${entry.repeat}`;
  if (!selected.has(stem)) selected.set(stem, { stem, taskId: entry.taskId, suite: attempt.suite,
    variant: entry.variant, repeat: entry.repeat, orderIndex: entry.orderIndex,
    passed: attempt.passed, failureReason: attempt.failureReason, termination: attempt.termination,
    journalPath: attempt.journalPath, attemptJson: `metrics/attempts/${stem}.json`, reasons: [] });
  selected.get(stem).reasons.push(reason);
};
for (const [reason, value] of reasonSelections) addSelection(`earliest-failure:${reason}`, value);
for (const variant of ['context', 'full']) {
  const choices = [...allAttempts.values()].filter(({ entry, attempt }) => entry.variant === variant && attempt.model.compactions.length > 0)
    .sort((a, b) => a.entry.orderIndex - b.entry.orderIndex);
  if (choices.length) addSelection(`first-context-compaction:${variant}`, choices[0]);
}
const firstFullCompaction = [...allAttempts.values()].filter(({ entry, attempt }) => entry.variant === 'full' && attempt.model.compactions.length > 0)
  .sort((a, b) => a.entry.orderIndex - b.entry.orderIndex)[0];
if (firstFullCompaction) addSelection('first-full-context-compaction', firstFullCompaction);
for (const variant of ['optimizer', 'full']) {
  const choices = [...allAttempts.values()].filter(({ entry, attempt }) => entry.variant === variant && attempt.model.optimizerOutputs.length > 0)
    .sort((a, b) => a.entry.orderIndex - b.entry.orderIndex);
  if (choices.length) addSelection(`first-optimizer-output:${variant}`, choices[0]);
}
for (const taskId of ['m01-report', 'm02-options']) for (const variant of variants) {
  const choices = [...allAttempts.values()].filter(({ entry }) => entry.taskId === taskId && entry.variant === variant)
    .sort((a, b) => a.entry.orderIndex - b.entry.orderIndex);
  if (choices.length) addSelection(`earliest-${taskId}-${variant}`, choices[0]);
}
const fullRequestLimit = [...allAttempts.values()].filter(({ entry, attempt }) => entry.variant === 'full' && attempt.termination === 'request_limit')
  .sort((a, b) => a.entry.orderIndex - b.entry.orderIndex);
for (const value of fullRequestLimit) addSelection('full-request-limit', value);
const fullH03Failures = [...allAttempts.values()].filter(({ entry, attempt }) => entry.taskId === 'h03-module-navigation'
  && entry.variant === 'full' && !attempt.passed).sort((a, b) => a.entry.orderIndex - b.entry.orderIndex);
for (const value of fullH03Failures) addSelection('full-h03-failure', value);
const m02FullRepeat3 = allAttempts.get('m02-options-full-3');
if (m02FullRepeat3) addSelection('m02-full-r3-O-mentions-RangeError-but-after-source-still-throws-TypeError', m02FullRepeat3);
const selectedRows = [...selected.values()].sort((a, b) => a.orderIndex - b.orderIndex);
await save(path.join(tracesDir, 'selection.json'), {
  rule: 'Select the earliest orderIndex for each strict failureReason; first realized C compaction in context and full; first O output in optimizer and full; earliest orderIndex for m01/m02 in each variant; every full request_limit; every full h03 failure; m02 full repeat 3 as the constraint/advice counterexample. Deduplicate attempt files while preserving every reason.',
  count: selectedRows.length, selected: selectedRows,
});
await save(path.join(tracesDir, 'compaction-excerpts.json'), compactions);
await save(path.join(tracesDir, 'optimizer-excerpts.json'), optimizerOutputs);

console.log(JSON.stringify({ runId: manifest.runId, summaryRows: summaryRows.length, contrasts: contrasts.length,
  taskRows: taskRows.length, triggerAttempts: compactionAttempts.length, compactions: compactions.length,
  dsmlCompactions: dsmlCount, optimizerOutputs: optimizerOutputs.length, selectedTraces: selectedRows.length }));
