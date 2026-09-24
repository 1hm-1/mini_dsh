import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '../src/context.js';
import { ServiceRegistry } from '../src/service-registry.js';
import type { MiniPlugin } from '../src/plugin.js';

test('K01 dependencies name services; duplicate plugin and service registrations fail', async () => {
  const ctx = new Context();
  const service = { emit() {}, on() { return () => {}; } };
  await ctx.use({ name: 'provider', setup: c => c.provide('events', service) });
  assert.equal(ctx.get('events'), service);
  await assert.rejects(ctx.use({ name: 'provider', setup() { throw new Error('must not run'); } }), /plugin.*provider.*already/i);
  // A failed load closes the Context, so exercise service duplicates in a fresh one.
  const duplicate = new Context();
  duplicate.provide('events', service);
  assert.throws(() => duplicate.provide('events', service), /service.*events.*already/i);
  assert.equal(duplicate.get('events'), service);
  await duplicate.dispose();

  const missing = new Context();
  await assert.rejects(missing.use({ name: 'consumer', dependencies: ['events'], setup() { throw new Error('must not run'); } }), /dependency.*events/i);
  await assert.rejects(missing.use({ name: 'late', setup() {} }), /closed/i);
  assert.throws(() => missing.provide('events', service), /closed/i);
  await ctx.dispose();
});

test('K01 registry disposer is tied to its own registration', () => {
  const registry = new ServiceRegistry<{ value: number }>();
  assert.equal(registry.has('value'), false);
  assert.throws(() => registry.get('value'), /service.*value.*missing/i);
  const removeFirst = registry.provide('value', 1);
  assert.throws(() => registry.provide('value', 2), /service.*value.*already/i);
  removeFirst();
  const removeSecond = registry.provide('value', 2);
  removeFirst();
  assert.equal(registry.get('value'), 2);
  removeSecond();
  removeSecond();
  assert.equal(registry.has('value'), false);
});

test('K02 disposal runs in reverse order, preserves upstream services, continues after errors, and is idempotent', async () => {
  const ctx = new Context();
  const calls: string[] = [];
  const firstError = new Error('first cleanup failed');
  await ctx.use({ name: 'upstream', setup: c => {
    const remove = c.provide('events', { emit() {}, on() { return () => {}; } });
    return () => { calls.push('upstream'); remove(); };
  } });
  await ctx.use({ name: 'middle', dependencies: ['events'], setup: () => () => {
    calls.push('middle');
    throw firstError;
  } });
  await ctx.use({ name: 'downstream', dependencies: ['events'], setup: c => async () => {
    assert.equal(c.has('events'), true);
    calls.push('downstream');
  } });
  await assert.rejects(ctx.dispose(), e => e === firstError);
  assert.deepEqual(calls, ['downstream', 'middle', 'upstream']);
  assert.equal(ctx.has('events'), false);
  await ctx.dispose();
  assert.deepEqual(calls, ['downstream', 'middle', 'upstream']);

  const undefinedError = new Context();
  await undefinedError.use({ name: 'throws-undefined', setup: () => () => { throw undefined; } });
  let rejected = false;
  try { await undefinedError.dispose(); } catch (error) { rejected = true; assert.equal(error, undefined); }
  assert.equal(rejected, true);
});

test('K03 setup failure cleans successful plugins and retains the startup error', async () => {
  const ctx = new Context();
  const calls: string[] = [];
  const setupError = new Error('setup failed');
  await ctx.use({ name: 'provider', setup: c => {
    const remove = c.provide('events', { emit() {}, on() { return () => {}; } });
    return () => { calls.push('provider cleanup'); remove(); throw new Error('cleanup failed'); };
  } });
  const failed: MiniPlugin = { name: 'failed', dependencies: ['events'], setup: c => {
    const remove = c.provide('promptOptimizer', { optimize: async input => input });
    try { throw setupError; } finally { remove(); calls.push('failed self cleanup'); }
  } };
  await assert.rejects(ctx.use(failed), e => e === setupError);
  assert.deepEqual(calls, ['failed self cleanup', 'provider cleanup']);
  assert.equal(ctx.has('events'), false);
  assert.equal(ctx.has('promptOptimizer'), false);
  await ctx.dispose();
  assert.deepEqual(calls, ['failed self cleanup', 'provider cleanup']);
});

test('K03 model provider can be replaced without changing a consumer plugin', async () => {
  const consumer: MiniPlugin = { name: 'consumer', dependencies: ['model'], setup: c => {
    assert.equal(typeof c.get('model').complete, 'function');
  } };
  for (const name of ['mock-a', 'mock-b']) {
    const ctx = new Context();
    const complete = async () => ({
      content: name, calls: [], finish: 'stop' as const,
      usage: { inputTokens: null, outputTokens: null }, actualModel: null, fingerprint: null,
    });
    await ctx.use({ name, setup: c => c.provide('model', { complete }) });
    await ctx.use(consumer);
    assert.equal(ctx.get('model').complete, complete);
    await ctx.dispose();
  }
});

test('K04 contexts keep independent services and clear provider registrations on disposal', async () => {
  const left = new Context();
  const right = new Context();
  const plugin: MiniPlugin = { name: 'provider', setup: c => {
    const remove = c.provide('events', { emit() {}, on() { return () => {}; } });
    return remove;
  } };
  await left.use(plugin);
  assert.equal(right.has('events'), false);
  await right.use(plugin);
  assert.notEqual(left.get('events'), right.get('events'));
  await left.dispose();
  assert.equal(left.has('events'), false);
  assert.equal(right.has('events'), true);
  await right.dispose();
  assert.equal(right.has('events'), false);
});
