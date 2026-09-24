import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseEvent, readJournal } from '../src/journal.js';
import { parseModelResponse } from '../src/model-events.js';
import type { Event } from '../src/types.js';

const metrics = { requestChars: 2, estimatedInputTokens: 1, preCompressionEstimatedTokens: 1,
  olderRounds: 1, thresholdReached: true, compactionEligible: true };
const response = { content: 'ok', calls: [], finish: 'stop', usage: { inputTokens: null, outputTokens: 2 },
  actualModel: null, fingerprint: 'fp' };
const request = { kind: 'worker', body: '{}', requestChars: 2, estimatedInputTokens: 1, observationSeq: 2 };
function event(seq: number, type: string, data: unknown): Event {
  return { schemaVersion: 1, seq, type, elapsedMs: seq, data };
}
const start = event(1, 'run_start', { input: 'task' });
async function journal(events: Event[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'model-events-'));
  const file = path.join(directory, 'run.jsonl');
  try {
    await writeFile(file, events.map(item => JSON.stringify(item)).join('\n') + '\n');
    return await readJournal(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('model response parser clones and checks exact fields without finish semantics', () => {
  const input = { ...response, calls: [{ id: 'c', name: 'read_file', arguments: '{}' }] };
  const parsed = parseModelResponse(input);
  input.calls[0]!.name = 'changed';
  assert.equal(parsed.calls[0]!.name, 'read_file');
  assert.equal(parsed.finish, 'stop');
  assert.throws(() => parseModelResponse({ ...response, extra: 1 }), /fields/i);
  assert.throws(() => parseModelResponse({ ...response, calls: [
    { id: 'c', name: 'x', arguments: '{}' }, { id: 'c', name: 'y', arguments: '{}' },
  ] }), /duplicate/i);
  assert.throws(() => parseModelResponse({ ...response, usage: { inputTokens: -1, outputTokens: 0 } }), /inputTokens/i);
  assert.throws(() => parseModelResponse({ ...response, actualModel: 1 }), /actualModel/i);
});

test('model event payloads validate exact fields, JSON object body, and dispatch outcome', () => {
  assert.deepEqual(parseEvent(event(2, 'context_observation', { metrics })).data, { metrics });
  assert.deepEqual(parseEvent(event(3, 'request', request)).data, request);
  assert.deepEqual(parseEvent(event(4, 'response', { requestSeq: 3, kind: 'worker', dispatched: true,
    response, usage: response.usage, error: null })).data, { requestSeq: 3, kind: 'worker', dispatched: true,
    response, usage: response.usage, error: null });
  assert.throws(() => parseEvent(event(2, 'context_observation', { metrics: { ...metrics, observationSeq: 2 } })), /fields/i);
  assert.throws(() => parseEvent(event(2, 'context_observation', { metrics: { ...metrics, olderRounds: 0 } })), /compactionEligible/i);
  assert.throws(() => parseEvent(event(2, 'context_observation', { metrics: { ...metrics, compactionEligible: false } })), /compactionEligible/i);
  assert.throws(() => parseEvent(event(3, 'request', { ...request, body: '[]' })), /object/i);
  assert.throws(() => parseEvent(event(3, 'request', { ...request, requestChars: 3 })), /requestChars/i);
  assert.throws(() => parseEvent(event(4, 'response', { requestSeq: 3, kind: 'worker', dispatched: false,
    response, usage: { inputTokens: null, outputTokens: null }, error: 'cancelled' })), /dispatched/i);
  assert.throws(() => parseEvent(event(4, 'response', { requestSeq: 3, kind: 'worker', dispatched: true,
    response: null, usage: { inputTokens: null, outputTokens: null }, error: null })), /error/i);
  assert.throws(() => parseEvent(event(4, 'response', { requestSeq: 3, kind: 'worker', dispatched: true,
    response, usage: { inputTokens: 1, outputTokens: 2 }, error: null })), /usage/i);
  assert.deepEqual(parseEvent(event(4, 'response', { requestSeq: 3, kind: 'worker', dispatched: true,
    response, usage: response.usage, error: 'cancelled' })).data,
  { requestSeq: 3, kind: 'worker', dispatched: true, response, usage: response.usage, error: 'cancelled' });
});

test('journal binds worker observation and exactly one matching response', async () => {
  const observation = event(2, 'context_observation', { metrics });
  const intent = event(3, 'request', request);
  const outcome = event(4, 'response', { requestSeq: 3, kind: 'worker', dispatched: true,
    response, usage: response.usage, error: null });
  assert.equal((await journal([start, observation, intent])).status, 'incomplete');
  assert.equal((await journal([start, observation, intent, outcome])).status, 'incomplete');
  await assert.rejects(journal([start, event(2, 'request', { ...request, observationSeq: 1 })]), /observation/i);
  await assert.rejects(journal([start, observation, event(3, 'request', { ...request, requestChars: 3, body: '{ }' })]), /observation|requestChars/i);
  await assert.rejects(journal([start, observation, event(3, 'request', { ...request, estimatedInputTokens: 2 })]), /estimatedInputTokens/i);
  await assert.rejects(journal([start, observation, intent,
    event(4, 'response', { requestSeq: 3, kind: 'summary', dispatched: true,
      response, usage: response.usage, error: null })]), /kind/i);
  await assert.rejects(journal([start, observation, intent, outcome,
    event(5, 'response', { requestSeq: 3, kind: 'worker', dispatched: true,
      response, usage: response.usage, error: null })]), /duplicate|paired/i);
  await assert.rejects(journal([start, event(2, 'request', { ...request, kind: 'summary', observationSeq: 1 })]), /observationSeq/i);
  await assert.rejects(journal([start, observation, intent,
    event(4, 'request', { ...request })]), /concurrent/i);
  await assert.rejects(journal([start, observation, intent, outcome,
    event(5, 'request', request)]), /already referenced/i);
});

test('completed run rejects pending request, while interrupted run can retain intent', async () => {
  const result = { schemaVersion: 1, termination: 'completed', answer: 'ok', modelRequests: 0,
    workerRequests: 0, optimizerRequests: 0, summaryRequests: 0, toolCalls: 0, toolErrors: 0,
    inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0,
    durationMs: 0, compactions: 0, error: null,
    contextStats: { workerRequests: 0, meanEstimatedInputTokens: null, peakEstimatedInputTokens: null,
      peakRequestChars: null, thresholdRequests: 0, eligibleCompactionRequests: 0 } };
  const events = [start, event(2, 'context_observation', { metrics }),
    event(3, 'request', request)];
  await assert.rejects(journal([...events, event(4, 'run_end', { result })]), /pending|response/i);
  assert.equal((await journal([...events, event(4, 'run_end', {
    result: { ...result, termination: 'io_error', answer: null },
  })])).status, 'complete');
});
