import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readJournal } from '../src/journal.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { createRuntime } from '../src/runtime.js';
import type { ModelResponse, RunConfig } from '../src/types.js';

const answer = (content: string, calls: ModelResponse['calls'] = []): ModelResponse => ({
  content, calls, finish: calls.length ? 'tool_calls' : 'stop',
  usage: { inputTokens: 2, outputTokens: 1 }, actualModel: 'mock', fingerprint: null,
});
const call = (id: string) => answer('', [{ id, name: 'read_file', arguments: '{"path":"missing.txt"}' }]);
async function fixture(t: test.TestContext, variant: RunConfig['variant'], maxModelRequests: number, script: MockStep[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'context-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  const config: RunConfig = { schemaVersion: 1, variant,
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'mock', temperature: 0 },
    budget: { maxModelRequests, maxToolCalls: 3, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 1, triggerRatio: 0.5, keepRecentRounds: 1 },
    workspace, writable: [], sessionPath: path.join(root, 'journal.jsonl') };
  const requests: string[] = [];
  const runtime = await createRuntime(config, { modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting,
    script: script.map(step => (request, signal, index) => { requests.push(request.kind); return typeof step === 'function' ? step(request, signal, index) : step; }) }) });
  const result = await runtime.run('keep original task');
  const journal = await readJournal(config.sessionPath);
  return { result, journal, requests };
}

test('M7.3 context summary shares quota and persists compaction before worker', async t => {
  const f = await fixture(t, 'context', 4, [call('a'), call('b'), request => {
    assert.equal(request.kind, 'summary'); assert.deepEqual(request.tools, []); assert.equal(request.maxOutputTokens, 100);
    return answer('Earlier reads failed.');
  }, request => {
    assert.equal(request.kind, 'worker');
    assert.deepEqual(request.messages[0], { role: 'user', content: 'keep original task' });
    assert.match(JSON.stringify(request.messages), /Earlier reads failed/);
    assert.match(JSON.stringify(request.messages), /callId.*b/);
    return answer('done');
  }]);
  assert.equal(f.result.termination, 'completed');
  assert.deepEqual(f.requests, ['worker', 'worker', 'summary', 'worker']);
  assert.equal(f.result.modelRequests, 4); assert.equal(f.result.summaryRequests, 1);
  assert.equal(f.result.workerRequests, 3); assert.equal(f.result.compactions, 1);
  const compact = f.journal.events.find(e => e.type === 'context_compacted'); assert.ok(compact);
  assert.equal(compact.seq < f.journal.events.filter(e => e.type === 'request').at(-1)!.seq, true);
  assert.equal(f.journal.events.filter(e => e.type === 'message').length, 6);
});

test('M7.3 summary consumes final quota and terminates before another worker', async t => {
  const f = await fixture(t, 'context', 3, [call('a'), call('b'), answer('summary')]);
  assert.equal(f.result.termination, 'request_limit');
  assert.deepEqual(f.requests, ['worker', 'worker', 'summary']);
  assert.equal(f.result.summaryRequests, 1); assert.equal(f.result.compactions, 1);
});

test('M7.3 baseline keeps full history without summary at the same threshold', async t => {
  const f = await fixture(t, 'baseline', 3, [call('a'), call('b'), request => {
    assert.equal(request.kind, 'worker'); assert.match(JSON.stringify(request.messages), /callId.*a/);
    return answer('done');
  }]);
  assert.equal(f.result.termination, 'completed');
  assert.deepEqual(f.requests, ['worker', 'worker', 'worker']);
  assert.equal(f.result.summaryRequests, 0); assert.equal(f.result.compactions, 0);
  assert.equal(f.journal.events.some(e => e.type === 'context_compacted'), false);
});
