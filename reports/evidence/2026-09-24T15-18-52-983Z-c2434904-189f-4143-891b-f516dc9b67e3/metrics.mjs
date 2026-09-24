#!/usr/bin/env node
// Read-only M6 evidence extraction; writes exclusively to a fresh analysis directory.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readJournal } from '../../../src/journal.ts';
import { inspectJournal } from '../../../eval/journal-metrics.ts';

const [runArg, outArg, mode, extra] = process.argv.slice(2);
if (!runArg || !outArg || extra || mode && mode !== '--allow-partial') {
  throw new Error('usage: metrics.mjs RUN_ROOT NEW_OUT_DIR [--allow-partial]');
}
const runRoot = path.resolve(runArg);
const outDir = path.resolve(outArg);
if (outDir === runRoot || outDir.startsWith(`${runRoot}${path.sep}`)) throw new Error('output must be outside the original run');
const partial = mode === '--allow-partial';
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const csv = value => `"${String(value === null || value === undefined ? 'null' : value).replaceAll('"', '""')}"`;
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const table = (headers, rows) => [headers.map(csv).join(','), ...rows.map(row => row.map(csv).join(','))].join('\n') + '\n';
const mdCell = value => String(value === null || value === undefined ? 'null' : value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
const markdown = (headers, rows) => [
  `| ${headers.map(mdCell).join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map(row => `| ${row.map(mdCell).join(' | ')} |`),
].join('\n') + '\n';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function argumentsInfo(raw) {
  try {
    const parsed = JSON.parse(raw);
    const normalized = JSON.stringify(canonical(parsed));
    return { canonicalArguments: normalized, validJson: true,
      path: parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && typeof parsed.path === 'string' ? parsed.path : null };
  } catch { return { canonicalArguments: raw, validJson: false, path: null }; }
}
function assertionRows(contents) {
  const failed = [];
  for (const line of contents.split('\n')) {
    const at = line.indexOf('{');
    if (at < 0) continue;
    let event;
    try { event = JSON.parse(line.slice(at)); } catch { continue; }
    if (event.type !== 'test:fail') continue;
    const data = event.data ?? {};
    const error = data.details?.error ?? {};
    failed.push({ name: data.name ?? null, testId: data.testId ?? null,
      message: typeof error.message === 'string' ? error.message : null,
      code: typeof error.code === 'string' ? error.code : null });
  }
  return failed;
}

const manifest = await readJson(path.join(runRoot, 'manifest.json'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.schedule)) throw new Error('invalid run manifest');
await mkdir(outDir); // exclusive: never overwrite an analysis output or the original run
await mkdir(path.join(outDir, 'attempts'));
const requestRows = [];
const summaryRows = [];
const errorRows = [];
const readBackRows = [];
const repeatedRows = [];
const compactionRows = [];
const optimizerRows = [];
const failureRows = [];
const processed = [];
const missing = [];

for (const entry of manifest.schedule) {
  const stem = `${entry.taskId}-${entry.variant}-${entry.repeat}`;
  const attemptDir = path.join(runRoot, 'attempts', stem);
  const resultFile = path.join(attemptDir, 'result.json');
  if (!(await exists(resultFile))) { missing.push(stem); continue; }
  const result = await readJson(resultFile);
  if (result.runId !== manifest.runId || result.taskId !== entry.taskId
    || result.variant !== entry.variant || result.repeat !== entry.repeat
    || result.orderIndex !== entry.orderIndex) throw new Error(`${stem}: result identity mismatch`);
  const journalPath = path.join(attemptDir, 'journal.jsonl');
  const journal = await readJournal(journalPath);
  const inspected = inspectJournal(journal, result.config);
  if (!isDeepStrictEqual(inspected.result, result.agent)) throw new Error(`${stem}: journal and result differ`);
  const events = journal.events;
  const bySeq = new Map(events.map(event => [event.seq, event]));
  const responses = new Map(events.filter(event => event.type === 'response').map(event => [event.data.requestSeq, event]));
  const toolEnds = new Map(events.filter(event => event.type === 'tool_end').map(event => [event.data.startSeq, event]));
  const requests = events.filter(event => event.type === 'request');
  const observations = events.filter(event => event.type === 'context_observation');
  const referencedObservations = new Set(requests.map(event => event.data.observationSeq).filter(seq => seq !== null));
  const observationOnly = observations.filter(event => !referencedObservations.has(event.seq)).map(event => ({
    observationSeq: event.seq, ...event.data.metrics,
    hardOverflow: event.data.metrics.requestChars > result.config.budget.maxInputChars,
  }));
  const modelRequests = [];
  let cumulativeKnownInput = 0;
  let cumulativeKnownOutput = 0;
  let missingInput = 0;
  let missingOutput = 0;
  let priorWorkerEstimate = null;
  for (const request of requests) {
    const response = responses.get(request.seq);
    if (!response) throw new Error(`${stem}: request ${request.seq} has no response`);
    const data = request.data;
    const outcome = response.data;
    const observation = data.observationSeq === null ? null : bySeq.get(data.observationSeq)?.data.metrics ?? null;
    const dispatched = outcome.dispatched;
    const inputTokens = dispatched ? outcome.usage.inputTokens : null;
    const outputTokens = dispatched ? outcome.usage.outputTokens : null;
    if (dispatched) {
      if (inputTokens === null) missingInput++; else cumulativeKnownInput += inputTokens;
      if (outputTokens === null) missingOutput++; else cumulativeKnownOutput += outputTokens;
    }
    const estimatedDelta = data.kind === 'worker' && priorWorkerEstimate !== null
      ? data.estimatedInputTokens - priorWorkerEstimate : null;
    if (data.kind === 'worker') priorWorkerEstimate = data.estimatedInputTokens;
    const row = {
      taskId: entry.taskId, repeat: entry.repeat, variant: entry.variant,
      requestSeq: request.seq, responseSeq: response.seq, kind: data.kind, dispatched,
      responseError: outcome.error, successfulResponse: outcome.error === null && outcome.response !== null,
      finish: outcome.response?.finish ?? null,
      observationSeq: data.observationSeq, requestChars: data.requestChars,
      estimatedInputTokens: data.estimatedInputTokens, estimatedDeltaFromPriorWorker: estimatedDelta,
      preCompressionEstimatedTokens: observation?.preCompressionEstimatedTokens ?? null,
      olderRounds: observation?.olderRounds ?? null,
      thresholdReached: observation?.thresholdReached ?? null,
      compactionEligible: observation?.compactionEligible ?? null,
      inputTokens, outputTokens,
      cumulativeKnownInputTokens: cumulativeKnownInput,
      cumulativeKnownOutputTokens: cumulativeKnownOutput,
      cumulativeInputTokensExact: missingInput === 0 ? cumulativeKnownInput : null,
      cumulativeOutputTokensExact: missingOutput === 0 ? cumulativeKnownOutput : null,
      missingInputUsageRequests: missingInput, missingOutputUsageRequests: missingOutput,
      actualModel: outcome.response?.actualModel ?? null,
      fingerprint: outcome.response?.fingerprint ?? null,
    };
    modelRequests.push(row);
    requestRows.push(row);
  }
  const workerAttempts = requests.filter(event => event.data.kind === 'worker').length;
  const workerSuccessfulResponses = modelRequests.filter(row => row.kind === 'worker' && row.successfulResponse).length;
  const workerDispatched = modelRequests.filter(row => row.kind === 'worker' && row.dispatched).length;
  if (workerDispatched !== result.agent.workerRequests || modelRequests.filter(row => row.dispatched).length !== result.agent.modelRequests) {
    throw new Error(`${stem}: request count mismatch`);
  }

  const tools = events.filter(event => event.type === 'tool_start').map(start => {
    const end = toolEnds.get(start.seq);
    if (!end) throw new Error(`${stem}: tool_start ${start.seq} has no tool_end`);
    const call = start.data.call;
    const info = argumentsInfo(call.arguments);
    return {
      startSeq: start.seq, endSeq: end.seq, callId: call.id, name: call.name,
      rawArguments: call.arguments, ...info, key: `${call.name}\0${info.canonicalArguments}`,
      dispatched: end.data.dispatched, ok: end.data.result?.ok ?? false,
      errorCode: end.data.result?.errorCode ?? end.data.error ?? null,
      output: end.data.result?.output ?? null,
      outputTruncated: end.data.result?.truncated ?? null,
      outputSha256: end.data.result ? sha(end.data.result.output) : null,
    };
  });
  const dispatchedTools = tools.filter(tool => tool.dispatched);
  if (dispatchedTools.length !== result.agent.toolCalls) throw new Error(`${stem}: tool count mismatch`);
  const repeats = calls => {
    const counts = new Map();
    let consecutive = 0;
    for (const [index, tool] of calls.entries()) {
      counts.set(tool.key, (counts.get(tool.key) ?? 0) + 1);
      if (index > 0 && calls[index - 1].key === tool.key) consecutive++;
    }
    return { counts, exact: [...counts.values()].reduce((sum, count) => sum + Math.max(count - 1, 0), 0), consecutive };
  };
  const allRepeats = repeats(tools);
  const dispatchedRepeats = repeats(dispatchedTools);
  const exactRepeatCount = allRepeats.exact;
  const consecutiveRepeatCount = allRepeats.consecutive;
  for (const [key, count] of allRepeats.counts) if (count > 1) {
    const matching = tools.filter(tool => tool.key === key);
    repeatedRows.push({ taskId: entry.taskId, variant: entry.variant, repeat: entry.repeat, name: matching[0].name,
      canonicalArguments: matching[0].canonicalArguments, occurrences: count, repeats: count - 1,
      startSeqs: matching.map(tool => tool.startSeq), dispatchedStartSeqs: matching.filter(tool => tool.dispatched).map(tool => tool.startSeq) });
  }
  const readBacks = [];
  const priorReads = new Map();
  for (const tool of dispatchedTools) {
    if (tool.name !== 'read_file' || tool.path === null) continue;
    const previous = priorReads.get(tool.path);
    if (previous) {
      const mutations = dispatchedTools.filter(candidate => candidate.startSeq > previous.startSeq
        && candidate.startSeq < tool.startSeq && candidate.path === tool.path
        && ['write_file', 'edit_file', 'delete_file'].includes(candidate.name) && candidate.ok);
      const row = { taskId: entry.taskId, variant: entry.variant, repeat: entry.repeat, path: tool.path,
        previousStartSeq: previous.startSeq, currentStartSeq: tool.startSeq,
        previousCallId: previous.callId, currentCallId: tool.callId,
        previousOk: previous.ok, currentOk: tool.ok,
        successfulReadBack: tool.ok, comparableOutputs: previous.ok && tool.ok,
        sameVisibleOutput: previous.ok && tool.ok ? previous.output === tool.output : null,
        previousOutputSha256: previous.outputSha256, currentOutputSha256: tool.outputSha256,
        interveningSuccessfulMutations: mutations.map(item => ({ name: item.name, callId: item.callId, startSeq: item.startSeq, endSeq: item.endSeq })),
      };
      readBacks.push(row);
      readBackRows.push(row);
    }
    priorReads.set(tool.path, tool);
  }
  const toolErrors = dispatchedTools.filter(tool => !tool.ok).map(tool => {
    const later = dispatchedTools.filter(item => item.startSeq > tool.startSeq);
    const laterWorkers = modelRequests.filter(item => item.kind === 'worker' && item.requestSeq > tool.endSeq);
    const row = { taskId: entry.taskId, variant: entry.variant, repeat: entry.repeat, callId: tool.callId,
      name: tool.name, path: tool.path, errorCode: tool.errorCode,
      startSeq: tool.startSeq, endSeq: tool.endSeq,
      nextWorkerRequestSeq: laterWorkers[0]?.requestSeq ?? null,
      nextSuccessfulWorkerResponseSeq: laterWorkers.find(item => item.successfulResponse)?.responseSeq ?? null,
      laterSameKeySuccessfulStartSeqs: later.filter(item => item.key === tool.key && item.ok).map(item => item.startSeq),
      laterSamePathSuccessfulStartSeqs: later.filter(item => item.path !== null && item.path === tool.path && item.ok).map(item => item.startSeq),
      laterToolStartSeqs: later.map(item => item.startSeq),
      correctionConclusion: null, // requires human review of the later response/actions
    };
    errorRows.push(row);
    return row;
  });
  if (toolErrors.length !== result.agent.toolErrors) throw new Error(`${stem}: tool error count mismatch`);

  const changes = await readJson(path.join(attemptDir, 'changes.json'));
  const compacted = events.filter(event => event.type === 'context_compacted');
  const attemptCompactions = compacted.map(event => {
    const post = observations.find(observation => observation.seq > event.seq);
    const response = responses.get(event.data.summaryRequestSeq);
    const summary = event.data.summary;
    const invokedTools = [...summary.matchAll(/<｜｜DSML｜｜ invoke name="([^"]+)"/g)].map(match => match[1]);
    return {
      taskId: entry.taskId, variant: entry.variant, repeat: entry.repeat, orderIndex: entry.orderIndex,
      compactedSeq: event.seq, summaryRequestSeq: event.data.summaryRequestSeq,
      summaryResponseSeq: event.data.summaryResponseSeq,
      fromMessageIndex: event.data.fromMessageIndex, toMessageIndex: event.data.toMessageIndex,
      preCompressionEstimatedTokens: post?.data.metrics.preCompressionEstimatedTokens ?? null,
      postCompressionEstimatedTokens: post?.data.metrics.estimatedInputTokens ?? null,
      estimatedTokenReduction: post ? post.data.metrics.preCompressionEstimatedTokens - post.data.metrics.estimatedInputTokens : null,
      postObservationSeq: post?.seq ?? null,
      summaryText: summary,
      summaryChars: summary.length,
      containsDSMLCalls: invokedTools.length > 0,
      invokedToolNames: invokedTools,
      responseFinish: response?.data.response?.finish ?? null,
      responseError: response?.data.error ?? null,
    };
  });
  compactionRows.push(...attemptCompactions);
  const attemptOptimizer = requests.filter(event => event.data.kind === 'optimizer').map(request => {
    const response = responses.get(request.seq);
    return {
      taskId: entry.taskId, variant: entry.variant, repeat: entry.repeat, orderIndex: entry.orderIndex,
      requestSeq: request.seq, responseSeq: response?.seq ?? null,
      dispatched: response?.data.dispatched ?? false,
      responseError: response?.data.error ?? null,
      finish: response?.data.response?.finish ?? null,
      acceptedText: response?.data.response?.content ?? null,
      actualModel: response?.data.response?.actualModel ?? null,
      fingerprint: response?.data.response?.fingerprint ?? null,
    };
  });
  optimizerRows.push(...attemptOptimizer);
  const checks = {};
  for (const [label, check] of [['public', result.publicTest], ['acceptance', result.acceptanceTest]]) {
    checks[label] = { passed: check.passed, completed: check.completed, testCount: check.testCount,
      passedTests: check.passedTests, failedTests: check.failedTests, timedOut: check.timedOut,
      outputPath: path.relative(runRoot, check.outputPath),
      failedAssertions: assertionRows(await readFile(check.outputPath, 'utf8')) };
  }
  const attempt = {
    schemaVersion: 1, runId: manifest.runId, taskId: entry.taskId, suite: result.suite,
    repeat: entry.repeat, variant: entry.variant, orderIndex: entry.orderIndex,
    journalPath: path.relative(runRoot, journalPath), resultPath: path.relative(runRoot, resultFile),
    passed: result.passed, functionalPass: result.publicTest.passed && result.acceptanceTest.passed,
    failureReason: result.failureReason,
    termination: result.agent.termination, answer: result.agent.answer,
    integrity: result.integrity, changedPaths: result.integrity.changedPaths,
    changes: changes.map(item => ({ path: item.path, kind: item.kind })), checks,
    model: { workerRequestAttempts: workerAttempts, workerDispatched, workerSuccessfulResponses,
      totalRequestAttempts: requests.length, totalDispatchedRequests: result.agent.modelRequests,
      optimizerRequests: result.agent.optimizerRequests, summaryRequests: result.agent.summaryRequests,
      inputTokens: result.agent.inputTokens, outputTokens: result.agent.outputTokens,
      knownInputTokens: result.agent.knownInputTokens, knownOutputTokens: result.agent.knownOutputTokens,
      missingInputUsageRequests: missingInput, missingOutputUsageRequests: missingOutput,
      contextStats: result.agent.contextStats, observationOnly,
      compactions: attemptCompactions, optimizerOutputs: attemptOptimizer },
    requests: modelRequests,
    tools: { toolStartCount: tools.length, dispatchedCount: dispatchedTools.length, skippedCount: tools.length - dispatchedTools.length,
      repeatBasis: 'all tool_start intents, including undispatched; quota uses dispatchedCount only',
      exactRepeatCount, consecutiveRepeatCount,
      dispatchedExactRepeatCount: dispatchedRepeats.exact, dispatchedConsecutiveRepeatCount: dispatchedRepeats.consecutive,
      readBackAttempts: readBacks.length, readBackCount: readBacks.filter(row => row.successfulReadBack).length,
      comparableReadBacks: readBacks.filter(row => row.comparableOutputs).length,
      errorCount: toolErrors.length, calls: tools.map(({ output, key, ...safe }) => safe),
      repeatedKeys: repeatedRows.filter(row => row.taskId === entry.taskId && row.variant === entry.variant && row.repeat === entry.repeat),
      readBacks, errors: toolErrors },
  };
  await writeJson(path.join(outDir, 'attempts', `${stem}.json`), attempt);
  processed.push(stem);
  summaryRows.push({ taskId: entry.taskId, suite: result.suite, repeat: entry.repeat, variant: entry.variant,
    passed: result.passed, functionalPass: attempt.functionalPass,
    termination: result.agent.termination, failureReason: result.failureReason,
    workerAttempts, workerDispatched, workerSuccessfulResponses, modelRequests: result.agent.modelRequests,
    toolStarts: tools.length, toolCalls: dispatchedTools.length, skippedToolStarts: tools.length - dispatchedTools.length,
    toolErrors: toolErrors.length, exactRepeatCount, consecutiveRepeatCount,
    dispatchedExactRepeatCount: dispatchedRepeats.exact, dispatchedConsecutiveRepeatCount: dispatchedRepeats.consecutive,
    readBackCount: attempt.tools.readBackCount, observationOnly: observationOnly.length,
    peakRequestChars: result.agent.contextStats.peakRequestChars,
    peakEstimatedInputTokens: result.agent.contextStats.peakEstimatedInputTokens,
    thresholdRequests: result.agent.contextStats.thresholdRequests,
    eligibleCompactionRequests: result.agent.contextStats.eligibleCompactionRequests,
    inputTokens: result.agent.inputTokens, outputTokens: result.agent.outputTokens,
    knownInputTokens: result.agent.knownInputTokens, knownOutputTokens: result.agent.knownOutputTokens,
    changedPaths: result.integrity.changedPaths.join(';'),
    publicPassed: checks.public.passed, publicPassedTests: checks.public.passedTests,
    publicFailedTests: checks.public.failedTests,
    publicFailedNames: checks.public.failedAssertions.map(item => item.name).join(';'),
    acceptancePassed: checks.acceptance.passed, acceptancePassedTests: checks.acceptance.passedTests,
    acceptanceFailedTests: checks.acceptance.failedTests,
    acceptanceFailedNames: checks.acceptance.failedAssertions.map(item => item.name).join(';'),
    compactions: attemptCompactions.length, optimizerOutputs: attemptOptimizer.length });
  const runEnd = events.find(event => event.type === 'run_end');
  const failedAssertions = [...checks.public.failedAssertions.map(assertion => ({ suite: 'public', ...assertion })),
    ...checks.acceptance.failedAssertions.map(assertion => ({ suite: 'acceptance', ...assertion }))];
  if (!result.passed) failureRows.push({
    runId: manifest.runId, taskId: entry.taskId, suite: result.suite, variant: entry.variant,
    repeat: entry.repeat, orderIndex: entry.orderIndex, passed: result.passed,
    failureReason: result.failureReason, termination: result.agent.termination,
    runEndSeq: runEnd?.seq ?? null,
    failedAssertions,
    modelErrorResponseSeqs: modelRequests.filter(row => row.responseError !== null).map(row => row.responseSeq),
    toolErrorSeqs: toolErrors.map(row => ({ startSeq: row.startSeq, endSeq: row.endSeq, errorCode: row.errorCode })),
    journalPath: path.relative(runRoot, journalPath),
    resultPath: path.relative(runRoot, resultFile),
    publicOutputPath: checks.public.outputPath, acceptanceOutputPath: checks.acceptance.outputPath,
  });
}
if (missing.length && !partial) throw new Error(`incomplete schedule: ${processed.length}/${manifest.schedule.length}; missing ${missing.slice(0, 5).join(', ')}`);
const allFiles = [
  ['attempt-summary.csv', summaryRows], ['request-growth.csv', requestRows],
  ['tool-errors.csv', errorRows], ['read-backs.csv', readBackRows], ['repeated-calls.csv', repeatedRows],
  ['failures.csv', failureRows], ['compactions.csv', compactionRows], ['optimizer-outputs.csv', optimizerRows],
];
for (const [name, rows] of allFiles) {
  const columns = rows.length ? Object.keys(rows[0]) : name === 'attempt-summary.csv'
    ? ['taskId', 'repeat', 'passed'] : ['taskId', 'repeat'];
  await writeFile(path.join(outDir, name), table(columns, rows.map(row => columns.map(key =>
    typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : row[key]))), { flag: 'wx' });
  if (name === 'request-growth.csv') await writeFile(path.join(outDir, 'request-growth.md'),
    `# Per-request growth (${processed.length}/${manifest.schedule.length} attempts)\n\n`
    + markdown(columns, rows.map(row => columns.map(key => row[key]))), { flag: 'wx' });
}
await writeJson(path.join(outDir, 'compactions.json'), compactionRows);
await writeJson(path.join(outDir, 'optimizer-outputs.json'), optimizerRows);
await writeJson(path.join(outDir, 'index.json'), { schemaVersion: 1, runId: manifest.runId,
  sourceRunRoot: runRoot, expectedAttempts: manifest.schedule.length,
  processedAttempts: processed.length, complete: missing.length === 0,
  processed, missing, compactions: compactionRows.length, optimizerOutputs: optimizerRows.length,
  failedAttempts: failureRows.length,
  note: 'Rows are isolated by taskId, variant, and repeat. Machine-derived observations only. Cause and correction require human trace review.' });
console.log(JSON.stringify({ outDir, runId: manifest.runId, expected: manifest.schedule.length,
  processed: processed.length, missing: missing.length,
  requestRows: requestRows.length, toolErrors: errorRows.length, readBackRows: readBackRows.length,
  failures: failureRows.length, compactions: compactionRows.length, optimizerOutputs: optimizerRows.length }));
