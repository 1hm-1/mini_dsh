import { listIssues } from './list.mjs';

export function searchIssues(issues, query) {
  if (typeof query !== 'string') throw new TypeError('query must be a string');
  return listIssues(issues).filter(issue => issue.title.includes(query));
}
