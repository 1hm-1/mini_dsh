import assert from 'node:assert/strict';
import test from 'node:test';
import runExample from '../specs/config.example.json' with { type: 'json' };
import taskExample from '../specs/task.example.json' with { type: 'json' };
import baselineExample from '../experiments/baseline-config.example.json' with { type: 'json' };
import ablationExample from '../experiments/run-config.example.json' with { type: 'json' };
import { parseRunConfig } from '../src/config.js';
import { parseEvalConfig, parseTaskSpec } from '../eval/task.js';

const model = { endpoint: 'https://example.test/v1/chat/completions', id: 'test-model', temperature: 0 };
const validRun = () => ({
  ...structuredClone(runExample), model: { ...model },
  workspace: '/tmp/mini-harness-contract/workspace',
  sessionPath: '/tmp/mini-harness-contract/journal.jsonl',
});

test('A01 shipped runtime and experiment templates require explicit model configuration', () => {
  assert.throws(() => parseRunConfig(runExample));
  assert.throws(() => parseEvalConfig(baselineExample));
  assert.throws(() => parseEvalConfig(ablationExample));
  assert.deepEqual(parseRunConfig(validRun()), validRun());
  assert.deepEqual(parseTaskSpec(taskExample), taskExample);
  for (const example of [baselineExample, ablationExample]) {
    const configured = { ...example, model };
    assert.deepEqual(parseEvalConfig(configured), configured);
  }
});

test('A01 every budget and context count rejects invalid numbers without coercion', () => {
  const invalidCounts: unknown[] = [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '16', null, undefined];
  for (const field of Object.keys(runExample.budget)) {
    for (const value of invalidCounts) {
      const input = validRun();
      assert.throws(() => parseRunConfig({ ...input, budget: { ...input.budget, [field]: value } }), new RegExp(field));
    }
  }
  for (const field of ['estimatedWindowTokens', 'keepRecentRounds']) {
    for (const value of invalidCounts) {
      const input = validRun();
      assert.throws(() => parseRunConfig({ ...input, context: { ...input.context, [field]: value } }), new RegExp(field));
    }
  }
  for (const schemaVersion of [0, 2, '1', null]) {
    assert.throws(() => parseRunConfig({ ...validRun(), schemaVersion }), /schemaVersion/);
  }
});

test('experiment phases enforce group membership independently of order', () => {
  const configured = { ...baselineExample, model };
  const matrices = [
    { phase: 'baseline-diagnostic', valid: ['baseline'], invalid: [['full'], ['baseline', 'context']] },
    { phase: 'comparison', valid: ['full', 'baseline'], invalid: [['baseline'], ['baseline', 'optimizer']] },
    { phase: 'ablation', valid: ['full', 'optimizer', 'context', 'baseline'], invalid: [['baseline', 'full'], ['full', 'optimizer', 'context']] },
  ];
  for (const { phase, valid, invalid } of matrices) {
    assert.deepEqual(parseEvalConfig({ ...configured, phase, variants: valid }).variants, valid);
    for (const variants of invalid) {
      assert.throws(() => parseEvalConfig({ ...configured, phase, variants }), /variants/);
    }
  }
  assert.doesNotThrow(() => parseEvalConfig({ ...configured, phase: 'smoke', benchmarkManifest: null }));
  for (const variants of [[], ['baseline', 'baseline'], ['unknown']]) {
    assert.throws(() => parseEvalConfig({ ...configured, phase: 'smoke', variants }));
  }
});

test('A01 writable paths are exact and cannot alias protected public tests', () => {
  for (const path of ['../subject.mjs', '/subject.mjs', 'C:/subject.mjs', 'src\\subject.mjs', 'src/../subject.mjs', './subject.mjs', 'src//subject.mjs', 'bad\0.mjs', '*.mjs']) {
    assert.throws(() => parseRunConfig({ ...validRun(), writable: [path] }));
    assert.throws(() => parseTaskSpec({ ...taskExample, writable: [path] }));
  }
  assert.throws(() => parseTaskSpec({ ...taskExample, writable: [taskExample.publicTest] }), /protected/);
  assert.doesNotThrow(() => parseTaskSpec({ ...taskExample, writable: ['planned/new-file.mjs'] }));
});
