import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectJournal } from '../eval/journal-metrics.js';
import { parseEvent, readJournal, type JournalRead } from '../src/journal.js';
import { encodeChatRequest } from '../src/model-protocol.js';
import { SUMMARY_PREFIX, SUMMARY_SYSTEM } from '../src/plugins/context-manager.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { createRuntime } from '../src/runtime.js';
import { BASE_SYSTEM } from '../src/runtime.js';
import type { Message, ModelRequest, ModelResponse, RunConfig, ToolSchema } from '../src/types.js';

const model = { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'mock', temperature: 0 };
const tools: ToolSchema[] = [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }];
const usage = { inputTokens: 10, outputTokens: 2 };
const config: RunConfig = {
  schemaVersion: 1, variant: 'context', model,
  budget: { maxModelRequests: 8, maxToolCalls: 5, timeoutMs: 10000, maxOutputTokens: 100,
    maxInputChars: 100000 },
  context: { estimatedWindowTokens: 1, triggerRatio: 0.5, keepRecentRounds: 1 },
  workspace: '/tmp/context-journal-workspace', writable: [], sessionPath: '/tmp/context-journal.jsonl',
};
const system = BASE_SYSTEM;
const original: Message = { role: 'user', content: 'task' };
const call = (i: number) => ({ id: `call-${i}`, name: 'read_file', arguments: `{"path":"${i}.txt"}` });
const assistant = (i: number): Message => ({ role: 'assistant', content: `step ${i}`, calls: [call(i)] });
const toolMessage = (i: number): Message => ({ role: 'tool', callId: `call-${i}`,
  content: JSON.stringify({ ok: true, output: `file ${i}`, errorCode: null, truncated: false }) });
const completed: Message = { role: 'assistant', content: 'done', calls: [] };
const summaryResponse = (content: string, calls: ModelResponse['calls'] = []): ModelResponse => ({
  content, calls, finish: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 3, outputTokens: 1 },
  actualModel: null, fingerprint: null,
});

