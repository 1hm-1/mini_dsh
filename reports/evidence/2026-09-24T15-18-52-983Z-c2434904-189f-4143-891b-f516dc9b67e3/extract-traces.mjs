#!/usr/bin/env node
// Save only selected, sequence-preserving raw events needed to review claims in the M9 report.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [runArg, evidenceArg] = process.argv.slice(2);
if (!runArg || !evidenceArg) throw new Error('usage: extract-traces.mjs RUN_ROOT EVIDENCE_ROOT');
const runRoot = path.resolve(runArg);
const evidenceRoot = path.resolve(evidenceArg);
const tracesDir = path.join(evidenceRoot, 'traces');
const selection = JSON.parse(await readFile(path.join(tracesDir, 'selection.json'), 'utf8'));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
await mkdir(path.join(tracesDir, 'selected'));
const extracted = [];
for (const selected of selection.selected) {
  const source = path.join(runRoot, 'attempts', selected.stem, 'journal.jsonl');
  const sourceBytes = await readFile(source);
  const events = sourceBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  const bySeq = new Map(events.map(event => [event.seq, event]));
  const requests = events.filter(event => event.type === 'request');
  const responses = events.filter(event => event.type === 'response');
  const responseFor = request => responses.find(event => event.data.requestSeq === request.seq);
  const keep = new Set();
  for (const event of events) if (event.type === 'run_start' || event.type === 'run_end' || event.type === 'context_compacted') keep.add(event.seq);
  for (const request of requests.filter(event => event.data.kind !== 'worker')) {
    keep.add(request.seq);
    const response = responseFor(request);
    if (response) keep.add(response.seq);
  }
  for (const response of responses) if (response.data.error !== null) {
    keep.add(response.data.requestSeq); keep.add(response.seq);
  }
  const toolEnds = new Map(events.filter(event => event.type === 'tool_end').map(event => [event.data.startSeq, event]));
  for (const start of events.filter(event => event.type === 'tool_start')) {
    const end = toolEnds.get(start.seq);
    if (end && (end.data.error !== null || end.data.result?.ok === false)) { keep.add(start.seq); keep.add(end.seq); }
  }
  const writes = events.filter(event => event.type === 'tool_start'
    && ['write_file', 'edit_file', 'delete_file'].includes(event.data.call?.name))
    .filter(event => {
      const end = toolEnds.get(event.seq);
      return end?.data.dispatched === true && end.data.result?.ok === true;
    });
  for (const start of [writes[0], writes.at(-1)].filter(Boolean)) {
    keep.add(start.seq);
    const end = toolEnds.get(start.seq);
    if (end) keep.add(end.seq);
  }
  const workerRequests = requests.filter(event => event.data.kind === 'worker');
  const lastWorkerResponse = responseFor(workerRequests.at(-1));
  if (lastWorkerResponse) keep.add(lastWorkerResponse.seq);
  const selectedEvents = events.filter(event => keep.has(event.seq));
  for (const event of selectedEvents) if (!bySeq.has(event.seq)) throw new Error(`${selected.stem}: missing seq ${event.seq}`);
  const result = await readJson(path.join(runRoot, 'attempts', selected.stem, 'result.json'));
  const attempt = await readJson(path.join(evidenceRoot, 'metrics', 'attempts', `${selected.stem}.json`));
  const output = { schemaVersion: 1, runId: result.runId, taskId: result.taskId, suite: result.suite,
    variant: result.variant, repeat: result.repeat, orderIndex: result.orderIndex,
    selectedReasons: selected.reasons, passed: result.passed, failureReason: result.failureReason,
    termination: result.agent.termination, sourceJournalPath: `runs/${result.runId}/${attempt.journalPath}`,
    sourceJournalSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    eventSelection: 'run_start/run_end; every auxiliary request+response and context_compacted event; model/tool error events; first and last successful write/edit/delete tool calls with paired ends; final worker response; deduplicated and sorted by original seq.',
    eventSeqs: selectedEvents.map(event => event.seq), events: selectedEvents };
  await writeFile(path.join(tracesDir, 'selected', `${selected.stem}.json`), `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  extracted.push({ stem: selected.stem, variant: result.variant, orderIndex: result.orderIndex,
    reasons: selected.reasons, sourceJournalPath: output.sourceJournalPath, eventSeqs: output.eventSeqs });
}
const cases = [];
for (const [stem, files] of [
  ['m01-report-optimizer-1', ['parser.mjs']],
  ['m01-report-full-1', ['parser.mjs']],
  ['m02-options-context-1', ['resolver.mjs']],
  ['m02-options-full-3', ['resolver.mjs']],
]) {
  const beforeAfter = await readJson(path.join(runRoot, 'attempts', stem, 'after.json'));
  const attempt = await readJson(path.join(evidenceRoot, 'metrics', 'attempts', `${stem}.json`));
  cases.push({ stem, taskId: attempt.taskId, variant: attempt.variant, repeat: attempt.repeat,
    passed: attempt.passed, termination: attempt.termination,
    failedAcceptanceAssertions: attempt.checks.acceptance.failedAssertions,
    sourceArtifact: `runs/${attempt.runId}/attempts/${stem}/after.json`,
    afterSourceExcerpts: beforeAfter.entries.filter(entry => files.includes(entry.path))
      .map(entry => ({ path: entry.path, sha256: entry.sha256, content: entry.content })),
    optimizerTracePath: `traces/selected/${stem}.json` });
}
await writeFile(path.join(tracesDir, 'constraint-cases.json'), `${JSON.stringify(cases, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ selectedTraces: extracted.length,
  extractedEvents: extracted.reduce((sum, row) => sum + row.eventSeqs.length, 0),
  constraintCases: cases.length }));
