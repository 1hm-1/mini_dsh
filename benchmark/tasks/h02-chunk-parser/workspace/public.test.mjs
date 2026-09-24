import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, readItems, countItems } from './src/index.mjs';

test('ordinary rows and consumers agree', () => {
  const chunks = ['a,one\nb,two'];
  assert.deepEqual(parseRows(chunks), [['a', 'one'], ['b', 'two']]);
  assert.deepEqual(readItems(chunks), [{ id: 'a', note: 'one' }, { id: 'b', note: 'two' }]);
  assert.equal(countItems(chunks), 2);
});

test('a quoted comma remains inside one field across chunks', () => {
  assert.deepEqual(parseRows(['a,"one', ',two"\nb,three']), [['a', 'one,two'], ['b', 'three']]);
});

test('CRLF split across chunks ends one record', () => {
  assert.deepEqual(parseRows(['a,one\r', '\nb,two']), [['a', 'one'], ['b', 'two']]);
});

test('doubled quotes unescape across chunks', () => {
  assert.deepEqual(parseRows(['a,"say "', '"hi"""']), [['a', 'say "hi"']]);
});

test('unrelated helpers retain ordinary behavior', async () => {
  const [{ slug }, { checksum }] = await Promise.all([import('./src/slug.mjs'), import('./src/checksum.mjs')]);
  assert.equal(slug(' North Star '), 'north-star');
  assert.equal(checksum([255, 2]), 1);
});
