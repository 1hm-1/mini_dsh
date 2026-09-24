import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseVariant } from '../src/config.js';
import type { Variant } from '../src/types.js';
import { positiveInteger, uniqueStrings } from '../src/validation.js';
import type { EvalConfig } from './contracts.js';
import { runEvaluation } from './runner.js';
import { parseEvalConfig, parseTaskId } from './task.js';

const usage = 'Usage: npm run eval -- --config <json-path> [--tasks <id,id>] [--variants <variant,variant>] [--repeats <count>]\n';

export interface EvalArguments {
  config: string;
  taskIds?: string[];
  variants?: Variant[];
  repeats?: number;
}

export function parseEvalArguments(argv: readonly string[]): EvalArguments | null {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || !['--config', '--tasks', '--variants', '--repeats'].includes(flag)
      || !value || value.startsWith('--') || values.has(flag)) throw new Error('invalid eval arguments');
    values.set(flag, value);
  }
  const config = values.get('--config');
  if (!config?.trim()) throw new Error('config required');
  const args: EvalArguments = { config };
  if (values.has('--tasks')) args.taskIds = uniqueStrings(values.get('--tasks')!.split(','), 'tasks', parseTaskId);
  if (values.has('--variants')) args.variants = uniqueStrings(values.get('--variants')!.split(','), 'variants', parseVariant) as Variant[];
  if (values.has('--repeats')) {
    const value = values.get('--repeats')!;
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error('invalid repeats');
    args.repeats = positiveInteger(Number(value), 'repeats');
  }
  return args;
}

export function applyEvalOverrides(raw: unknown, args: EvalArguments): EvalConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error('invalid config');
  return parseEvalConfig({
    ...raw,
    ...(args.taskIds === undefined ? {} : { taskIds: args.taskIds }),
    ...(args.variants === undefined ? {} : { variants: args.variants }),
    ...(args.repeats === undefined ? {} : { repeats: args.repeats }),
  });
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: EvalArguments | null;
  try { args = parseEvalArguments(argv); }
  catch { process.stderr.write(`Invalid arguments.\n${usage}`); return 1; }
  if (!args) { process.stdout.write(usage); return 0; }
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on('SIGINT', onSigint);
  try {
    const config = applyEvalOverrides(JSON.parse(await readFile(path.resolve(args.config), 'utf8')), args);
    if (config.phase === 'smoke') {
      process.stderr.write('Smoke requires the explicit offline entry: npm run eval:smoke.\n');
      return 1;
    }
    if (!process.env.HARNESS_API_KEY) {
      process.stderr.write('HARNESS_API_KEY is required.\n');
      return 1;
    }
    const result = await runEvaluation(config, { signal: controller.signal });
    process.stdout.write(`${JSON.stringify({ runId: result.runId, runRoot: result.runRoot,
      provider: result.manifest.provider, attempts: result.attempts.length })}\n`);
    return controller.signal.aborted ? 130 : 0;
  } catch {
    process.stderr.write('Evaluation failed. Check configuration, task preflight, Git provenance, and output paths. Existing evidence is retained.\n');
    return 1;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
