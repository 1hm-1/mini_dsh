import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readJournal } from '../src/journal.js';
import { SUGGESTION_LABEL } from '../src/plugins/agent-loop.js';
import { mockModelPlugin, type MockStep } from '../src/plugins/mock-model.js';
import { BASE_SYSTEM, createRuntime } from '../src/runtime.js';
import type { RunConfig, Variant } from '../src/types.js';

const reply = (content: string) => ({ content, calls: [], finish: 'stop' as const,
  usage: { inputTokens: 3, outputTokens: 2 }, actualModel: 'mock', fingerprint: null });

async function fixture(variant: Variant, script: MockStep[], maxModelRequests = 2) {
  const root = await mkdtemp(path.join(tmpdir(), 'optimizer-runtime-'));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const journal = path.join(root, 'journal.jsonl');
  const config: RunConfig = {
    schemaVersion: 1, variant,
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'mock', temperature: 0 },
    budget: { maxModelRequests, maxToolCalls: 2, timeoutMs: 5000, maxOutputTokens: 96, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    workspace, writable: [], sessionPath: journal,
  };
  const runtime = await createRuntime(config, { modelPlugin: ({ model, accounting }) =>
    mockModelPlugin({ model, accounting, script }) });
  return { root, journal, runtime };
}

test('O01 four variants preserve original user, use the same worker rules and count one optional optimizer call', async () => {
  for (const variant of ['baseline', 'context', 'optimizer', 'full'] as const) {
    const seen: string[] = [];
    const script: MockStep[] = [
      request => {
        seen.push(request.kind);
        if (request.kind === 'optimizer') {
          assert.equal(request.messages.length, 1);
          assert.deepEqual(request.messages[0], { role: 'user', content: 'Fix sum; keep empty input behavior.' });
          assert.deepEqual(request.tools, []);
          assert.equal(request.maxOutputTokens, 96);
          return reply('Keep empty input behavior while fixing sum.');
        }
        assert.equal(request.system, BASE_SYSTEM);
        assert.deepEqual(request.messages[0], { role: 'user', content: 'Fix sum; keep empty input behavior.' });
        return reply('Done.');
      },
      request => {
        seen.push(request.kind);
        assert.equal(request.kind, 'worker');
        assert.equal(request.system, BASE_SYSTEM + SUGGESTION_LABEL + 'Keep empty input behavior while fixing sum.');
        assert.deepEqual(request.messages[0], { role: 'user', content: 'Fix sum; keep empty input behavior.' });
        return reply('Done.');
      },
    ];
    const f = await fixture(variant, script);
    try {
      assert.equal(f.runtime.context.has('promptOptimizer'), variant === 'optimizer' || variant === 'full');
      const result = await f.runtime.run('Fix sum; keep empty input behavior.');
      assert.equal(result.termination, 'completed');
      assert.equal(result.optimizerRequests, variant === 'optimizer' || variant === 'full' ? 1 : 0);
      assert.equal(result.workerRequests, 1);
      assert.equal(result.modelRequests, result.optimizerRequests + 1);
      assert.deepEqual(seen, result.optimizerRequests ? ['optimizer', 'worker'] : ['worker']);
      const replay = await readJournal(f.journal);
      assert.equal(replay.status, 'complete');
      assert.deepEqual(replay.events.filter(event => event.type === 'request').map(event => (event.data as { kind: string }).kind), seen);
    } finally { await f.runtime.dispose(); await rm(f.root, { recursive: true, force: true }); }
  }
});

test('O02 optimizer consumes the sole request and worker does not run', async () => {
  const f = await fixture('optimizer', [reply('Reworded task'), reply('Unexpected worker')], 1);
  try {
    const result = await f.runtime.run('Original task');
    assert.equal(result.termination, 'request_limit');
    assert.equal(result.optimizerRequests, 1);
    assert.equal(result.workerRequests, 0);
    assert.equal(result.modelRequests, 1);
  } finally { await f.runtime.dispose(); await rm(f.root, { recursive: true, force: true }); }
});

test('O02 empty optimizer output ends in model_error without a worker request', async () => {
  const f = await fixture('full', [reply(' \n '), reply('Unexpected worker')]);
  try {
    const result = await f.runtime.run('Original task');
    assert.equal(result.termination, 'model_error');
    assert.equal(result.optimizerRequests, 1);
    assert.equal(result.workerRequests, 0);
  } finally { await f.runtime.dispose(); await rm(f.root, { recursive: true, force: true }); }
});
