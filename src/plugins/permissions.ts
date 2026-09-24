import type { MiniPlugin } from '../plugin.js';
import type { PermissionService } from '../services/index.js';

const READ_TOOLS = new Set(['list_files', 'read_file']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);

/** Lexical check only. File tools perform lstat and realpath checks before I/O. */
function validPath(path: unknown, allowRoot: boolean): path is string {
  if (typeof path !== 'string') return false;
  if (allowRoot && path === '.') return true;
  return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function permissionsPlugin(writable: readonly string[]): MiniPlugin {
  if (!Array.isArray(writable) || !Array.from(writable).every(path =>
    validPath(path, false) && !/[?*\[\]{}]/.test(path))) {
    throw new Error('permissions: invalid writable path');
  }
  const allowedWrites = new Set(writable);
  return { name: 'permissions', setup(ctx) {
    const service: PermissionService = {
      check(tool, args) {
        if (!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool)) return { allowed: false, reason: 'unknown_tool' };
        const path = tool === 'list_files' && args.path === undefined ? '.' : args.path;
        if (!validPath(path, tool === 'list_files')) return { allowed: false, reason: 'invalid_path' };
        if (WRITE_TOOLS.has(tool) && !allowedWrites.has(path)) return { allowed: false, reason: 'not_writable' };
        return { allowed: true, reason: null };
      },
    };
    return ctx.provide('permissions', service);
  } };
}
