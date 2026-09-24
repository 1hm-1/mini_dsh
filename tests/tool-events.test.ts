import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseEvent, readJournal } from '../src/journal.js';
import { parseToolEventData, parseToolResult } from '../src/tool-events.js';
import type { Event, RunResult, ToolCall, ToolResult } from '../src/types.js';

const call: ToolCall = { id: 'a', name: 'read_file', arguments: '{"path":"a"}' };
const second: ToolCall = { id: 'b', name: 'read_file', arguments: '{"path":"b"}' };
const result: ToolResult = { ok: true, output: 'contents', errorCode: null, truncated: false };
const failed: ToolResult = { ok: false, output: 'denied', errorCode: 'permission_denied', truncated: false };
const runResult: RunResult = { schemaVersion: 1, termination: 'completed', answer: 'done', modelRequests: 0,
  workerRequests: 0, optimizerRequests: 0, summaryRequests: 0, toolCalls: 0, toolErrors: 0,
  inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0, durationMs: 0,
  compactions: 0, error: null, contextStats: { workerRequests: 0, meanEstimatedInputTokens: null,
    peakEstimatedInputTokens: null, peakRequestChars: null, thresholdRequests: 0,
    eligibleCompactionRequests: 0 } };
const e = (seq: number, type: string, data: unknown): Event =>
  ({ schemaVersion: 1, seq, type, elapsedMs: seq, data });
const start = e(1, 'run_start', { input: 'task' });
const assistant = (seq: number, calls: ToolCall[]) =>
  e(seq, 'message', { message: { role: 'assistant', content: '', calls } });
const toolStart = (seq: number, selected: ToolCall) => e(seq, 'tool_start', { call: selected });
const toolEnd = (seq: number, startSeq: number, dispatched: boolean, value: ToolResult | null,
  error: string | null) => e(seq, 'tool_end', { startSeq, dispatched, result: value, error });
const message = (seq: number, selected: ToolCall, value: unknown) =>
  e(seq, 'message', { message: { role: 'tool', callId: selected.id, content: JSON.stringify(value) } });
const end = (seq: number, termination: RunResult['termination'] = 'completed') =>
  e(seq, 'run_end', { result: { ...runResult, termination } });

