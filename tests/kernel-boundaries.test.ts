import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '../src/context.js';
import { ServiceRegistry } from '../src/service-registry.js';

test('K01 an old disposer cannot remove a new registration of the identical service object', async () => {
  const registry = new ServiceRegistry<{ value: object }>();
  const service = {};
  const removeFirst = registry.provide('value', service);
  await removeFirst();
  const removeSecond = registry.provide('value', service);
  await removeFirst();
  assert.equal(registry.get('value'), service);
  await removeSecond();
  assert.equal(registry.has('value'), false);
});

test('K02 async cleanup finishes before its dependency is removed and before dispose resolves', async () => {
  const ctx = new Context();
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const calls: string[] = [];
  const service = { emit() {}, on() { return () => {}; } };
  await ctx.use({ name: 'provider', setup(c) {
    const remove = c.provide('events', service);
    return async () => { calls.push('provider'); await remove(); };
  } });
  await ctx.use({ name: 'consumer', dependencies: ['events'], setup(c) {
    return async () => {
      calls.push('consumer start');
      entered.resolve();
      await gate.promise;
      assert.equal(c.get('events'), service);
      calls.push('consumer end');
    };
  } });

  const disposal = ctx.dispose();
  await entered.promise;
  let finished = false;
  const secondDisposal = ctx.dispose().then(() => { finished = true; });
  try {
    await Promise.resolve();
    assert.deepEqual(calls, ['consumer start']);
    assert.equal(ctx.get('events'), service);
    assert.equal(finished, false);
  } finally {
    gate.resolve();
    await Promise.all([disposal, secondDisposal]);
  }
  assert.deepEqual(calls, ['consumer start', 'consumer end', 'provider']);
  assert.equal(ctx.has('events'), false);
  assert.throws(() => ctx.provide('events', service), /closed/i);
  await assert.rejects(ctx.use({ name: 'late', setup() {} }), /closed/i);
});

test('K03 missing dependency aborts before setup and cleans every earlier plugin', async () => {
  const ctx = new Context();
  const calls: string[] = [];
  await ctx.use({ name: 'first', setup: () => () => { calls.push('first'); } });
  await ctx.use({ name: 'second', setup: () => () => { calls.push('second'); } });
  await assert.rejects(ctx.use({
    name: 'missing-provider', dependencies: ['session'],
    setup() { calls.push('unexpected setup'); },
  }), /dependency.*session/i);
  assert.deepEqual(calls, ['second', 'first']);
  await ctx.dispose();
  assert.deepEqual(calls, ['second', 'first']);
});

test('K02 closing is published before synchronous cleanup can reenter dispose or register services', async () => {
  const ctx = new Context();
  const calls: string[] = [];
  let nestedDisposal: Promise<void> | undefined;
  await ctx.use({ name: 'provider', setup(c) {
    const remove = c.provide('events', { emit() {}, on() { return () => {}; } });
    return async () => { calls.push('provider'); await remove(); };
  } });
  await ctx.use({ name: 'consumer', setup(c) {
    return () => {
      nestedDisposal = c.dispose();
      assert.equal(c.has('events'), true);
      assert.throws(() => c.provide('permissions', { check: () => ({ allowed: false, reason: 'test' }) }), /closed/i);
      calls.push('consumer');
    };
  } });
  await ctx.dispose();
  await nestedDisposal;
  assert.deepEqual(calls, ['consumer', 'provider']);
});

test('K03 startup failure closes registration before cleaning earlier plugins', async () => {
  const ctx = new Context();
  let registrationRejected = false;
  const startupError = new Error('intentional startup failure');
  await ctx.use({ name: 'provider', setup(c) {
    return () => {
      try {
        c.provide('events', { emit() {}, on() { return () => {}; } });
      } catch (error) {
        assert.match(String(error), /closed/i);
        registrationRejected = true;
      }
    };
  } });
  await assert.rejects(ctx.use({ name: 'failure', setup() { throw startupError; } }), error => error === startupError);
  assert.equal(registrationRejected, true);
  assert.equal(ctx.has('events'), false);
});
