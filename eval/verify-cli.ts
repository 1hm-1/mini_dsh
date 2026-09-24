import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verify } from './verify.js';

const usage = 'Usage: npm run eval:verify -- --run <run-directory>\nRead-only; no model requests or test execution.\n';
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(usage); return 0; }
  if (argv.length !== 2 || argv[0] !== '--run' || !argv[1]?.trim() || argv[1].startsWith('--')) {
    process.stderr.write(`Invalid arguments.\n${usage}`); return 1;
  }
  const result = await verify(argv[1]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.passed ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
