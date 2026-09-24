import assert from 'node:assert/strict';
import test from 'node:test';
import variantSpec from '../specs/variants.json' with { type: 'json' };
import { parseRunConfig, variantFlags } from '../src/config.js';
import { parseEvalConfig, parseTaskSpec } from '../eval/task.js';

const runConfig = () => ({
  schemaVersion: 1,
  variant: 'baseline',
  model: { endpoint: 'https://example.test/chat/completions', id: 'model-1', temperature: 0 },
  budget: { maxModelRequests: 16, maxToolCalls: 24, timeoutMs: 120000, maxOutputTokens: 4096, maxInputChars: 128000 },
  context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
  workspace: '/tmp/workspace', writable: ['src/subject.mjs'], sessionPath: '/tmp/session.jsonl',
});

const taskSpec = () => ({
  schemaVersion: 1, id: 'b01-normalize', suite: 'S', category: 'bug-fix',
  promptFile: 'prompt.md', workspaceDir: 'workspace', writable: ['src/subject.mjs'],
  publicTest: 'public.test.mjs', acceptanceTest: 'acceptance/acceptance.test.mjs',
  referencePatch: 'reference/patch.diff', testTimeoutMs: 10000,
});

const evalConfig = () => ({
  schemaVersion: 1, phase: 'baseline-diagnostic', benchmarkManifest: 'benchmark/v1.json',
  taskIds: ['b01-normalize'], variants: ['baseline'], repeats: 3,
  model: runConfig().model, budget: runConfig().budget, context: runConfig().context,
  outputDir: 'runs',
});

test('A01 valid config and variant flags come from the variant spec', () => {
  const input = runConfig();
  const parsed = parseRunConfig(input);
  assert.deepEqual(variantFlags(parsed.variant), { context: false, optimizer: false });
  assert.deepEqual(variantFlags('full'), { context: true, optimizer: true });
  parsed.writable.push('later.mjs');
  assert.deepEqual(input.writable, ['src/subject.mjs']);
  const flags = variantFlags('full');
  flags.context = false;
  assert.deepEqual(variantFlags('full'), { context: true, optimizer: true });
  assert.throws(() => variantFlags('__proto__' as Parameters<typeof variantFlags>[0]));
  for (const variant of variantSpec.order) {
    assert.deepEqual(variantFlags(variant as Parameters<typeof variantFlags>[0]), variantSpec.variants[variant as keyof typeof variantSpec.variants]);
  }
  assert.doesNotThrow(() => parseRunConfig({ ...runConfig(), writable: [] }));
  assert.doesNotThrow(() => parseRunConfig({ ...runConfig(), writable: ['src/template.mjs'] }));
});

test('A01 rejects invalid variant, missing model, unknown fields and TEMPLATE values', () => {
  for (const change of [
    { variant: 'unknown' }, { model: undefined }, { extra: 1 },
    { model: { ...runConfig().model, extra: 1 } },
    { budget: { ...runConfig().budget, extra: 1 } },
    { context: { ...runConfig().context, extra: 1 } },
    { workspace: 'TEMPLATE_REQUIRED' },
  ]) assert.throws(() => parseRunConfig({ ...runConfig(), ...change }));
});

test('A01 rejects invalid counts, ratio, temperature and unsafe writable paths', () => {
  for (const count of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseRunConfig({ ...runConfig(), budget: { ...runConfig().budget, maxModelRequests: count } }));
  }
  for (const ratio of [0, 1, -0.1, NaN, Infinity]) {
    assert.throws(() => parseRunConfig({ ...runConfig(), context: { ...runConfig().context, triggerRatio: ratio } }));
  }
  assert.throws(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, temperature: NaN } }));
  for (const writable of [['../escape.mjs'], ['/absolute.mjs'], ['src/*.mjs'], ['a.mjs', 'a.mjs']]) {
    assert.throws(() => parseRunConfig({ ...runConfig(), writable }));
  }
  const sparse = Array<string>(1);
  assert.throws(() => parseRunConfig({ ...runConfig(), writable: sparse }));
  const inherited = Object.create({ model: runConfig().model }) as Record<string, unknown>;
  Object.assign(inherited, runConfig());
  delete inherited.model;
  assert.throws(() => parseRunConfig(inherited));
});

test('A01 accepts HTTPS and loopback HTTP but rejects remote HTTP and URL credentials', () => {
  for (const endpoint of ['http://127.0.0.1:8080/v1', 'http://localhost:8080/v1', 'http://[::1]:8080/v1']) {
    assert.doesNotThrow(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, endpoint } }));
  }
  for (const endpoint of ['http://example.test/v1', 'https://user:secret@example.test/v1', 'https://example.test/v1?api_key=secret']) {
    assert.throws(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, endpoint } }), /endpoint/);
  }
  assert.throws(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, endpoint: 'http://localhost.evil.test/v1' } }));
  assert.doesNotThrow(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, endpoint: 'https://example.test/v1?version=1' } }));
  assert.doesNotThrow(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, endpoint: 'https://example.test/v1?design=1' } }));
  for (const endpoint of [
    'https://example.test/v1?Signature=secret', 'https://example.test/v1?%61pi_key=secret',
    'https://example.test/v1?client_secret=secret', 'https://example.test/v1?clientSecret=secret',
    'https://example.test/v1?X-Amz-Credential=secret', 'https://example.test/v1?X-Amz-Signature=secret',
  ]) {
    assert.throws(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, endpoint } }));
  }
  assert.throws(() => parseRunConfig({ ...runConfig(), model: { ...runConfig().model, endpoint: 'https://user:secret@example.test/v1' } }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
});

test('task contract validates JSON shape and paths without loading assets', () => {
  assert.equal(parseTaskSpec(taskSpec()).id, 'b01-normalize');
  assert.doesNotThrow(() => parseTaskSpec({ ...taskSpec(), writable: [] }));
  for (const change of [
    { id: 'Bad_Id' }, { suite: 'X' }, { extra: 1 }, { promptFile: '../prompt.md' },
    { publicTest: 'test.js' }, { writable: ['src/../x.mjs'] },
    { writable: ['public.test.mjs'] }, { testTimeoutMs: 0 },
  ]) assert.throws(() => parseTaskSpec({ ...taskSpec(), ...change }));
});

test('eval contract validates phase matrix, IDs, manifest and nested fields', () => {
  assert.equal(parseEvalConfig(evalConfig()).phase, 'baseline-diagnostic');
  for (const change of [
    { phase: 'other' }, { variants: ['full'] }, { variants: ['baseline', 'baseline'] },
    { taskIds: ['b01-normalize', 'b01-normalize'] }, { taskIds: [] }, { repeats: 0 },
    { benchmarkManifest: null }, { outputDir: 'TEMPLATE_REQUIRED' }, { extra: 1 },
    { model: { ...evalConfig().model, unexpected: true } },
  ]) assert.throws(() => parseEvalConfig({ ...evalConfig(), ...change }));
  assert.doesNotThrow(() => parseEvalConfig({ ...evalConfig(), phase: 'smoke', benchmarkManifest: null }));
});
