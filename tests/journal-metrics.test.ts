import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectJournal } from '../eval/journal-metrics.js';
import { readJournal, type JournalRead } from '../src/journal.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { createRuntime, type Runtime } from '../src/runtime.js';
import type { ModelResponse, RunConfig } from '../src/types.js';

const response = (content: string, usage: ModelResponse['usage'] = { inputTokens: 4, outputTokens: 2 }): ModelResponse =>
  ({ content, calls: [], finish: 'stop', usage, actualModel: 'actual', fingerprint: 'fp' });

async function fixture(t: test.TestContext, script: MockStep[], change: Partial<RunConfig['budget']> = {}, signal?: AbortSignal,
  onReady?: (runtime: Runtime) => void) {
  const root = await mkdtemp(path.join(tmpdir(), 'journal-metrics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const config: RunConfig = {
    schemaVersion: 1, variant: 'baseline',
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'configured', temperature: 0 },
    budget: { maxModelRequests: 3, maxToolCalls: 2, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 20000, ...change },
    context: { estimatedWindowTokens: 100, triggerRatio: 0.5, keepRecentRounds: 1 },
    workspace, writable: [], sessionPath: path.join(root, 'journal.jsonl'),
  };
  const runtime = await createRuntime(config, {
    ...(signal ? { signal } : {}),
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script }),
  });
  onReady?.(runtime);
  const result = await runtime.run('do it');
  return { config, result, journal: await readJournal(config.sessionPath) };
}

function altered(journal: JournalRead, type: string, modify: (data: any) => void): JournalRead {
  const copy = structuredClone(journal);
  const event = copy.events.find(e => e.type === type);
  assert.ok(event);
  modify(event.data);
  return copy;
}

test('M4.4 recomputes a completed runtime journal and missing usage', async t => {
  const f = await fixture(t, [response('done', { inputTokens: null, outputTokens: 2 })]);
  const metrics = inspectJournal(f.journal, f.config);
  assert.deepEqual(metrics.result, f.result);
  assert.equal(metrics.requests.length, 1);
  assert.equal(metrics.inputKnownRequests, 0);
  assert.equal(metrics.outputKnownRequests, 1);
  assert.equal(metrics.completeUsageRequests, 0);
  assert.equal(metrics.requests[0]?.estimatedInputTokens, metrics.requests[0]?.preCompressionEstimatedTokens);
  assert.equal(metrics.requests[0]?.actualModel, 'actual');
});

test('M4.4 detects altered result, context observation, body, and uncounted auxiliary request', async t => {
  const f = await fixture(t, [response('done')]);
  assert.throws(() => inspectJournal(altered(f.journal, 'run_end', data => { data.result.modelRequests = 0; }), f.config), /modelRequests/);
  assert.throws(() => inspectJournal(altered(f.journal, 'context_observation', data => { data.metrics.olderRounds = 4; }), f.config), /olderRounds|context|compactionEligible/);
  assert.throws(() => inspectJournal(altered(f.journal, 'request', data => { data.estimatedInputTokens = 1; }), f.config), /estimatedInputTokens/);
  const extra = structuredClone(f.journal);
  const end = extra.events.pop()!;
  const request = structuredClone(extra.events.find(e => e.type === 'request')!);
  const reply = structuredClone(extra.events.find(e => e.type === 'response')!);
  request.seq = end.seq;
  (request.data as any).kind = 'summary';
  (request.data as any).observationSeq = null;
  reply.seq = end.seq + 1;
  (reply.data as any).kind = 'summary';
  (reply.data as any).requestSeq = request.seq;
  end.seq += 2;
  request.elapsedMs = extra.events.at(-1)!.elapsedMs;
  reply.elapsedMs = request.elapsedMs;
  extra.events.push(request, reply, end);
  assert.throws(() => inspectJournal(extra, f.config), /modelRequests|summaryRequests|unexpected summary request/);
});

test('M4.4 accepts unmatched hard overflow observation and rejects pending request evidence', async t => {
  const f = await fixture(t, [response('unused')], { maxInputChars: 1 });
  assert.equal(f.result.termination, 'context_overflow');
  assert.equal(inspectJournal(f.journal, f.config).requests.length, 0);
  const g = await fixture(t, [response('done')]);
  const pending = structuredClone(g.journal);
  const reply = pending.events.findIndex(e => e.type === 'response');
  if (reply >= 0) pending.events.splice(reply, 1);
  const assistant = pending.events.findIndex(e => e.type === 'message' && (e.data as any).message.role === 'assistant');
  if (assistant >= 0) pending.events.splice(assistant, 1);
  pending.events.forEach((event, index) => { event.seq = index + 1; });
  assert.throws(() => inspectJournal({ status: 'complete', events: pending.events }, g.config), /request|incomplete/);
});

test('M4.4 counts dispatched tools, errors, and a request-limit run', async t => {
  const call = { id: 'read', name: 'read_file', arguments: '{"path":"absent.txt"}' };
  const f = await fixture(t, [
    { ...response(''), calls: [call], finish: 'tool_calls' },
    { ...response(''), calls: [{ ...call, id: 'again' }], finish: 'tool_calls' },
  ], { maxModelRequests: 2 });
  assert.equal(f.result.termination, 'request_limit');
  const metrics = inspectJournal(f.journal, f.config);
  assert.equal(metrics.requests.length, 2);
  assert.equal(metrics.result.toolCalls, 2);
  assert.equal(metrics.result.toolErrors, 2);
  assert.throws(() => inspectJournal(altered(f.journal, 'run_end', data => { data.result.toolErrors = 0; }), f.config), /toolErrors/);
});

test('M4.4 preserves dispatched usage on timeout and cancellation', async t => {
  const timed = await fixture(t, [async () => {
    await new Promise(resolve => setTimeout(resolve, 80));
    return response('late');
  }], { timeoutMs: 30 });
  assert.equal(timed.result.termination, 'timeout');
  assert.equal(inspectJournal(timed.journal, timed.config).requests.length, 1);
  const controller = new AbortController();
  const cancelled = await fixture(t, [async () => {
    controller.abort();
    return response('late');
  }], {}, controller.signal);
  assert.equal(cancelled.result.termination, 'cancelled');
  assert.equal(inspectJournal(cancelled.journal, cancelled.config).requests.length, 1);
});

test('M4.4 accepts cancellation after a committed assistant message without response error', async t => {
  const controller = new AbortController();
  const f = await fixture(t, [response('done')], {}, controller.signal, runtime => {
    runtime.context.get('events').on(event => {
      if (event.type === 'message' && (event.data as { message: { role: string } }).message.role === 'assistant') controller.abort();
    });
  });
  assert.equal(f.result.termination, 'cancelled');
  assert.equal(f.journal.events.some(event => event.type === 'response' &&
    (event.data as { error: string | null }).error !== null), false);
  assert.equal(inspectJournal(f.journal, f.config).requests.length, 1);
});
