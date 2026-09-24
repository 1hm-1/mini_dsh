import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchedule } from '../eval/schedule.js';

test('E06 schedule sorts tasks and rotates spec ordered variants within each repeat', () => {
  const entries = buildSchedule(['z', 'a'], ['full', 'baseline', 'optimizer', 'context'], 2);
  assert.deepEqual(entries.map(({ taskId, variant, repeat, orderIndex }) => [taskId, variant, repeat, orderIndex]), [
    ['a', 'baseline', 1, 0], ['a', 'context', 1, 1], ['a', 'optimizer', 1, 2], ['a', 'full', 1, 3],
    ['z', 'context', 1, 4], ['z', 'optimizer', 1, 5], ['z', 'full', 1, 6], ['z', 'baseline', 1, 7],
    ['a', 'context', 2, 8], ['a', 'optimizer', 2, 9], ['a', 'full', 2, 10], ['a', 'baseline', 2, 11],
    ['z', 'optimizer', 2, 12], ['z', 'full', 2, 13], ['z', 'baseline', 2, 14], ['z', 'context', 2, 15],
  ]);
});

test('schedule rejects invalid inputs rather than dropping them', () => {
  assert.throws(() => buildSchedule([], ['baseline'], 1));
  assert.throws(() => buildSchedule(['x', 'x'], ['baseline'], 1));
  assert.throws(() => buildSchedule(['x'], ['baseline', 'baseline'], 1));
  assert.throws(() => buildSchedule(['x'], ['unknown' as never], 1));
  assert.throws(() => buildSchedule(['x'], ['baseline'], 0));
});
