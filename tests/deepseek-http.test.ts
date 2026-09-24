import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectJournal } from '../eval/journal-metrics.js';
import { readJournal } from '../src/journal.js';
import type { RequestData } from '../src/model-events.js';
import { createRuntime } from '../src/runtime.js';
import type { RunConfig } from '../src/types.js';

test('DeepSeek HTTP plugin completes offline read/edit/final with exact wire-body accounting', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'deepseek-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'sum.mjs'), 'export const sum = (a, b) => a - b;\n');
  const config: RunConfig = {
    schemaVersion: 1, variant: 'baseline',
    model: { endpoint: 'https://api.deepseek.com/chat/completions', id: 'deepseek-flash', temperature: 0 },
    budget: { maxModelRequests: 3, maxToolCalls: 2, timeoutMs: 5000, maxOutputTokens: 64, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace, writable: ['sum.mjs'], sessionPath: path.join(root, 'journal.jsonl'),
  };
  const bodies: string[] = [];
  // Intercept fetch before creating the default HTTP runtime; there is no network fallback.
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, config.model.endpoint);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer offline-deepseek-test-key');
    assert.equal(typeof init?.body, 'string');
    const body = init!.body as string;
    bodies.push(body);
    const decoded = JSON.parse(body);
    assert.equal(decoded.max_tokens, 64);
    assert.deepEqual(decoded.thinking, { type: 'disabled' });
    assert.equal(Object.hasOwn(decoded, 'max_completion_tokens'), false);
    assert.equal(Object.hasOwn(decoded, 'n'), false);
    assert.ok(bodies.length <= 3);
    const call = bodies.length === 1
      ? { id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"sum.mjs"}' } }
      : bodies.length === 2
        ? { id: 'edit', type: 'function', function: { name: 'edit_file', arguments: '{"path":"sum.mjs","oldText":"a - b","newText":"a + b"}' } }
        : null;
    return Response.json({ model: 'deepseek-flash', usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: { role: 'assistant',
        content: call ? null : 'fixed', ...(call ? { tool_calls: [call] } : {}) } }] });
  });
  const previous = process.env.HARNESS_API_KEY;
  process.env.HARNESS_API_KEY = 'offline-deepseek-test-key';
  const runtime = await (async () => {
    try { return await createRuntime(config); }
    finally {
      if (previous === undefined) delete process.env.HARNESS_API_KEY;
      else process.env.HARNESS_API_KEY = previous;
    }
  })();
  t.after(() => runtime.dispose());
  const result = await runtime.run('Fix sum.mjs to add both arguments.');
  assert.equal(result.termination, 'completed');
  assert.equal(result.modelRequests, 3);
  assert.equal(result.toolCalls, 2);
  assert.equal(await readFile(path.join(workspace, 'sum.mjs'), 'utf8'), 'export const sum = (a, b) => a + b;\n');
  const journal = await readJournal(config.sessionPath);
  const requests = journal.events.filter(event => event.type === 'request').map(event => event.data as RequestData);
  assert.deepEqual(requests.map(event => event.body), bodies);
  assert.deepEqual(requests.map(event => event.requestChars), bodies.map(body => body.length));
  const finalMessages = JSON.parse(bodies[2]!).messages;
  assert.deepEqual(finalMessages.filter((message: { role: string }) => message.role === 'tool')
    .map((message: { tool_call_id: string }) => message.tool_call_id), ['read', 'edit']);
  const metrics = inspectJournal(journal, config);
  assert.deepEqual(metrics.result, result);
  assert.equal(metrics.requests.length, 3);
  assert.equal(result.knownInputTokens, 30);
  assert.equal(result.knownOutputTokens, 15);
  assert.doesNotMatch(await readFile(config.sessionPath, 'utf8'), /offline-deepseek-test-key/);
});
