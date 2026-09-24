import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mockModelPlugin } from '../src/plugins/mock-model.js';
import type { ModelResponse } from '../src/types.js';
import type { EvalConfig } from './contracts.js';
import { runEvaluation } from './runner.js';

export function smokeConfig(outputDir: string): EvalConfig {
  return {
    schemaVersion: 1, phase: 'smoke', benchmarkManifest: null,
    taskIds: ['eval-smoke'], variants: ['baseline'], repeats: 2,
    model: { endpoint: 'http://127.0.0.1:1/chat/completions', id: 'offline-smoke', temperature: 0 },
    budget: { maxModelRequests: 5, maxToolCalls: 5, timeoutMs: 5000, maxOutputTokens: 100, maxInputChars: 20000 },
    context: { estimatedWindowTokens: 8192, triggerRatio: 0.75, keepRecentRounds: 4 },
    outputDir,
  };
}

function response(content: string, calls: ModelResponse['calls'] = []): ModelResponse {
  return { content, calls, finish: calls.length ? 'tool_calls' : 'stop',
    usage: { inputTokens: 3, outputTokens: 2 }, actualModel: 'offline-smoke', fingerprint: null };
}

const usage = 'Usage: npm run eval:smoke -- [--output <directory>]\nOffline fixture only; no provider API requests.\n';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(usage); return 0; }
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--output' || !argv[1]?.trim() || argv[1].startsWith('--'))) {
    process.stderr.write(`Invalid arguments.\n${usage}`); return 1;
  }
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on('SIGINT', onSigint);
  try {
    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    const result = await runEvaluation(smokeConfig(path.resolve(argv[1] ?? 'runs')), {
      projectRoot, signal: controller.signal,
      modelPlugin: ({ model, accounting }) => mockModelPlugin({ model, accounting, script: [
        response('', [{ id: 'read', name: 'read_file', arguments: '{"path":"sum.mjs"}' }]),
        response('', [{ id: 'edit', name: 'edit_file', arguments: '{"path":"sum.mjs","oldText":"a - b","newText":"a + b"}' }]),
        response('Fixed sum.'),
      ] }),
    });
    process.stdout.write(`${JSON.stringify({ runId: result.runId, runRoot: result.runRoot,
      provider: result.manifest.provider, attempts: result.attempts.length })}\n`);
    return controller.signal.aborted ? 130 : 0;
  } catch {
    process.stderr.write('Offline evaluation failed. Check fixture and output paths. Existing evidence is retained.\n');
    return 1;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
