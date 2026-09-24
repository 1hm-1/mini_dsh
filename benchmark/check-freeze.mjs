// Read-only Git/asset validation; no HTTP requests or API key lookup.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEvaluationInputs, verifyFrozenInputs } from '../eval/benchmark.ts';

assert.equal(process.argv.length, 2, 'Usage: node --import tsx benchmark/check-freeze.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const example = JSON.parse(await readFile(join(root, 'experiments/baseline-config.example.json'), 'utf8'));
const config = { ...example,
  model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'offline-freeze-check', temperature: 0 } };
const loaded = await loadEvaluationInputs(config, root);
assert.equal(loaded.tasks.length, 12);
assert.equal(loaded.tasks.filter(task => task.spec.suite === 'S').length, 8);
assert.equal(loaded.tasks.filter(task => task.spec.suite === 'H').length, 4);
assert.equal(loaded.dirty, false);
const provenance = { implementationCommit: loaded.implementationCommit,
  benchmarkCommit: loaded.benchmarkCommit, benchmarkHash: loaded.benchmarkHash };
assert.equal((await verifyFrozenInputs(config, root, provenance)).length, 12);
await assert.rejects(verifyFrozenInputs(config, root, { ...provenance, benchmarkHash: '0'.repeat(64) }));
await assert.rejects(verifyFrozenInputs(config, root, { ...provenance, benchmarkCommit: '0'.repeat(40) }));
process.stdout.write(`${JSON.stringify({ ...provenance, tasks: 12, suites: { S: 8, H: 4 },
  passed: true, invalidHashRejected: true, invalidCommitRejected: true, provider: null }, null, 2)}\n`);
