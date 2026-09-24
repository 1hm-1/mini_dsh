#!/usr/bin/env node
// SHA-256 index of the preserved source run and concise derived artifacts.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [runArg, evidenceArg, reportArg] = process.argv.slice(2);
if (!runArg || !evidenceArg || !reportArg) throw new Error('usage: hash-index.mjs RUN_ROOT EVIDENCE_ROOT REPORT_PATH');
const runRoot = path.resolve(runArg);
const evidenceRoot = path.resolve(evidenceArg);
const reportPath = path.resolve(reportArg);
const hashFile = async file => createHash('sha256').update(await readFile(file)).digest('hex');
async function filesUnder(root, exclude = new Set()) {
  const out = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (exclude.has(rel)) continue;
      const st = await lstat(full);
      if (st.isSymbolicLink()) throw new Error(`symlink not indexed: ${full}`);
      if (st.isDirectory()) await walk(full);
      else if (st.isFile()) out.push({ path: rel, bytes: st.size, sha256: await hashFile(full) });
      else throw new Error(`special file not indexed: ${full}`);
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
const manifest = JSON.parse(await readFile(path.join(runRoot, 'manifest.json'), 'utf8'));
const rawRunFiles = await filesUnder(runRoot);
const evidenceFiles = await filesUnder(evidenceRoot, new Set(['hash-index.json']));
const report = { path: path.relative(process.cwd(), reportPath).split(path.sep).join('/'),
  bytes: (await lstat(reportPath)).size, sha256: await hashFile(reportPath) };
await writeFile(path.join(evidenceRoot, 'hash-index.json'), `${JSON.stringify({
  schemaVersion: 1, runId: manifest.runId, sourceRunRoot: runRoot,
  rawRunFileCount: rawRunFiles.length, rawRunFiles,
  evidenceFileCount: evidenceFiles.length, evidenceFiles, report,
  note: 'Original run remains in runs/<runId>; this index records its complete file set. Full workspaces are not duplicated here; selected original events and small after-snapshot source excerpts are included.',
}, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ runId: manifest.runId, rawRunFileCount: rawRunFiles.length,
  evidenceFileCount: evidenceFiles.length, reportPath: report.path }));
