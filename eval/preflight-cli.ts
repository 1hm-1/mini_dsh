import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTask } from './assets.js';
import { preflight } from './preflight.js';

const usage = 'Usage: npm run eval:preflight -- --task <task-directory> --output <new-evidence-directory>\nOffline task validation; output parent must exist.\n';
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(usage); return 0; }
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]; const value = argv[i + 1];
    if ((key !== '--task' && key !== '--output') || !value?.trim() || value.startsWith('--') || args.has(key)) {
      process.stderr.write(`Invalid arguments.\n${usage}`); return 1;
    }
    args.set(key, value);
  }
  if (args.size !== 2) { process.stderr.write(`Invalid arguments.\n${usage}`); return 1; }
  try {
    const result = await preflight(await loadTask(path.resolve(args.get('--task')!)), path.resolve(args.get('--output')!));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.passed ? 0 : 1;
  } catch {
    process.stderr.write('Preflight failed. Check task assets and output paths. Existing evidence is retained.\n');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
