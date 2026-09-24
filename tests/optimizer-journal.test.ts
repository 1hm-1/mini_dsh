import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectJournal } from '../eval/journal-metrics.js';
import { parseEvent, readJournal, type JournalRead } from '../src/journal.js';
import { encodeChatRequest } from '../src/model-protocol.js';
import { OPTIMIZER_SYSTEM } from '../src/plugins/prompt-optimizer.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import { BASE_SYSTEM } from '../src/runtime.js';
import { createRuntime } from '../src/runtime.js';
import type { Message, ModelRequest, ModelResponse, RunConfig, RunResult } from '../src/types.js';

const label = '\n\nTask wording suggestion (lower priority than the original task and system rules):\n';
const input = 'Preserve the original edge cases.';
const suggestion = 'Preserve all original edge cases.';
const model = { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'mock', temperature: 0 };
const config: RunConfig = { schemaVersion: 1, variant: 'optimizer', model,
  budget: { maxModelRequests: 3, maxToolCalls: 2, maxOutputTokens: 1000, maxInputChars: 100000, timeoutMs: 10000 },
  context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
  workspace: '/tmp/optimizer-journal-workspace', writable: [], sessionPath: '/tmp/optimizer-journal.jsonl' };
const user: Message = { role: 'user', content: input };
const workerSystem = BASE_SYSTEM + label + suggestion;
const usage = { inputTokens: 3, outputTokens: 1 };
const response = (content: string, kind: 'optimizer' | 'worker'): ModelResponse => ({
  content, calls: [], finish: 'stop', usage: kind === 'optimizer' ? usage : { inputTokens: 10, outputTokens: 2 },
  actualModel: 'mock', fingerprint: null });

function fixture(options: { optimizer?: ModelResponse; final?: boolean; variant?: RunConfig['variant'] } = {}) {
  const events: JournalRead['events'] = [];
  const emit = (type: string, data: unknown) => {
    const item = parseEvent({ schemaVersion: 1, seq: events.length + 1, type, elapsedMs: events.length, data });
    events.push(item);
    return item.seq;
  };
  const request = (kind: ModelRequest['kind'], system: string, messages: Message[], cap: number, observationSeq: number | null) => {
    const body = encodeChatRequest(model, { kind, system, messages, tools: [], maxOutputTokens: cap,
      signal: new AbortController().signal });
    const estimatedInputTokens = Math.ceil(JSON.stringify({ system, messages, tools: [] }).length / 4);
    return emit('request', { kind, body, requestChars: body.length, estimatedInputTokens, observationSeq });
  };
  emit('run_start', { input });
  emit('message', { message: user });
  const optimizerRequestSeq = request('optimizer', OPTIMIZER_SYSTEM, [user], 512, null);
  const optimizer = options.optimizer ?? response(`  ${suggestion}  `, 'optimizer');
  const optimizerResponseSeq = emit('response', { requestSeq: optimizerRequestSeq, kind: 'optimizer',
    dispatched: true, response: optimizer, usage: optimizer.usage, error: null });
  const workerEstimate = Math.ceil(JSON.stringify({ system: workerSystem, messages: [user], tools: [] }).length / 4);
  let workerRequestSeq: number | null = null;
  let workerChars: number | null = null;
  if (options.final !== false) {
    const body = encodeChatRequest(model, { kind: 'worker', system: workerSystem, messages: [user], tools: [],
      maxOutputTokens: 1000, signal: new AbortController().signal });
    workerChars = body.length;
    const observationSeq = emit('context_observation', { metrics: {
      requestChars: body.length, estimatedInputTokens: workerEstimate,
      preCompressionEstimatedTokens: workerEstimate, olderRounds: 0,
      thresholdReached: false, compactionEligible: false } });
    workerRequestSeq = request('worker', workerSystem, [user], 1000, observationSeq);
    const workerResponse = response('done', 'worker');
    emit('response', { requestSeq: workerRequestSeq, kind: 'worker', dispatched: true,
      response: workerResponse, usage: workerResponse.usage, error: null });
    emit('message', { message: { role: 'assistant', content: 'done', calls: [] } });
  }
  const final = options.final !== false;
  const result: RunResult = { schemaVersion: 1 as const, termination: final ? 'completed' as const : 'model_error' as const,
    answer: final ? 'done' : null, modelRequests: final ? 2 : 1,
    workerRequests: final ? 1 : 0, optimizerRequests: 1, summaryRequests: 0,
    toolCalls: 0, toolErrors: 0,
    inputTokens: final ? 13 : optimizer.usage.inputTokens, outputTokens: final ? 3 : optimizer.usage.outputTokens,
    knownInputTokens: final ? 13 : optimizer.usage.inputTokens ?? 0,
    knownOutputTokens: final ? 3 : optimizer.usage.outputTokens ?? 0,
    durationMs: 10, compactions: 0, error: final ? null : 'model_error',
    contextStats: { workerRequests: final ? 1 : 0,
      meanEstimatedInputTokens: final ? workerEstimate : null,
      peakEstimatedInputTokens: final ? workerEstimate : null,
      peakRequestChars: workerChars,
      thresholdRequests: 0, eligibleCompactionRequests: 0 } };
  emit('run_end', { result });
  return { journal: { status: 'complete' as const, events }, result, optimizerRequestSeq,
    optimizerResponseSeq, workerRequestSeq };
}