async function journal(events: Event[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tool-events-'));
  const file = path.join(directory, 'run.jsonl');
  try {
    await writeFile(file, events.map(item => JSON.stringify(item)).join('\n') + '\n');
    return await readJournal(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('tool payload parser checks exact types, outcome and output cap', () => {
  const source = { call: { ...call } };
  const parsed = parseToolEventData('tool_start', source);
  source.call.name = 'changed';
  assert.deepEqual(parsed, { call });
  assert.deepEqual(parseToolResult(result), result);
  assert.deepEqual(parseEvent(toolEnd(2, 1, true, failed, null)).data,
    { startSeq: 1, dispatched: true, result: failed, error: null });
  assert.throws(() => parseToolResult({ ...result, extra: true }), /fields/i);
  assert.throws(() => parseToolResult({ ...result, errorCode: 'x' }), /errorCode/i);
  assert.throws(() => parseToolResult({ ...failed, errorCode: '' }), /errorCode/i);
  assert.throws(() => parseToolResult({ ...result, output: 'x'.repeat(16001) }), /output/i);
  assert.throws(() => parseEvent(toolStart(2, { ...call, name: '' })), /name/i);
  assert.throws(() => parseEvent(toolEnd(2, 1, true, null, 'tool_limit')), /tool_limit/i);
  assert.throws(() => parseEvent(toolEnd(2, 1, false, result, null)), /dispatched|result/i);
  assert.throws(() => parseEvent(toolEnd(2, 1, true, null, null)), /error/i);
  assert.deepEqual(parseEvent(toolEnd(2, 1, false, null, 'internal_error')).data,
    { startSeq: 1, dispatched: false, result: null, error: 'internal_error' });
});

test('journal accepts serial tool events and exact persisted result messages', async () => {
  const events = [start, assistant(2, [call, second]), toolStart(3, call), toolEnd(4, 3, true, result, null),
    message(5, call, result), toolStart(6, second), toolEnd(7, 6, true, failed, null),
    message(8, second, failed), end(9)];
  assert.equal((await journal(events)).status, 'complete');
  assert.equal((await journal([start, assistant(2, [call]), toolStart(3, call)])).status, 'incomplete');
  assert.equal((await journal([start, assistant(2, [call]), toolStart(3, call), toolEnd(4, 3, true, result, null)])).status, 'incomplete');
  await assert.rejects(journal([...events.slice(0, 4), end(5)]), /missing|pending/i);
});

test('journal rejects mismatched, duplicate, concurrent and fabricated tool outcomes', async () => {
  const prefix = [start, assistant(2, [call, second])];
  await assert.rejects(journal([...prefix, toolStart(3, second)]), /next|order|match/i);
  await assert.rejects(journal([...prefix, toolStart(3, { ...call, arguments: '{}' })]), /match/i);
  await assert.rejects(journal([...prefix, toolStart(3, call), toolStart(4, second)]), /pending|serial/i);
  await assert.rejects(journal([...prefix, toolStart(3, call), toolEnd(4, 99, true, result, null)]), /startSeq|unknown/i);
  await assert.rejects(journal([...prefix, toolStart(3, call), toolEnd(4, 3, true, result, null),
    toolEnd(5, 3, true, result, null)]), /duplicate|unknown|pending/i);
  await assert.rejects(journal([...prefix, toolStart(3, call), message(4, call, result)]), /tool_end|result|pending/i);
  await assert.rejects(journal([...prefix, toolStart(3, call), toolEnd(4, 3, true, result, null),
    message(5, call, { ...result, output: 'forged' })]), /match|result/i);
  await assert.rejects(journal([...prefix, toolStart(3, call), toolEnd(4, 3, false, null, 'tool_limit'),
    message(5, call, result)]), /result|skip/i);
  await assert.rejects(journal([...prefix, toolStart(3, call), toolEnd(4, 3, true, result, null),
    toolStart(5, second)]), /message|result/i);
});

test('skipped suffix remains inspectable but cannot execute or complete', async () => {
  const prefix = [start, assistant(2, [call, second]), toolStart(3, call),
    toolEnd(4, 3, false, null, 'tool_limit')];
  assert.equal((await journal([...prefix, toolStart(5, second),
    toolEnd(6, 5, false, null, 'tool_limit'), end(7, 'tool_limit')])).status, 'complete');
  await assert.rejects(journal([...prefix, toolStart(5, second),
    toolEnd(6, 5, true, result, null)]), /skip|budget|dispatched/i);
  await assert.rejects(journal([...prefix, end(5)]), /missing|result/i);
  assert.equal((await journal([...prefix, end(5, 'tool_limit')])).status, 'complete');
});

test('terminal tool errors prohibit another tool dispatch', async () => {
  const prefix = [start, assistant(2, [call, second]), toolStart(3, call),
    toolEnd(4, 3, true, null, 'timeout')];
  await assert.rejects(journal([...prefix, toolStart(5, second),
    toolEnd(6, 5, true, result, null)]), /terminal|dispatch|error/i);
});

test('journal rejects model request while an assistant tool call remains unresolved', async () => {
  await assert.rejects(journal([start, assistant(2, [call]),
    e(3, 'request', { kind: 'summary', body: '{}', requestChars: 2,
      estimatedInputTokens: 1, observationSeq: null })]), /request before tool results/i);
});

test('tool call ids may recur in a later assistant round', async () => {
  const events = [start, assistant(2, [call]), toolStart(3, call), toolEnd(4, 3, true, result, null),
    message(5, call, result), assistant(6, [call]), toolStart(7, call),
    toolEnd(8, 7, true, result, null), message(9, call, result), end(10)];
  assert.equal((await journal(events)).status, 'complete');
});
