import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIssue } from './normalize.mjs';
import { listIssues } from './consumers/list.mjs';
import { searchIssues } from './consumers/search.mjs';
import { activityLines } from './consumers/activity.mjs';
import { serializeIssues } from './serialize.mjs';
import { boardSnapshot } from './api.mjs';
import { legacyTitle } from './legacy.mjs';
import { formatDay } from './utils/date.mjs';
import { takePage } from './utils/paging.mjs';
import { truncateLabel } from './utils/text.mjs';
import { consoleActivity } from './adapters/console.mjs';

const issue = (id, title, tags = [], assignee = null) => ({ id, title, tags, assignee });
test('frozen issue and tags stay unchanged', () => {
  const tags = Object.freeze([' UI ', 'ui']);
  const raw = Object.freeze({ id: ' Z ', title: ' Mixed Case ', tags, assignee: ' Ada ' });
  assert.deepEqual(normalizeIssue(raw), { id: 'Z', title: 'Mixed Case', tags: ['ui'], assignee: 'ada' });
  assert.deepEqual(raw.tags, [' UI ', 'ui']);
});
test('stable order and duplicate IDs remain separate', () => {
  const raw = Object.freeze([issue('B', ' one '), issue('A', 'two'), issue('B', 'three')]);
  assert.deepEqual(listIssues(raw).map(item => item.id), ['B', 'A', 'B']);
  assert.deepEqual(raw.map(item => item.id), ['B', 'A', 'B']);
});
test('search trims and matches title or normalized tag only', () => {
  const raw = [issue('UI-1', 'Server', [' Backend ']), issue('B', ' UI work '), issue('C', 'Else', ['UI'])];
  assert.deepEqual(searchIssues(raw, ' UI ').map(item => item.id), ['B', 'C']);
  assert.deepEqual(searchIssues(raw, '   ').map(item => item.id), ['UI-1', 'B', 'C']);
  assert.deepEqual(searchIssues(raw, 'ui-1'), []);
});
test('null and blank assignees render as unassigned', () => {
  const raw = [issue('A', 'x', [], null), issue('B', 'y', ['X'], '   ')];
  assert.deepEqual(activityLines(raw), ['A|-|', 'B|-|x']);
  assert.equal(consoleActivity(raw), 'A|-|\nB|-|x');
});
test('serialization omits extra fields and preserves key order', () => {
  const raw = [{ ...issue(' A ', ' Hi ', ['X'], null), extra: 3 }];
  assert.equal(serializeIssues(raw), '[{"id":"A","title":"Hi","tags":["x"],"assignee":null}]');
  assert.deepEqual(boardSnapshot(raw), { issues: listIssues(raw), activity: ['A|-|x'] });
});
test('validation error class and message propagate through consumers', () => {
  const bad = [issue('', 'title')];
  for (const call of [() => normalizeIssue(bad[0]), () => listIssues(bad), () => searchIssues(bad, ''), () => activityLines(bad), () => serializeIssues(bad)]) {
    assert.throws(call, { name: 'TypeError', message: 'invalid issue' });
  }
  for (const call of [() => listIssues(null), () => activityLines(null), () => serializeIssues(null)]) {
    assert.throws(call, { name: 'TypeError', message: 'issues must be an array' });
  }
  assert.throws(() => searchIssues([], null), { name: 'TypeError', message: 'query must be a string' });
});
test('legacy API and unrelated helpers retain behavior', () => {
  assert.equal(legacyTitle({ title: 3 }), '3');
  assert.equal(formatDay('2026-09-24T12:00:00Z'), '2026-09-24');
  assert.deepEqual(takePage([1, 2, 3], 1, 1), [2]);
  assert.equal(truncateLabel('abcdef', 3), 'abc…');
});
