import { listIssues } from './consumers/list.mjs';
import { activityLines } from './consumers/activity.mjs';

export function boardSnapshot(issues) {
  return { issues: listIssues(issues), activity: activityLines(issues) };
}
