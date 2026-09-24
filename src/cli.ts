import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRunConfig, variantFlags } from './config.js';
import { createRuntime } from './runtime.js';
import type { RunResult } from './types.js';

const usage = 'Usage: npm run agent -- --config <json-path> (--input <task> | --input-file <utf8-path>)\n';

function argumentsFor(argv: string[]): { config: string; input?: string; inputFile?: string } | null {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== '--config' && flag !== '--input' && flag !== '--input-file') throw new Error('arguments');
    if (value === undefined || value.startsWith('--') || values.has(flag)) throw new Error('arguments');
    values.set(flag, value);
  }
  if (values.size !== 2 || !values.has('--config') || values.has('--input') === values.has('--input-file')) throw new Error('arguments');
  return { config: values.get('--config')!, ...(values.has('--input') ? { input: values.get('--input')! } : { inputFile: values.get('--input-file')! }) };
}

function exitFor(result: RunResult): number {
  switch (result.termination) {
    case 'completed': return 0;
    case 'cancelled': return 130;
    case 'request_limit':
    case 'tool_limit':
    case 'timeout':
    case 'context_overflow':
    case 'model_error': return 2;
    case 'io_error':
    case 'internal_error': return 1;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: ReturnType<typeof argumentsFor>;
  try { args = argumentsFor(argv); }
  catch { process.stderr.write(`Invalid arguments.\n${usage}`); return 1; }
  if (args === null) { process.stdout.write(usage); return 0; }

  const controller = new AbortController();
  const onSigint = () => { controller.abort(); };
  process.on('SIGINT', onSigint);
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  try {
    const input = args.input ?? await readFile(path.resolve(args.inputFile!), 'utf8');
    if (input.trim().length === 0) throw new Error('empty input');
    const raw = JSON.parse(await readFile(path.resolve(args.config), 'utf8')) as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config');
    const config = parseRunConfig(raw);
    const flags = variantFlags(config.variant);
    if (flags.context || flags.optimizer) {
      process.stderr.write('Only baseline is available; other variants are not implemented yet.\n');
      return 1;
    }
    if (!process.env.HARNESS_API_KEY) {
      process.stderr.write('HARNESS_API_KEY is required.\n');
      return 1;
    }
    runtime = await createRuntime(config, { signal: controller.signal });
    const result = await runtime.run(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return exitFor(result);
  } catch {
    process.stderr.write('Agent startup or execution failed. Check configuration, environment, and paths.\n');
    return 1;
  } finally {
    try { await runtime?.dispose(); } catch { /* safe error output remains generic */ }
    process.removeListener('SIGINT', onSigint);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
