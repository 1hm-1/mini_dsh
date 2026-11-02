import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectJournal } from '../eval/journal-metrics.js';
import { readJournal } from '../src/journal.js';
import type { RequestData } from '../src/model-events.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { createRuntime } from '../src/runtime.js';
import type { ToolEndData } from '../src/tool-events.js';
import type { ModelResponse, RunConfig, Variant } from '../src/types.js';

const reply = (content: string, calls: ModelResponse['calls'] = []): ModelResponse => ({
  content, calls, finish: calls.length ? 'tool_calls' : 'stop',
  usage: { inputTokens: 8, outputTokens: 4 }, actualModel: 'p0-offline', fingerprint: null,
});
const read = (id: string) => ({ id, name: 'read_file', arguments: '{"path":"readonly.txt"}' });

async function fixture(t: test.TestContext, variant: Variant = 'baseline') {
  const root = await mkdtemp(path.join(tmpdir(), 'p0-boundaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'readonly.txt'), 'original');
  const config: RunConfig = {
    schemaVersion: 1, variant,
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'p0-offline', temperature: 0 },
    budget: { maxModelRequests: 10, maxToolCalls: 3, timeoutMs: 10000,
      maxOutputTokens: 4096, maxInputChars: 128000 },
    context: { estimatedWindowTokens: 1, triggerRatio: 0.75, keepRecentRounds: 1 },
    writable: [], workspace, sessionPath: path.join(root, 'journal.jsonl'),
  };
  return { config, workspace };
}

for (const variant of ['baseline', 'context', 'optimizer', 'full'] as const) {
  test('P0 independently accounts shared and denied-tool costs for ' + variant, async t => {
    const f = await fixture(t, variant);
    let workers = 0;
    let dispatchedTools = 0;
    const observed: Array<{ system: string; remainingModels: number; remainingTools: number }> = [];
    const runtime = await createRuntime(f.config, {
      modelPlugin: ({ model, accounting }) => {
        const step: MockStep = request => {
          if (request.kind === 'optimizer') return reply('Preserve the original task and permissions.');
          if (request.kind === 'summary') return reply('The file was read. No tests were executed.');
          observed.push({ system: request.system,
            remainingModels: f.config.budget.maxModelRequests - accounting.modelRequests + 1,
            remainingTools: f.config.budget.maxToolCalls - dispatchedTools });
          assert.equal(request.tools.length, 5);
          assert.ok(request.messages.some(m => m.role === 'user' && m.content === 'Inspect the file; do not modify it.'));
          workers++;
          if (workers === 1) return reply('', [read('first')]);
          if (workers === 2) return reply('', [
            { id: 'denied', name: 'write_file', arguments: '{"path":"readonly.txt","content":"forbidden"}' },
            read('second'),
          ]);
          return reply('Inspected; tests were not run.');
        };
        return mockModelPlugin({ model, accounting, script: Array.from({ length: 10 }, () => step) });
      },
    });
    runtime.context.get('events').on(event => {
      if (event.type === 'tool_end' && (event.data as ToolEndData).dispatched) dispatchedTools++;
    });
    const result = await runtime.run('Inspect the file; do not modify it.');
    assert.equal(result.termination, 'completed');
    assert.equal(result.toolCalls, 3);
    assert.equal(result.toolErrors, 1);
    assert.equal(result.optimizerRequests, variant === 'optimizer' || variant === 'full' ? 1 : 0);
    assert.equal(result.summaryRequests, variant === 'context' || variant === 'full' ? 1 : 0);
    assert.equal(observed.length, 3);
    for (const observation of observed) {
      assert.equal(Number(observation.system.match(/(\d+) remaining model requests including this worker/)?.[1]),
        observation.remainingModels);
      assert.equal(Number(observation.system.match(/(\d+) remaining tool calls/)?.[1]),
        observation.remainingTools);
      assert.match(observation.system, /4096 output tokens per request/);
      assert.match(observation.system, /\[\]/);
    }
    assert.equal(observed.at(-1)!.remainingTools, 0);
    assert.equal(await readFile(path.join(f.workspace, 'readonly.txt'), 'utf8'), 'original');
    const journal = await readJournal(f.config.sessionPath);
    assert.deepEqual(inspectJournal(journal, f.config).result, result);
    for (const [before, after] of [
      [String(observed.at(-1)!.remainingModels) + ' remaining model requests', '9 remaining model requests'],
      ['0 remaining tool calls', '1 remaining tool calls'],
    ]) {
      const forged = structuredClone(journal);
      const lastRequest = forged.events.filter(e => e.type === 'request'
        && (e.data as RequestData).kind === 'worker').at(-1)!.data as RequestData;
      assert.ok(lastRequest.body.includes(before!));
      lastRequest.body = lastRequest.body.replace(before!, after!);
      assert.throws(() => inspectJournal(forged, f.config), /worker system/);
    }
  });
}

test('P0 budget guidance cannot turn a tool quota overrun into completed', async t => {
  const f = await fixture(t);
  f.config.budget.maxToolCalls = 1;
  const runtime = await createRuntime(f.config, {
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting,
      script: [reply('', [read('first')]), reply('', [read('overrun')]), reply('must not run')] }),
  });
  const result = await runtime.run('Inspect the file.');
  assert.equal(result.termination, 'tool_limit');
  assert.equal(result.modelRequests, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.answer, null);
  assert.deepEqual(inspectJournal(await readJournal(f.config.sessionPath), f.config).result, result);
});

test('P0 concise-output guidance preserves charged length errors without retry', async t => {
  const f = await fixture(t);
  const runtime = await createRuntime(f.config, {
    modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting,
      script: [{ ...reply('truncated'), finish: 'length', usage: { inputTokens: 8, outputTokens: 4096 } },
        reply('must not retry')] }),
  });
  const result = await runtime.run('Inspect the file.');
  assert.equal(result.termination, 'model_error');
  assert.equal(result.modelRequests, 1);
  assert.equal(result.outputTokens, 4096);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.answer, null);
  assert.deepEqual(inspectJournal(await readJournal(f.config.sessionPath), f.config).result, result);
});
