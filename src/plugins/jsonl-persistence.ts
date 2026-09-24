import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { MiniPlugin } from '../plugin.js';
import { parseEvent } from '../journal.js';

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function jsonlPersistencePlugin(options: { workspace: string; sessionPath: string }): MiniPlugin {
  return { name: 'jsonl-persistence', async setup(ctx) {
    if (!path.isAbsolute(options.workspace) || !path.isAbsolute(options.sessionPath)) throw new Error('workspace and sessionPath must be absolute');
    const [workspace, parent] = await Promise.all([
      realpath(options.workspace), realpath(path.dirname(options.sessionPath)),
    ]);
    if (within(workspace, parent)) throw new Error('session journal must be outside workspace');
    const file = await open(options.sessionPath, 'wx', 0o600);
    let remove: (() => void | Promise<void>) | undefined;
    try {
      let pending: Promise<void> = Promise.resolve();
      let closed = false;
      let failed: unknown;
      let hasFailed = false;
      let closePromise: Promise<void> | undefined;
      const service = {
        async append(event: import('../types.js').Event): Promise<void> {
          if (closed) return Promise.reject(new Error('persistence is closed'));
          // Validate and snapshot before an asynchronous write can observe caller mutation.
          const line = `${JSON.stringify(parseEvent(event))}\n`;
          const write = pending.then(async () => {
            if (hasFailed) throw failed;
            try { await file.writeFile(line, 'utf8'); }
            catch (error) { failed = error; hasFailed = true; throw error; }
          });
          pending = write.then(() => undefined, () => undefined);
          await write;
        },
        close(): Promise<void> {
          if (closePromise) return closePromise;
          closed = true;
          closePromise = pending.then(() => file.close());
          return closePromise;
        },
      };
      remove = ctx.provide('persistence', service);
      return async () => { remove?.(); await service.close(); };
    } catch (error) {
      remove?.();
      await file.close();
      throw error;
    }
  } };
}