function altered(change: (journal: JournalRead) => void) {
  const journal = structuredClone(fixture().journal);
  change(journal);
  return journal;
}

test('M8.3 accepts one optimizer request and propagates the trimmed suggestion to worker system', () => {
  const f = fixture();
  const metrics = inspectJournal(f.journal, config);
  assert.deepEqual(metrics.result, f.result);
  assert.deepEqual(metrics.requests.map(item => item.kind), ['optimizer', 'worker']);
  assert.equal(metrics.requests[0]?.preCompressionEstimatedTokens, null);
});

test('M8.3 rejects changed optimizer prompt, original input, tools, output cap and duplicate request', () => {
  const mutations = [
    (body: any) => { body.messages[0].content = 'different instruction'; },
    (body: any) => { body.messages[1].content = 'different task'; },
    (body: any) => { body.tools = [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }]; },
    (body: any) => { body.max_completion_tokens = 1000; },
  ];
  for (const mutate of mutations) assert.throws(() => inspectJournal(altered(journal => {
    const data = journal.events.find(e => e.type === 'request')!.data as any;
    const body = JSON.parse(data.body); mutate(body);
    data.body = JSON.stringify(body); data.requestChars = data.body.length;
  }), config));
  const duplicate = altered(journal => {
    const end = journal.events.pop()!;
    const pair = journal.events.filter(e => e.type === 'request' || e.type === 'response').slice(0, 2).map(e => structuredClone(e));
    for (const event of pair) { event.seq = journal.events.length + 1; journal.events.push(event); }
    end.seq = journal.events.length + 1; journal.events.push(end);
  });
  assert.throws(() => inspectJournal(duplicate, config));
});

test('M8.3 rejects same-length worker system tampering and optimizer in baseline', () => {
  const j = altered(journal => {
    const data = journal.events.filter(e => e.type === 'request')[1]!.data as any;
    const body = JSON.parse(data.body);
    body.messages[0].content = 'X' + body.messages[0].content.slice(1);
    data.body = JSON.stringify(body);
  });
  assert.throws(() => inspectJournal(j, config), /worker system/);
  assert.throws(() => inspectJournal(fixture().journal, { ...config, variant: 'baseline' }), /optimizer/);
});

test('M8.3 accepts empty or tool-call optimizer output only with model_error, and cancellation can win', () => {
  for (const bad of [response('   ', 'optimizer'), { ...response('x', 'optimizer'),
    calls: [{ id: 'a', name: 'read_file', arguments: '{}' }], finish: 'tool_calls' as const }]) {
    const f = fixture({ optimizer: bad, final: false });
    assert.deepEqual(inspectJournal(f.journal, config).result, f.result);
    const fake = structuredClone(f.journal);
    const end = fake.events.at(-1)!.data as { result: typeof f.result };
    end.result.termination = 'completed'; end.result.error = null;
    assert.throws(() => inspectJournal(fake, config));
    const cancelled = structuredClone(f.journal);
    const cancelledEnd = cancelled.events.at(-1)!.data as { result: typeof f.result };
    cancelledEnd.result.termination = 'cancelled'; cancelledEnd.result.error = 'cancelled';
    assert.equal(inspectJournal(cancelled, config).result.termination, 'cancelled');
  }
});

