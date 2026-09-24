import { assertIssue } from './validators.mjs';

export function normalizeIssue(issue) {
  assertIssue(issue);
  issue.id = issue.id.trim();
  issue.title = issue.title.trim().toLowerCase();
  issue.tags = [...new Set(issue.tags.map(tag => tag.trim()))];
  issue.assignee = issue.assignee === null ? null : issue.assignee.trim();
  return issue;
}
