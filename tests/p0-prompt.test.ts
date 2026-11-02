import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectJournal } from '../eval/journal-metrics.js';
import { parseEvent, readJournal } from '../src/journal.js';
import type { RequestData } from '../src/model-events.js';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import { createRuntime } from '../src/runtime.js';
import type { RunConfig } from '../src/types.js';

test('P0 worker receives exact files and quotas; verifier rejects forged system', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'p0-prompt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  const config: RunConfig = {
    schemaVersion: 1, variant: 'baseline',
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'mock', temperature: 0 },
    budget: { maxModelRequests: 10, maxToolCalls: 3, timeoutMs: 5000, maxOutputTokens: 96, maxInputChars: 50000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 1 },
    workspace, writable: ['src/a.ts', 'src/b.ts'], sessionPath: path.join(root, 'journal.jsonl'),
  };
  const systems: string[] = [];
  const runtime = await createRuntime(config, { modelPlugin: ({ model, accounting }) =>
    mockModelPlugin({ model, accounting, script: [
      request => { systems.push(request.system); return { content: '', calls: [{ id: 'r', name: 'read_file', arguments: '{"path":"missing.txt"}' }], finish: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null }; },
      request => { systems.push(request.system); return { content: 'done', calls: [], finish: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, actualModel: 'mock', fingerprint: null }; },
    ] }) });
  const result = await runtime.run('Fix files');
  assert.equal(result.termination, 'completed');
  assert.match(systems[0]!, /src\/a\.ts/);
  assert.match(systems[0]!, /src\/b\.ts/);
  assert.match(systems[0]!, /10 remaining model requests including this worker/);
  assert.match(systems[1]!, /9 remaining model requests including this worker/);
  assert.match(systems[0]!, /3 remaining tool calls/);
  assert.match(systems[1]!, /2 remaining tool calls/);
  assert.match(systems[0]!, /96 output tokens per request/);
  assert.match(systems[0]!, /no shell or test execution/);
  const journal = await readJournal(config.sessionPath);
  assert.equal(inspectJournal(journal, config).requests.length, 2);
  const forged = structuredClone(journal);
  const req = forged.events.find(e => e.type === 'request')!;
  const data = req.data as RequestData;
  data.body = data.body.replace('src/a.ts', 'src/z.ts');
  data.requestChars = data.body.length;
  assert.throws(() => inspectJournal(forged, config), /worker system|request body/);
  const quotaForgery = structuredClone(journal);
  const quota = quotaForgery.events.find(e => e.type === 'request')!.data as RequestData;
  quota.body = quota.body.replace('10 remaining model requests', '99 remaining model requests');
  quota.requestChars = quota.body.length;
  assert.throws(() => inspectJournal(quotaForgery, config), /worker system/);
  const missingVersion = structuredClone(journal);
  delete (missingVersion.events[0]!.data as { promptVersion?: number }).promptVersion;
  assert.throws(() => inspectJournal(missingVersion, config), /worker system/);
  assert.throws(() => parseEvent({ schemaVersion: 1, seq: 1, type: 'run_start', elapsedMs: 0,
    data: { input: 'Fix files', promptVersion: 3 } }), /promptVersion/);
});