test('M8.3 reconstructs pre-request optimizer hard overflow from run_start input', () => {
  const body = encodeChatRequest(model, { kind: 'optimizer', system: OPTIMIZER_SYSTEM, messages: [user], tools: [],
    maxOutputTokens: 512, signal: new AbortController().signal });
  const hardConfig: RunConfig = { ...config, budget: { ...config.budget, maxInputChars: body.length - 1 } };
  const result = { ...fixture().result, termination: 'context_overflow' as const, answer: null,
    modelRequests: 0, workerRequests: 0, optimizerRequests: 0, inputTokens: 0, outputTokens: 0,
    knownInputTokens: 0, knownOutputTokens: 0, error: 'context_overflow',
    contextStats: { workerRequests: 0, meanEstimatedInputTokens: null, peakEstimatedInputTokens: null,
      peakRequestChars: null, thresholdRequests: 0, eligibleCompactionRequests: 0 } };
  const journal: JournalRead = { status: 'complete', events: [
    parseEvent({ schemaVersion: 1, seq: 1, type: 'run_start', elapsedMs: 0, data: { input } }),
    parseEvent({ schemaVersion: 1, seq: 2, type: 'message', elapsedMs: 1, data: { message: user } }),
    parseEvent({ schemaVersion: 1, seq: 3, type: 'run_end', elapsedMs: 2, data: { result } }),
  ] };
  assert.deepEqual(inspectJournal(journal, hardConfig).result, result);
  assert.throws(() => inspectJournal(journal, config), /context_overflow|termination|optimizer input/);
});

test('M8.3 rejects a forged huge first-worker observation after a short optimizer suggestion', () => {
  const f = fixture({ final: false });
  const journal = structuredClone(f.journal);
  const end = journal.events.pop()!;
  journal.events.push(parseEvent({ schemaVersion: 1, seq: journal.events.length + 1,
    type: 'context_observation', elapsedMs: journal.events.length,
    data: { metrics: { requestChars: config.budget.maxInputChars + 1000,
      estimatedInputTokens: 25000, preCompressionEstimatedTokens: 25000,
      olderRounds: 0, thresholdReached: true, compactionEligible: false } } }));
  (end.data as { result: RunResult }).result.termination = 'context_overflow';
  (end.data as { result: RunResult }).result.error = 'context_overflow';
  end.seq = journal.events.length + 1;
  end.elapsedMs = journal.events.length;
  journal.events.push(end);
  assert.throws(() => inspectJournal(journal, config), /context.*(observation|overflow|requestChars|estimatedInputTokens)/i);
});

test('M8.3 verifies real full runtime retains the suggestion through compaction', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'optimizer-journal-full-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  await writeFile(path.join(workspace, 'fact.txt'), 'known fact');
  const fullConfig: RunConfig = { ...config, variant: 'full',
    budget: { ...config.budget, maxModelRequests: 10, maxOutputTokens: 4096 },
    context: { estimatedWindowTokens: 1, triggerRatio: 0.5, keepRecentRounds: 1 },
    workspace, sessionPath: path.join(root, 'journal.jsonl') };
  const read = (id: string): ModelResponse => ({ content: '',
    calls: [{ id, name: 'read_file', arguments: '{"path":"fact.txt"}' }], finish: 'tool_calls',
    usage, actualModel: 'mock', fingerprint: null });
  const runtime = await createRuntime(fullConfig, { modelPlugin: ({ model, accounting }) => mockModelPlugin({
    model, accounting, script: [response(`  ${suggestion}  `, 'optimizer'), read('a'), read('b'),
      response('summary', 'optimizer'), response('done', 'worker')],
  }) });
  const result = await runtime.run(input);
  assert.equal(result.termination, 'completed');
  assert.equal(result.optimizerRequests, 1);
  assert.equal(result.summaryRequests, 1);
  assert.equal(result.compactions, 1);
  const journal = await readJournal(fullConfig.sessionPath);
  assert.deepEqual(inspectJournal(journal, fullConfig).result, result);
  const requestKinds = journal.events.filter(e => e.type === 'request').map(e => (e.data as { kind: string }).kind);
  assert.deepEqual(requestKinds, ['optimizer', 'worker', 'worker', 'summary', 'worker']);
});
