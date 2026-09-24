import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';

type TemporaryWrite = (handle: FileHandle, content: string, signal: AbortSignal) => Promise<void>;

/** Keep the replacement next to its target so rename is atomic on the same filesystem. */
export async function atomicWrite(
  target: string,
  content: string,
  signal: AbortSignal,
  move: typeof rename = rename,
  write: TemporaryWrite = (handle, data, activeSignal) => handle.writeFile(data, { encoding: 'utf8', signal: activeSignal }),
): Promise<void> {
  signal.throwIfAborted();
  const temporary = join(dirname(target), `.harness-${randomUUID()}.tmp`);
  let owned = false;
  let handle: FileHandle | null = null;
  try {
    handle = await open(temporary, 'wx', 0o600);
    owned = true;
    signal.throwIfAborted();
    await write(handle, content, signal);
    signal.throwIfAborted();
    await handle.close();
    handle = null;
    signal.throwIfAborted();
    await move(temporary, target);
    signal.throwIfAborted();
  } finally {
    try { if (handle) await handle.close(); }
    finally {
      if (owned) await unlink(temporary).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }
}
