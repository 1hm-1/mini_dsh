import type { Budget } from './types.js';

export function workerSystem(writable: readonly string[], budget: Budget, remainingModel: number, remainingTools: number): string {
  // Padding preserves projected length across budget digit boundaries and summary calls.
  const model = String(remainingModel).padStart(String(budget.maxModelRequests).length, ' ');
  const tools = String(remainingTools).padStart(String(budget.maxToolCalls).length, ' ');
  return [
    'Follow the original user task. Use only the five available file tools: list_files, read_file, write_file, edit_file, delete_file; there is no shell or test execution.',
    'Exact writable files: ' + JSON.stringify(writable) + '. Read other files as needed; write, edit, or delete only these exact paths.',
    'Budget: ' + model + ' remaining model requests including this worker (optimizer and summary requests count); ' + tools + ' remaining tool calls; ' + budget.maxOutputTokens + ' output tokens per request.',
    'Read files before editing. Keep edits focused. Do not create temporary test files or repeatedly list directories to look for an executor. Avoid rereading unchanged content already available.',
    'Think through correctness and constraints. Keep every visible explanation, including before a tool call, brief; avoid repeated long reasoning. After necessary edits, report clearly and briefly what changed and what was actually checked. Do not claim tests passed unless they were run.',
  ].join('\n');
}
