import { lstat, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Stats } from 'node:fs';
import type { MiniPlugin } from '../plugin.js';
import type { ToolDefinition, ToolResult, ToolSchema } from '../types.js';
import { atomicWrite } from './file-tools-atomic.js';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_LIST_ITEMS = 1000;
const ok = (output: string): ToolResult => ({ ok: true, output, errorCode: null, truncated: false });
const fail = (errorCode: string, output: string): ToolResult => ({ ok: false, output, errorCode, truncated: false });

class FileToolFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function validPath(path: string, allowRoot: boolean): boolean {
  if (allowRoot && path === '.') return true;
  return path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

async function checkedPath(root: string, relative: string, expected: 'file' | 'directory' | 'new-file', signal: AbortSignal): Promise<string> {
  if (!validPath(relative, expected === 'directory')) throw new FileToolFailure('invalid_path', 'Invalid path');
  if (relative === '.') return root;
  const parts = relative.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    signal.throwIfAborted();
    current = join(current, parts[index]!);
    let entry: Stats;
    try { entry = await lstat(current); }
    catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (expected === 'new-file' && index === parts.length - 1) return current;
        throw new FileToolFailure('file_missing', 'File does not exist');
      }
      throw error;
    }
    signal.throwIfAborted();
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new FileToolFailure('invalid_file_type', 'Unsupported file type');
    }
    const last = index === parts.length - 1;
    if (!last && !entry.isDirectory()) throw new FileToolFailure('invalid_file_type', 'Expected directory');
    if (last && expected === 'directory' && !entry.isDirectory()) throw new FileToolFailure('invalid_file_type', 'Expected directory');
    if (last && expected !== 'directory' && !entry.isFile()) throw new FileToolFailure('invalid_file_type', 'Expected regular file');
  }
  return current;
}

async function boundedRead(path: string, signal: AbortSignal): Promise<string> {
  const metadata = await lstat(path);
  signal.throwIfAborted();
  if (!metadata.isFile()) throw new FileToolFailure('invalid_file_type', 'Expected regular file');
  if (metadata.size > MAX_FILE_BYTES) throw new FileToolFailure('file_too_large', 'File exceeds 256 KiB');
  const bytes = await readFile(path, { signal });
  signal.throwIfAborted();
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileToolFailure('file_too_large', 'File exceeds 256 KiB');
  return bytes.toString('utf8');
}

async function listFiles(root: string, relative: string, signal: AbortSignal): Promise<ToolResult> {
  const directory = await checkedPath(root, relative, 'directory', signal);
  const names: string[] = [];
  async function visit(at: string, prefix: string): Promise<void> {
    const entries = await readdir(at);
    signal.throwIfAborted();
    for (const name of entries) {
      signal.throwIfAborted();
      const absolute = join(at, name);
      const metadata = await lstat(absolute);
      signal.throwIfAborted();
      if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
        throw new FileToolFailure('invalid_file_type', 'Unsupported file type');
      }
      const item = prefix ? `${prefix}/${name}` : name;
      if (metadata.isDirectory()) await visit(absolute, item);
      else names.push(item);
    }
  }
  await visit(directory, relative === '.' ? '' : relative);
  names.sort();
  const truncated = names.length > MAX_LIST_ITEMS;
  return {
    ok: true,
    output: names.slice(0, MAX_LIST_ITEMS).join('\n') + (truncated ? '\n[truncated]' : ''),
    errorCode: null,
    truncated,
  };
}

async function handle(operation: () => Promise<ToolResult>, signal: AbortSignal): Promise<ToolResult> {
  try { return await operation(); }
  catch (error) {
    signal.throwIfAborted();
    if (error instanceof FileToolFailure) return fail(error.code, error.message);
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error;
    return fail('tool_error', 'File operation failed');
  }
}

