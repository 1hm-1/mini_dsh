import { normalizeIssue } from '../normalize.mjs';

export function listIssues(issues) {
  if (!Array.isArray(issues)) throw new TypeError('issues must be an array');
  return issues.sort((a, b) => a.id.localeCompare(b.id)).map(normalizeIssue);
}
