import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Summary } from '../eval/report.js';
import { verify } from '../eval/verify.js';
import { variantFlags } from '../src/config.js';
import { readJournal } from '../src/journal.js';
import { optimizerMatrix } from './optimizer-fixture.js';

test('O01/O02/E06/S01/S02 four-group S/H repeated matrix preserves default budgets and verifies', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'optimizer-matrix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = await optimizerMatrix(root, path.resolve('.'));
  assert.equal(run.manifest.provider, 'mock'); assert.equal(run.manifest.phase, 'smoke');
  assert.equal(run.attempts.length, 16); assert.ok(run.attempts.every(a => a.passed));
  assert.deepEqual(run.manifest.config.context, { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 });
  for (const attempt of run.attempts) {
    const flags = variantFlags(attempt.variant);
    assert.deepEqual(attempt.config.budget, run.manifest.config.budget);
    assert.deepEqual(attempt.config.context, run.manifest.config.context);
    assert.equal(attempt.agent.optimizerRequests, flags.optimizer ? 1 : 0);
    assert.equal(attempt.agent.workerRequests, attempt.suite === 'H' ? 7 : 3);
    assert.equal(attempt.agent.modelRequests, attempt.agent.workerRequests + attempt.agent.optimizerRequests + attempt.agent.summaryRequests);
    assert.equal(attempt.agent.inputTokens, attempt.agent.modelRequests * 40);
    assert.equal(attempt.agent.outputTokens, attempt.agent.modelRequests * 20);
    assert.ok(attempt.agent.modelRequests <= 16);
    assert.equal(attempt.agent.summaryRequests, attempt.agent.compactions);
    if (flags.context && attempt.suite === 'H') assert.ok(attempt.agent.compactions > 0);
    else assert.equal(attempt.agent.compactions, 0);
    const journal = await readJournal(attempt.artifactPaths.journal!);
    assert.equal(journal.events.filter(e => e.type === 'context_compacted').length, attempt.agent.compactions);
  }
  const verified = await verify(run.runRoot);
  assert.equal(verified.passed, true, JSON.stringify(verified.errors));
  const summary = JSON.parse(await readFile(path.join(run.runRoot, 'summary.json'), 'utf8')) as Summary;
  assert.equal(summary.sampleCount, 16);
  for (const suite of Object.values(summary.byVariant)) {
    assert.equal(suite.S.success.count, 2); assert.equal(suite.H.success.count, 2);
    assert.equal(suite.overall.success.count, 4);
  }
  assert.deepEqual(summary.fullMinusBaselinePercentagePoints, { S: 0, H: 0, overall: 0 });
  assert.ok((await readFile(path.join(run.runRoot, 'report.md'), 'utf8')).includes('mock'));
});
