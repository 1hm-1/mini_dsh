export function assertIssue(issue) {
  if (issue === null || typeof issue !== 'object' || Array.isArray(issue)
    || !Object.hasOwn(issue, 'id') || typeof issue.id !== 'string' || !issue.id.trim()
    || !Object.hasOwn(issue, 'title') || typeof issue.title !== 'string'
    || !Object.hasOwn(issue, 'tags') || !Array.isArray(issue.tags) || issue.tags.some(tag => typeof tag !== 'string')
    || !Object.hasOwn(issue, 'assignee') || issue.assignee !== null && typeof issue.assignee !== 'string') {
    throw new TypeError('invalid issue');
  }
}
