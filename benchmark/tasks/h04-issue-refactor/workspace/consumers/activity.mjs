export function activityLines(issues) {
  return issues.map(issue => `${issue.id}|${issue.assignee}|${issue.tags.join(',')}`);
}
