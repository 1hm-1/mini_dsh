import { lstat, open, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { renderReport, summarize } from './report.js';
import { inspectRun, verify } from './verify.js';

/** Only for a newly completed run. Existing summaries and diagnostics are never replaced. */
export async function writeRunReport(runDir: string): Promise<void> {
  const root = resolve(runDir);
  let parent = root;
  while (true) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('report path: expected real directory');
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  for (const name of ['summary.json', 'report.md', 'diagnostic.json', 'diagnostic.md']) {
    const info = await lstat(join(root, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info) throw new Error('run report already exists');
  }
  const created: string[] = [];
  const write = async (name: string, contents: string) => {
    const file = join(root, name);
    const handle = await open(file, 'wx');
    created.push(file);
    try { await handle.writeFile(contents); }
    finally { await handle.close(); }
  };
  try {
    const evidence = await inspectRun(root);
    const summary = summarize(evidence.manifest, evidence.attempts, evidence.metrics);
    await write('summary.json', `${JSON.stringify(summary, null, 2)}\n`);
    await write('report.md', renderReport(evidence.manifest, summary));
    const checked = await verify(root);
    if (!checked.passed) throw new Error('report verification failed');
  } catch {
    for (const file of created) await rm(file, { force: true });
    const checked = await verify(root);
    const errors = checked.passed ? ['run: report generation failed'] : checked.errors;
    await write('diagnostic.json', `${JSON.stringify({ schemaVersion: 1, status: 'incomplete', errors }, null, 2)}\n`);
    await write('diagnostic.md', `# Incomplete evaluation\n\nEvidence validation or report generation failed. No comparison table was produced.\n\n${errors.map(error => `- ${error}`).join('\n')}\n`);
    throw new Error('evaluation evidence incomplete; see diagnostic.json');
  }
}
