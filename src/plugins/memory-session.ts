import { performance } from 'node:perf_hooks';
import type { MiniPlugin } from '../plugin.js';
import type { Event, EventInput, Message } from '../types.js';
import { parseEvent, parseMessage } from '../journal.js';

function inputSnapshot(value: unknown): EventInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('event input: expected object');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('data')) throw new Error('event input: wrong fields');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!Object.hasOwn(descriptors.type ?? {}, 'value') || !Object.hasOwn(descriptors.data ?? {}, 'value')) throw new Error('event input: accessor field');
  const source = value as EventInput;
  return { type: source.type, data: source.data };
}

export function memorySessionPlugin(): MiniPlugin {
  return { name: 'memory-session', dependencies: ['persistence'], setup(ctx) {
    const persistence = ctx.get('persistence');
    const started = performance.now();
    const history: Message[] = [];
    let seq = 0;
    let elapsedMs = 0;
    let failed: unknown;
    let hasFailed = false;
    let ended = false;
    let closing = false;
    let tail: Promise<void> = Promise.resolve();

    function queue(input: EventInput): Promise<Event> {
      if (closing) return Promise.reject(new Error('session is closed'));
      if (hasFailed) return Promise.reject(failed);
      // Snapshot and validate before the caller can mutate an enqueued payload.
      const snapshot = parseEvent({ schemaVersion: 1, seq: 1, elapsedMs: 0, ...input });
      const task = tail.then(async () => {
        if (hasFailed) throw failed;
        if (ended) throw new Error('session already ended');
        if (input.type === 'run_start' && seq > 0) throw new Error('session already started');
        const nextElapsed = Math.max(elapsedMs, Math.floor(performance.now() - started));
        const item = parseEvent({ ...snapshot, seq: seq + 1, elapsedMs: nextElapsed });
        try { await persistence.append(parseEvent(item)); }
        catch (error) { hasFailed = true; failed = error; throw error; }
        seq = item.seq;
        elapsedMs = item.elapsedMs;
        if (item.type === 'message') history.push(parseMessage((item.data as { message: Message }).message));
        if (item.type === 'run_end') ended = true;
        if (ctx.has('events')) {
          try { ctx.get('events').emit(parseEvent(item)); } catch { /* observers cannot undo commit */ }
        }
        return parseEvent(item);
      });
      tail = task.then(() => undefined, () => undefined);
      return task;
    }

    const remove = ctx.provide('session', {
      async append(message) {
        const copy = parseMessage(message);
        await queue({ type: 'message', data: { message: copy } });
      },
      messages() { return history.map(parseMessage); },
      async record(input) { return queue(inputSnapshot(input)); },
    });
    return async () => { closing = true; await tail; remove(); };
  } };
}
