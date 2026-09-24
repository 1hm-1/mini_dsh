import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { inspectJournal } from '../eval/journal-metrics.js';
import { readJournal, type JournalRead } from '../src/journal.js';
import { encodeChatRequest } from '../src/model-protocol.js';
import { createModelService } from '../src/plugins/model-common.js';
import { createRuntime } from '../src/runtime.js';
import type { ModelRequest, ModelResponse, RunConfig } from '../src/types.js';

const call = { id: 'read-1', name: 'read_file', arguments: '{"path":"a.txt"}' };
const request: ModelRequest = {
  kind: 'worker', system: 'Follow the task.',
  messages: [
    { role: 'user', content: 'Read a.txt' },
    { role: 'assistant', content: '', calls: [call] },
    { role: 'tool', callId: 'read-1', content: '{"ok":true}' },
  ],
  tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }],
  maxOutputTokens: 64, signal: new AbortController().signal,
  contextMetrics: { estimatedInputTokens: 1, preCompressionEstimatedTokens: 1, olderRounds: 0,
    thresholdReached: false, compactionEligible: false },
};

test('DeepSeek ChatCompletions uses max_tokens and disables thinking while preserving messages/tools', () => {
  const model = { endpoint: 'https://api.deepseek.com/chat/completions', id: 'deepseek-flash', temperature: 0 };
  const body = JSON.parse(encodeChatRequest(model, request)) as Record<string, any>;
  assert.equal(body.max_tokens, 64);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.stream, false);
  assert.equal(body.n, undefined);
  assert.equal(body.max_completion_tokens, undefined);
  assert.deepEqual(body.messages[2].tool_calls[0], {
    id: 'read-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
  });
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'read-1', content: '{"ok":true}' });
  assert.deepEqual(body.tools[0], { type: 'function', function: {
    name: 'read_file', description: 'Read a file', parameters: { type: 'object' },
  } });
});

test('only official DeepSeek origin and ChatCompletions paths select its encoding', () => {
  for (const endpoint of ['https://api.deepseek.com/chat/completions',
    'https://api.deepseek.com/v1/chat/completions?version=1']) {
    const body = JSON.parse(encodeChatRequest({ endpoint, id: 'm', temperature: 0 }, request));
    assert.equal(body.max_tokens, 64, endpoint);
    assert.deepEqual(body.thinking, { type: 'disabled' }, endpoint);
  }
  for (const endpoint of ['https://api.deepseek.com.evil.example/chat/completions',
    'http://api.deepseek.com/chat/completions', 'https://example.com/chat/completions',
    'https://api.deepseek.com/beta/completions']) {
    const body = JSON.parse(encodeChatRequest({ endpoint, id: 'm', temperature: 0 }, request));
    assert.equal(body.max_completion_tokens, 64, endpoint);
    assert.equal(body.n, 1, endpoint);
    assert.equal(body.max_tokens, undefined, endpoint);
    assert.equal(body.thinking, undefined, endpoint);
  }
  const oldCaller = JSON.parse(encodeChatRequest({ id: 'm', temperature: 0 }, request));
  assert.equal(oldCaller.max_completion_tokens, 64);
});

async function journalFixture(t: TestContext, endpoint: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'deepseek-protocol-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const config: RunConfig = {
    schemaVersion: 1, variant: 'baseline', model: { endpoint, id: 'fixture', temperature: 0 },
    budget: { maxModelRequests: 2, maxToolCalls: 2, timeoutMs: 5000, maxOutputTokens: 64, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace, writable: [], sessionPath: path.join(root, 'journal.jsonl'),
  };
  let dispatchedBody = '';
  const runtime = await createRuntime(config, { modelPlugin: ({ model, accounting }) => ({
    name: 'offline-dispatch', dependencies: ['session'], setup(ctx) {
      const service = createModelService(model, accounting, ctx.get('session'), async body => {
        dispatchedBody = body;
        const reply: ModelResponse = { content: 'done', calls: [], finish: 'stop',
          usage: { inputTokens: 7, outputTokens: 2 }, actualModel: 'fixture', fingerprint: null };
        return reply;
      });
      const remove = ctx.provide('model', service);
      return () => { service.close(); remove(); };
    },
  }) });
  const result = await runtime.run('finish');
  assert.equal(result.termination, 'completed');
  const journal = await readJournal(config.sessionPath);
  const requestEvent = journal.events.find(event => event.type === 'request');
  assert.ok(requestEvent);
  const data = requestEvent.data as { body: string; requestChars: number };
  assert.equal(data.body, dispatchedBody);
  assert.equal(data.requestChars, dispatchedBody.length);
  return { config, journal };
}

function tamper(journal: JournalRead, mutate: (body: Record<string, unknown>) => void): JournalRead {
  const copy = structuredClone(journal);
  const requestEvent = copy.events.find(event => event.type === 'request')!;
  const data = requestEvent.data as { body: string; requestChars: number };
  const body = JSON.parse(data.body) as Record<string, unknown>;
  mutate(body);
  data.body = JSON.stringify(body);
  data.requestChars = data.body.length;
  const observation = copy.events.find(event => event.type === 'context_observation')!.data as { metrics: { requestChars: number } };
  observation.metrics.requestChars = data.requestChars;
  return copy;
}

test('durable DeepSeek body exactly matches offline dispatch and verifier rejects protocol tampering', async t => {
  const { config, journal } = await journalFixture(t, 'https://api.deepseek.com/chat/completions');
  assert.equal(inspectJournal(journal, config).requests.length, 1);
  assert.throws(() => inspectJournal(tamper(journal, body => { body.thinking = { type: 'enabled' }; }), config), /thinking|protocol/i);
  assert.throws(() => inspectJournal(tamper(journal, body => { delete body.thinking; }), config), /thinking|protocol/i);
  assert.throws(() => inspectJournal(tamper(journal, body => { body.max_completion_tokens = 64; }), config), /max_completion_tokens|protocol/i);
  assert.throws(() => inspectJournal(tamper(journal, body => { delete body.max_tokens; }), config), /max_tokens|protocol/i);
  assert.throws(() => inspectJournal(tamper(journal, body => { body.reasoning_effort = 'high'; }), config), /protocol/i);
  assert.throws(() => inspectJournal(tamper(journal, body => { body.n = 1; }), config), /protocol/i);
});

test('ordinary endpoint journals retain the generic protocol', async t => {
  const { config, journal } = await journalFixture(t, 'http://127.0.0.1:1/chat/completions');
  assert.equal(inspectJournal(journal, config).requests.length, 1);
  assert.throws(() => inspectJournal(tamper(journal, body => { body.max_tokens = 64; }), config), /max_tokens|protocol/i);
});
