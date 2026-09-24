#!/usr/bin/env node
// Independently aggregate raw result/journal data by suite AND variant.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [runArg, analysisArg] = process.argv.slice(2);
if (!runArg || !analysisArg) throw new Error('usage: counter.mjs RUN_ROOT ANALYSIS_DIR');
const runRoot = path.resolve(runArg);
const analysisDir = path.resolve(analysisArg);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const manifest = await readJson(path.join(runRoot, 'manifest.json'));
const official = await readJson(path.join(runRoot, 'summary.json'));
const index = await readJson(path.join(analysisDir, 'index.json'));
const fresh = () => ({ attempts: 0, passed: 0, functionalPass: 0, toolStarts: 0,
  toolCalls: 0, toolErrors: 0, modelRequests: 0, workerRequests: 0,
  optimizerRequests: 0, summaryRequests: 0, inputTokens: 0, outputTokens: 0,
  knownInputTokens: 0, knownOutputTokens: 0, compactions: 0, termination: {} });
const groups = Object.fromEntries(manifest.config.variants.map(variant => [variant,
  { S: fresh(), H: fresh(), overall: fresh() }]));
const derivedGroups = Object.fromEntries(manifest.config.variants.map(variant => [variant,
  { S: fresh(), H: fresh(), overall: fresh() }]));
function add(into, row) {
  for (const key of Object.keys(into)) {
    if (key === 'termination') continue;
    into[key] = into[key] === null || row[key] === null ? null : into[key] + row[key];
  }
  into.termination[row.termination] = (into.termination[row.termination] ?? 0) + 1;
}
function rawRow(result, toolStarts) {
  return { attempts: 1, passed: +result.passed,
    functionalPass: +(result.publicTest.passed && result.acceptanceTest.passed),
    toolStarts, toolCalls: result.agent.toolCalls, toolErrors: result.agent.toolErrors,
    modelRequests: result.agent.modelRequests, workerRequests: result.agent.workerRequests,
    optimizerRequests: result.agent.optimizerRequests, summaryRequests: result.agent.summaryRequests,
    inputTokens: result.agent.inputTokens, outputTokens: result.agent.outputTokens,
    knownInputTokens: result.agent.knownInputTokens, knownOutputTokens: result.agent.knownOutputTokens,
    compactions: result.agent.compactions, termination: result.agent.termination };
}
function derivedRow(attempt) {
  return { attempts: 1, passed: +attempt.passed, functionalPass: +attempt.functionalPass,
    toolStarts: attempt.tools.toolStartCount, toolCalls: attempt.tools.dispatchedCount,
    toolErrors: attempt.tools.errorCount, modelRequests: attempt.model.totalDispatchedRequests,
    workerRequests: attempt.model.workerDispatched, optimizerRequests: attempt.model.optimizerRequests,
    summaryRequests: attempt.model.summaryRequests, inputTokens: attempt.model.inputTokens,
    outputTokens: attempt.model.outputTokens, knownInputTokens: attempt.model.knownInputTokens,
    knownOutputTokens: attempt.model.knownOutputTokens, compactions: attempt.model.compactions.length,
    termination: attempt.termination };
}
for (const entry of manifest.schedule) {
  const stem = `${entry.taskId}-${entry.variant}-${entry.repeat}`;
  const folder = path.join(runRoot, 'attempts', stem);
  const result = await readJson(path.join(folder, 'result.json'));
  const attempt = await readJson(path.join(analysisDir, 'attempts', `${stem}.json`));
  if (result.runId !== manifest.runId || result.variant !== entry.variant || attempt.variant !== entry.variant
    || result.taskId !== entry.taskId || attempt.taskId !== entry.taskId || result.repeat !== entry.repeat
    || attempt.repeat !== entry.repeat || result.orderIndex !== entry.orderIndex || attempt.orderIndex !== entry.orderIndex) {
    throw new Error(`${stem}: identity mismatch`);
  }
  const events = (await readFile(path.join(folder, 'journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const row = rawRow(result, events.filter(event => event.type === 'tool_start').length);
  const derived = derivedRow(attempt);
  for (const target of [groups[entry.variant][result.suite], groups[entry.variant].overall]) add(target, row);
  for (const target of [derivedGroups[entry.variant][result.suite], derivedGroups[entry.variant].overall]) add(target, derived);
}
function summaryShape(group) {
  return Object.fromEntries(Object.entries(group).map(([suite, value]) => [suite, {
    attempts: value.attempts, passed: value.passed, functionalPass: value.functionalPass,
    toolStarts: value.toolStarts, toolCalls: value.toolCalls, toolErrors: value.toolErrors,
    modelRequests: value.modelRequests, workerRequests: value.workerRequests,
    optimizerRequests: value.optimizerRequests, summaryRequests: value.summaryRequests,
    inputTokens: value.inputTokens, outputTokens: value.outputTokens,
    knownInputTokens: value.knownInputTokens, knownOutputTokens: value.knownOutputTokens,
    compactions: value.compactions, termination: value.termination,
  }]));
}
const rawComparable = Object.fromEntries(Object.entries(groups).map(([variant, group]) => [variant, summaryShape(group)]));
const derivedComparable = Object.fromEntries(Object.entries(derivedGroups).map(([variant, group]) => [variant, summaryShape(group)]));
if (!index.complete || index.processedAttempts !== manifest.schedule.length || manifest.schedule.length !== official.sampleCount) {
  throw new Error('incomplete analysis/schedule/official summary');
}
if (!isDeepStrictEqual(rawComparable, derivedComparable)) throw new Error('raw and per-attempt derived aggregates differ');
const summaryChecks = {};
for (const variant of manifest.config.variants) {
  for (const suite of ['S', 'H', 'overall']) {
    const actual = groups[variant][suite];
    const expected = official.byVariant[variant][suite];
    const checks = {
      attempts: actual.attempts === expected.success.count,
      passed: actual.passed === expected.success.passed,
      modelRequests: actual.modelRequests === expected.requests.total,
      workerRequests: actual.workerRequests === expected.requests.worker,
      optimizerRequests: actual.optimizerRequests === expected.requests.optimizer,
      summaryRequests: actual.summaryRequests === expected.requests.summary,
      toolCalls: actual.toolCalls === expected.tools.calls,
      toolErrors: actual.toolErrors === expected.tools.errors,
      inputTokens: actual.inputTokens === expected.tokens.input.total,
      outputTokens: actual.outputTokens === expected.tokens.output.total,
      compactions: actual.compactions === expected.compactions,
      termination: isDeepStrictEqual(actual.termination, expected.termination),
    };
    summaryChecks[`${variant}.${suite}`] = checks;
    if (Object.values(checks).some(value => !value)) throw new Error(`${variant}.${suite}: official summary mismatch`);
  }
}
const result = { runId: manifest.runId, source: 'raw result.json plus journal tool_start events',
  partitionKeys: ['variant', 'suite'], matchingDerived: true, matchingOfficialSummary: true,
  summaryChecks, byVariant: groups };
await writeFile(path.join(analysisDir, 'independent-counter.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ runId: manifest.runId, matchingDerived: true, matchingOfficialSummary: true,
  attempts: manifest.schedule.length, variants: Object.keys(groups) }));
