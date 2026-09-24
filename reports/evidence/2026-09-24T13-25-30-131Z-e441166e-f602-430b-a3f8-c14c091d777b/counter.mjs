#!/usr/bin/env node
// Independent aggregate check against raw result.json and journal.jsonl.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [runArg, analysisArg] = process.argv.slice(2);
if (!runArg || !analysisArg) throw new Error('usage: counter.mjs RUN_ROOT ANALYSIS_DIR');
const runRoot = path.resolve(runArg);
const analysisDir = path.resolve(analysisArg);
const manifest = JSON.parse(await readFile(path.join(runRoot, 'manifest.json'), 'utf8'));
const index = JSON.parse(await readFile(path.join(analysisDir, 'index.json'), 'utf8'));
const fresh = () => ({ attempts: 0, passed: 0, functionalPass: 0, toolStarts: 0,
  toolCalls: 0, toolErrors: 0, modelRequests: 0, workerRequests: 0,
  optimizerRequests: 0, summaryRequests: 0, inputTokens: 0, outputTokens: 0,
  knownInputTokens: 0, knownOutputTokens: 0, termination: {} });
const raw = { S: fresh(), H: fresh(), total: fresh() };
const derived = { S: fresh(), H: fresh(), total: fresh() };
function add(into, entry) {
  for (const key of Object.keys(into)) {
    if (key === 'termination') continue;
    into[key] = into[key] === null || entry[key] === null ? null : into[key] + entry[key];
  }
  into.termination[entry.termination] = (into.termination[entry.termination] ?? 0) + 1;
}
for (const entry of manifest.schedule) {
  const stem = `${entry.taskId}-${entry.variant}-${entry.repeat}`;
  const folder = path.join(runRoot, 'attempts', stem);
  const result = JSON.parse(await readFile(path.join(folder, 'result.json'), 'utf8'));
  const lines = (await readFile(path.join(folder, 'journal.jsonl'), 'utf8')).trim().split('\n');
  const types = lines.map(line => JSON.parse(line));
  const target = JSON.parse(await readFile(path.join(analysisDir, 'attempts', `${stem}.json`), 'utf8'));
  const r = {
    attempts: 1, passed: +result.passed,
    functionalPass: +(result.publicTest.passed && result.acceptanceTest.passed),
    toolStarts: types.filter(event => event.type === 'tool_start').length,
    toolCalls: result.agent.toolCalls, toolErrors: result.agent.toolErrors,
    modelRequests: result.agent.modelRequests, workerRequests: result.agent.workerRequests,
    optimizerRequests: result.agent.optimizerRequests, summaryRequests: result.agent.summaryRequests,
    inputTokens: result.agent.inputTokens, outputTokens: result.agent.outputTokens,
    knownInputTokens: result.agent.knownInputTokens, knownOutputTokens: result.agent.knownOutputTokens,
    termination: result.agent.termination,
  };
  const d = {
    attempts: 1, passed: +target.passed, functionalPass: +target.functionalPass,
    toolStarts: target.tools.toolStartCount, toolCalls: target.tools.dispatchedCount,
    toolErrors: target.tools.errorCount, modelRequests: target.model.totalDispatchedRequests,
    workerRequests: target.model.workerDispatched,
    optimizerRequests: target.model.optimizerRequests, summaryRequests: target.model.summaryRequests,
    inputTokens: target.model.inputTokens, outputTokens: target.model.outputTokens,
    knownInputTokens: target.model.knownInputTokens, knownOutputTokens: target.model.knownOutputTokens,
    termination: target.termination,
  };
  add(raw[result.suite], r); add(raw.total, r);
  add(derived[result.suite], d); add(derived.total, d);
}
if (!index.complete || index.processedAttempts !== manifest.schedule.length
  || !isDeepStrictEqual(raw, derived)) throw new Error('raw/derived aggregate mismatch');
const output = { runId: manifest.runId, source: 'raw result.json plus journal tool_start events',
  analysisDir, matchingDerived: true, bySuite: raw };
await writeFile(path.join(analysisDir, 'independent-counter.json'), `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(output));
