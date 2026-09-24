import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags } from './tags.mjs';

test('empty input returns no tags', () => assert.deepEqual(parseTags(''), []));
test('delimiter and whitespace-only parts vanish', () => assert.deepEqual(parseTags(' , \t,\n,'), []));
test('internal whitespace is collapsed before uniqueness', () => {
  assert.deepEqual(parseTags('North   Star, north\tstar, SOUTH  Pole'), ['north star', 'south pole']);
});
test('first normalized occurrence determines order', () => {
  assert.deepEqual(parseTags(' B , a, b, C, A '), ['b', 'a', 'c']);
});
test('non-string input throws TypeError', () => {
  assert.throws(() => parseTags(null), TypeError);
  assert.throws(() => parseTags(['a']), TypeError);
});
