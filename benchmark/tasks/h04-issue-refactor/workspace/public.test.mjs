import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIssue } from './normalize.mjs';
import { listIssues } from './consumers/list.mjs';
import { searchIssues } from './consumers/search.mjs';
import { activityLines } from './consumers/activity.mjs';
import { serializeIssues } from './serialize.mjs';

test('normalization applies distinct casing and stable tag de-duplication', () => {
  assert.deepEqual(normalizeIssue({ id: ' B-2 ', title: '  Fix API  ', tags: [' UI ', 'ui', '', 'BackEnd'], assignee: ' Ada ' }),
    { id: 'B-2', title: 'Fix API', tags: ['ui', 'backend'], assignee: 'ada' });
});
test('list and search preserve input order', () => {
  const issues = [{ id: 'B', title: '  UI fix ', tags: [], assignee: null }, { id: 'A', title: 'API', tags: ['UI'], assignee: null }];
  assert.deepEqual(listIssues(issues).map(issue => issue.id), ['B', 'A']);
  assert.deepEqual(searchIssues(issues, ' ui ').map(issue => issue.id), ['B', 'A']);
});
test('activity and serialization use normalized records', () => {
  const issues = [{ id: ' X ', title: 'Title', tags: [' A '], assignee: null }];
  assert.deepEqual(activityLines(issues), ['X|-|a']);
  assert.equal(serializeIssues(issues), '[{"id":"X","title":"Title","tags":["a"],"assignee":null}]');
});
