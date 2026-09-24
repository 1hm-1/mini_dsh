import { activityLines } from '../consumers/activity.mjs';
export function consoleActivity(issues) {
  return activityLines(issues).join('\n');
}