const field = { type: 'string' };
function schema(name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSchema {
  return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } };
}
const schemas = [
  schema('list_files', 'List regular files recursively in a directory', { path: field }, []),
  schema('read_file', 'Read a UTF-8 file', { path: field }, ['path']),
  schema('write_file', 'Create or replace an allowed UTF-8 file', { path: field, content: field }, ['path', 'content']),
  schema('edit_file', 'Replace exactly one text occurrence in an allowed file',
    { path: field, oldText: field, newText: field }, ['path', 'oldText', 'newText']),
  schema('delete_file', 'Delete one allowed regular file', { path: field }, ['path']),
];
/** Same immutable metadata used by registration, in ToolsService projection order. */
export function fileToolSchemas(): ToolSchema[] {
  return structuredClone(schemas).sort((a, b) => a.name.localeCompare(b.name));
}
function definition(name: string, execute: ToolDefinition['execute']): ToolDefinition {
  const item = schemas.find(item => item.name === name);
  if (!item) throw new Error('unknown file tool');
  return { ...structuredClone(item), execute };
}

export function fileToolsPlugin(workspace: string): MiniPlugin {
  return { name: 'file-tools', dependencies: ['tools'], async setup(ctx) {
    const root = await realpath(workspace);
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory()) throw new Error('file tools require a directory workspace');
    const tools = ctx.get('tools');
    const removers: Array<() => void | Promise<void>> = [];
    function register(tool: ToolDefinition): void { removers.push(tools.register(tool)); }
    async function cleanup(): Promise<void> {
      let failed = false;
      let firstError: unknown;
      for (const remove of removers.splice(0).reverse()) {
        try { await remove(); }
        catch (error) { if (!failed) { failed = true; firstError = error; } }
      }
      if (failed) throw firstError;
    }
    try {
      register(definition('list_files',
        (args, signal) => handle(() => listFiles(root, args.path === undefined ? '.' : args.path as string, signal), signal)));
      register(definition('read_file',
        (args, signal) => handle(async () => ok(await boundedRead(await checkedPath(root, args.path as string, 'file', signal), signal)), signal)));
      register(definition('write_file',
        (args, signal) => handle(async () => {
          const path = await checkedPath(root, args.path as string, 'new-file', signal);
          const content = args.content as string;
          if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new FileToolFailure('file_too_large', 'File exceeds 256 KiB');
          const existing = await lstat(path).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          });
          signal.throwIfAborted();
          if (existing && !existing.isFile()) throw new FileToolFailure('invalid_file_type', 'Expected regular file');
          if (existing && existing.size > MAX_FILE_BYTES) throw new FileToolFailure('file_too_large', 'File exceeds 256 KiB');
          signal.throwIfAborted();
          await atomicWrite(path, content, signal);
          return ok('File written');
        }, signal)));
      register(definition('edit_file',
        (args, signal) => handle(async () => {
          const oldText = args.oldText as string;
          if (oldText.length === 0) throw new FileToolFailure('invalid_arguments', 'oldText must not be empty');
          const path = await checkedPath(root, args.path as string, 'file', signal);
          const content = await boundedRead(path, signal);
          const first = content.indexOf(oldText);
          if (first < 0) throw new FileToolFailure('edit_no_match', 'Text not found');
          if (content.indexOf(oldText, first + 1) >= 0) throw new FileToolFailure('edit_multiple_matches', 'Text occurs more than once');
          const changed = content.slice(0, first) + (args.newText as string) + content.slice(first + oldText.length);
          if (Buffer.byteLength(changed, 'utf8') > MAX_FILE_BYTES) throw new FileToolFailure('file_too_large', 'File exceeds 256 KiB');
          signal.throwIfAborted();
          await atomicWrite(path, changed, signal);
          return ok('File edited');
        }, signal)));
      register(definition('delete_file',
        (args, signal) => handle(async () => {
          const path = await checkedPath(root, args.path as string, 'file', signal);
          signal.throwIfAborted();
          await unlink(path);
          signal.throwIfAborted();
          return ok('File deleted');
        }, signal)));
    } catch (error) {
      await cleanup().catch(() => {});
      throw error;
    }
    return cleanup;
  } };
}