function fixture(schemas: ToolSchema[] = tools) {
  const tools = schemas;
  const events: JournalRead['events'] = [];
  const emit = (type: string, data: unknown) => {
    const event = parseEvent({ schemaVersion: 1, seq: events.length + 1, type, elapsedMs: events.length, data });
    events.push(event);
    return event.seq;
  };
  const history: Message[] = [];
  const workerEstimates: number[] = [];
  const workerChars: number[] = [];
  const emitRequest = (kind: ModelRequest['kind'], messages: Message[], requestSystem: string,
    schemas: ToolSchema[], maxOutputTokens: number, pre?: number, older?: number) => {
    const request = { kind, system: requestSystem, messages, tools: schemas, maxOutputTokens,
      signal: new AbortController().signal } satisfies ModelRequest;
    const body = encodeChatRequest(model, request);
    const estimatedInputTokens = Math.ceil(JSON.stringify({ system: requestSystem, messages, tools: schemas }).length / 4);
    const observationSeq = kind === 'worker' ? emit('context_observation', { metrics: {
      requestChars: body.length, estimatedInputTokens, preCompressionEstimatedTokens: pre ?? estimatedInputTokens,
      olderRounds: older ?? 0, thresholdReached: true, compactionEligible: (older ?? 0) > 0,
    } }) : null;
    const seq = emit('request', { kind, body, requestChars: body.length, estimatedInputTokens, observationSeq });
    if (kind === 'worker') { workerEstimates.push(estimatedInputTokens); workerChars.push(body.length); }
    return seq;
  };
  const respond = (requestSeq: number, kind: ModelRequest['kind'], response: ModelResponse) =>
    emit('response', { requestSeq, kind, dispatched: true, response, usage: response.usage, error: null });
  const worker = (messages: Message[], answer: Message, pre?: number, older = 0) => {
    const requestSeq = emitRequest('worker', messages, system, tools, config.budget.maxOutputTokens, pre, older);
    const response: ModelResponse = { content: answer.content,
      calls: answer.role === 'assistant' ? answer.calls : [],
      finish: answer.role === 'assistant' && answer.calls.length ? 'tool_calls' : 'stop',
      usage, actualModel: null, fingerprint: null };
    respond(requestSeq, 'worker', response);
    emit('message', { message: answer });
    history.push(answer);
    if (answer.role === 'assistant' && answer.calls.length) {
      const toolStart = emit('tool_start', { call: answer.calls[0] });
      const result = { ok: true, output: `file ${answer.calls[0]!.id.slice(-1)}`, errorCode: null, truncated: false };
      emit('tool_end', { startSeq: toolStart, dispatched: true, result, error: null });
      const tool: Message = { role: 'tool', callId: answer.calls[0]!.id, content: JSON.stringify(result) };
      emit('message', { message: tool });
      history.push(tool);
    }
  };
  emit('run_start', { input: 'task' });
  emit('message', { message: original });
  history.push(original);
  worker([...history], assistant(1));
  worker([...history], assistant(2));
  const beforeFirst = Math.ceil(JSON.stringify({ system, messages: history, tools }).length / 4);
  const summaryOneRequestSeq = emitRequest('summary', [assistant(1), toolMessage(1)], SUMMARY_SYSTEM, [], 100);
  const summaryOneResponseSeq = respond(summaryOneRequestSeq, 'summary', summaryResponse('  first summary  '));
  emit('context_compacted', { fromMessageIndex: 1, toMessageIndex: 3, summary: 'first summary',
    summaryRequestSeq: summaryOneRequestSeq, summaryResponseSeq: summaryOneResponseSeq });
  const afterFirst: Message[] = [original, { role: 'user', content: SUMMARY_PREFIX + 'first summary' }, assistant(2), toolMessage(2)];
  worker(afterFirst, assistant(3), beforeFirst, 1);
  const beforeSecond: Message[] = [...afterFirst, assistant(3), toolMessage(3)];
  const preSecond = Math.ceil(JSON.stringify({ system, messages: beforeSecond, tools }).length / 4);
  const summaryTwoRequestSeq = emitRequest('summary', [
    { role: 'user', content: SUMMARY_PREFIX + 'first summary' }, assistant(2), toolMessage(2),
  ], SUMMARY_SYSTEM, [], 100);
  const summaryTwoResponseSeq = respond(summaryTwoRequestSeq, 'summary', summaryResponse('second summary'));
  emit('context_compacted', { fromMessageIndex: 3, toMessageIndex: 5, summary: 'second summary',
    summaryRequestSeq: summaryTwoRequestSeq, summaryResponseSeq: summaryTwoResponseSeq });
  const afterSecond: Message[] = [original, { role: 'user', content: SUMMARY_PREFIX + 'second summary' }, assistant(3), toolMessage(3)];
  worker(afterSecond, completed, preSecond, 1);
  const result = { schemaVersion: 1 as const, termination: 'completed' as const, answer: 'done',
    modelRequests: 6, workerRequests: 4, optimizerRequests: 0, summaryRequests: 2,
    toolCalls: 3, toolErrors: 0, inputTokens: 46, outputTokens: 10,
    knownInputTokens: 46, knownOutputTokens: 10, durationMs: 100,
    compactions: 2, error: null,
    contextStats: { workerRequests: 4,
      meanEstimatedInputTokens: workerEstimates.reduce((a, b) => a + b, 0) / 4,
      peakEstimatedInputTokens: Math.max(...workerEstimates), peakRequestChars: Math.max(...workerChars),
      thresholdRequests: 4, eligibleCompactionRequests: 2 },
  };
  emit('run_end', { result });
  return { journal: { status: 'complete' as const, events }, result,
    summaryOneRequestSeq, summaryOneResponseSeq, summaryTwoRequestSeq, summaryTwoResponseSeq };
}

function altered(change: (journal: JournalRead) => void): JournalRead {
  const journal = structuredClone(fixture().journal);
  change(journal);
  return journal;
}

test('M7.3 accepts two incremental compactions and recomputes all six requests', () => {
  const f = fixture();
  const metrics = inspectJournal(f.journal, config);
  assert.deepEqual(metrics.result, f.result);
  assert.equal(metrics.requests.length, 6);
  assert.deepEqual(metrics.requests.map(row => row.kind), ['worker', 'worker', 'summary', 'worker', 'summary', 'worker']);
  assert.equal(metrics.requests[3]?.olderRounds, 1);
  assert.equal(metrics.requests[5]?.olderRounds, 1);
  assert.equal(metrics.result.compactions, 2);
});

