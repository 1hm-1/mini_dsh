import type { MiniPlugin } from '../plugin.js';
import type { Event } from '../types.js';
import { parseEvent } from '../journal.js';

/** Synchronous observation only. Listener errors cannot alter a committed Session write. */
export function eventsPlugin(): MiniPlugin {
  return { name: 'events', setup(ctx) {
    const listeners = new Set<{ listener: (event: Event) => void }>();
    let closed = false;
    const remove = ctx.provide('events', {
      on(listener) {
        if (closed) throw new Error('events service is closed');
        if (typeof listener !== 'function') throw new Error('events listener: expected function');
        const entry = { listener };
        listeners.add(entry);
        return () => { listeners.delete(entry); };
      },
      emit(event) {
        if (closed) throw new Error('events service is closed');
        const clean = parseEvent(event);
        for (const entry of [...listeners]) {
          if (!listeners.has(entry)) continue;
          try { entry.listener(parseEvent(clean)); } catch { /* observation cannot change durable state */ }
        }
      },
    });
    return () => { closed = true; listeners.clear(); remove(); };
  } };
}