test('M7.3 rejects changed boundary, summary, response reference and missing compaction', () => {
  for (const change of [
    (j: JournalRead) => { (j.events.find(e => e.type === 'context_compacted')!.data as any).fromMessageIndex = 0; },
    (j: JournalRead) => { (j.events.find(e => e.type === 'context_compacted')!.data as any).toMessageIndex = 4; },
    (j: JournalRead) => { (j.events.find(e => e.type === 'context_compacted')!.data as any).summary = 'forged'; },
    (j: JournalRead) => { (j.events.find(e => e.type === 'context_compacted')!.data as any).summaryResponseSeq = fixture().summaryTwoResponseSeq; },
    (j: JournalRead) => { j.events.splice(j.events.findIndex(e => e.type === 'context_compacted'), 1);
      j.events.forEach((event, index) => { event.seq = index + 1; }); },
  ]) assert.throws(() => inspectJournal(altered(change), config));
});

test('M7.3 rejects altered summary request body, tools, output cap and post-compaction worker projection', () => {
  const changes = [
    (body: any) => { body.messages[0].content = 'different'; },
    (body: any) => { body.tools = [{ type: 'function', function: { name: 'x', description: 'x', parameters: {} } }]; },
    (body: any) => { body.max_completion_tokens = 99; },
    (body: any) => { body.messages.push({ role: 'user', content: 'extra' }); },
  ];
  for (const change of changes) {
    const j = altered(journal => {
      const request = journal.events.find(e => e.type === 'request' && (e.data as any).kind === 'summary')!;
      const data = request.data as any;
      const body = JSON.parse(data.body);
      change(body);
      data.body = JSON.stringify(body);
      data.requestChars = data.body.length;
      data.estimatedInputTokens = Math.ceil(JSON.stringify({ system: body.messages[0].content,
        messages: [], tools: [] }).length / 4);
    });
    assert.throws(() => inspectJournal(j, config));
  }
  const j = altered(journal => {
    const worker = journal.events.filter(e => e.type === 'request' && (e.data as any).kind === 'worker')[2]!;
    const data = worker.data as any;
    const body = JSON.parse(data.body);
    body.messages[2].content = 'wrong recent round';
    data.body = JSON.stringify(body);
    data.requestChars = data.body.length;
  });
  assert.throws(() => inspectJournal(j, config));
});

test('M7.3 rejects altered precompression and olderRounds despite matching post projection', () => {
  for (const key of ['preCompressionEstimatedTokens', 'olderRounds'] as const) {
    const j = altered(journal => {
      const observation = journal.events.filter(e => e.type === 'context_observation')[2]!;
      (observation.data as any).metrics[key]++;
    });
    assert.throws(() => inspectJournal(j, config), new RegExp(key));
  }
});

test('M7.3 rejects a same-length worker system substituted after compaction', () => {
  const journal = altered(value => {
    const worker = value.events.filter(e => e.type === 'request' && (e.data as any).kind === 'worker')[2]!;
    const data = worker.data as any;
    const body = JSON.parse(data.body);
    const oldSystem = body.messages[0].content as string;
    body.messages[0].content = 'X' + oldSystem.slice(1);
    assert.equal(body.messages[0].content.length, oldSystem.length);
    data.body = JSON.stringify(body);
  });
  assert.throws(() => inspectJournal(journal, config), /worker system/);
});

async function runtimeFixture(t: test.TestContext, script: MockStep[], controller?: AbortController) {
  const root = await mkdtemp(path.join(tmpdir(), 'context-journal-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'fact.txt'), 'fact');
  const runtimeConfig: RunConfig = { ...config, model: { ...model },
    budget: { ...config.budget, maxOutputTokens: 4096 },
    workspace, sessionPath: path.join(root, 'journal.jsonl') };
  const runtime = await createRuntime(runtimeConfig, {
    ...(controller ? { signal: controller.signal } : {}),
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script }),
  });
  return { runtime, runtimeConfig };
}
const runtimeRead = (id: string): ModelResponse => ({ content: '', calls: [{ id, name: 'read_file', arguments: '{"path":"fact.txt"}' }],
  finish: 'tool_calls', usage, actualModel: null, fingerprint: null });

test('M7.3 recomputes an actual context runtime journal, including a committed summary', async t => {
  const f = await runtimeFixture(t, [runtimeRead('a'), runtimeRead('b'), summaryResponse('saved'),
    { content: 'done', calls: [], finish: 'stop', usage, actualModel: null, fingerprint: null }]);
  const result = await f.runtime.run('task');
  const journal = await readJournal(f.runtimeConfig.sessionPath);
  assert.equal(result.termination, 'completed');
  assert.equal(result.compactions, 1);
  assert.deepEqual(inspectJournal(journal, f.runtimeConfig).result, result);
});

test('M7.3 accepts cancellation at a semantic-invalid summary response commit', async t => {
  for (const bad of [summaryResponse('   '), summaryResponse('', [call(9)])]) {
    const controller = new AbortController();
    const f = await runtimeFixture(t, [runtimeRead('a'), runtimeRead('b'), bad], controller);
    f.runtime.context.get('events').on(event => {
      if (event.type === 'response' && (event.data as { kind?: string }).kind === 'summary') controller.abort();
    });
    const result = await f.runtime.run('task');
    assert.equal(result.termination, 'cancelled');
    assert.equal(result.compactions, 0);
    const journal = await readJournal(f.runtimeConfig.sessionPath);
    assert.deepEqual(inspectJournal(journal, f.runtimeConfig).result, result);
  }
});

test('M7.3 requires cancellation or timeout when a valid summary response is uncommitted', async t => {
  const controller = new AbortController();
  const f = await runtimeFixture(t, [runtimeRead('a'), runtimeRead('b'), summaryResponse('valid summary')], controller);
  f.runtime.context.get('events').on(event => {
    if (event.type === 'response' && (event.data as { kind?: string }).kind === 'summary') controller.abort();
  });
  const result = await f.runtime.run('task');
  assert.equal(result.termination, 'cancelled');
  const journal = await readJournal(f.runtimeConfig.sessionPath);
  assert.deepEqual(inspectJournal(journal, f.runtimeConfig).result, result);
  const fake = structuredClone(journal);
  const runEnd = fake.events.at(-1)!.data as { result: typeof result };
  runEnd.result.termination = 'model_error';
  runEnd.result.error = 'model_error';
  assert.throws(() => inspectJournal(fake, f.runtimeConfig), /summary termination/);
});

test('M7.3 accepts semantic-invalid summary as model_error without a compaction', async t => {
  const f = await runtimeFixture(t, [runtimeRead('a'), runtimeRead('b'), summaryResponse('  ')]);
  const result = await f.runtime.run('task');
  assert.equal(result.termination, 'model_error');
  assert.equal(result.compactions, 0);
  assert.deepEqual(inspectJournal(await readJournal(f.runtimeConfig.sessionPath), f.runtimeConfig).result, result);
});

test('M7.3 rejects a claimed summary overflow without enough input-length evidence', () => {
  const f = fixture();
  const journal = structuredClone(f.journal);
  const firstSummary = journal.events.findIndex(e => e.type === 'request' && (e.data as any).kind === 'summary');
  const summaryLength = (journal.events[firstSummary]!.data as any).requestChars as number;
  const earlierRequests = journal.events.slice(0, firstSummary).filter(e => e.type === 'request');
  const maxWorkerLength = Math.max(...earlierRequests.map(e => (e.data as any).requestChars as number));
  const hardConfig: RunConfig = { ...config, budget: { ...config.budget,
    maxInputChars: Math.max(summaryLength, maxWorkerLength) + 1 } };
  journal.events.splice(firstSummary);
  const firstTwoEstimates = earlierRequests.map(e => (e.data as any).estimatedInputTokens as number);
  const firstTwoChars = earlierRequests.map(e => (e.data as any).requestChars as number);
  const result = { ...f.result, termination: 'context_overflow' as const, answer: null,
    modelRequests: 2, workerRequests: 2, summaryRequests: 0, toolCalls: 2,
    inputTokens: 20, outputTokens: 4, knownInputTokens: 20, knownOutputTokens: 4,
    compactions: 0, error: 'context_overflow',
    contextStats: { workerRequests: 2,
      meanEstimatedInputTokens: (firstTwoEstimates[0]! + firstTwoEstimates[1]!) / 2,
      peakEstimatedInputTokens: Math.max(...firstTwoEstimates), peakRequestChars: Math.max(...firstTwoChars),
      thresholdRequests: 2, eligibleCompactionRequests: 0 } };
  journal.events.push(parseEvent({ schemaVersion: 1, seq: journal.events.length + 1, type: 'run_end',
    elapsedMs: journal.events.length, data: { result } }));
  assert.throws(() => inspectJournal(journal, hardConfig), /context_overflow|termination/);
});
