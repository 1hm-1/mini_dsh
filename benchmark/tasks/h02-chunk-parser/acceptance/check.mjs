import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, readItems, countItems } from './src/index.mjs';

function syntaxCode(action, code) {
  assert.throws(action, error => error instanceof SyntaxError && error.code === code);
}

test('every two-way chunk split matches whole input', () => {
  const input = 'a,"x,y"\r\nb,"line\nnext"\nc,"say ""hi"""\n';
  const expected = parseRows([input]);
  for (let at = 0; at <= input.length; at++) assert.deepEqual(parseRows([input.slice(0, at), input.slice(at)]), expected);
  assert.deepEqual(parseRows(input.split('').flatMap(char => ['', char, ''])), expected);
  assert.deepEqual(expected, [['a', 'x,y'], ['b', 'line\nnext'], ['c', 'say "hi"']]);
});
test('quoted CRLF is preserved and outside CRLF is a delimiter', () => {
  assert.deepEqual(parseRows(['x,"line\r', '\nnext"\r', '\ny,z']), [['x', 'line\r\nnext'], ['y', 'z']]);
});
test('doubled quotes spanning chunks become one quote', () => {
  assert.deepEqual(parseRows(['x,"a"', '"b"\n']), [['x', 'a"b']]);
});
test('empty fields, blank lines, and trailing newline follow the small grammar', () => {
  assert.deepEqual(parseRows(['\n,a,\n']), [[''], ['', 'a', '']]);
  assert.deepEqual(parseRows([]), []);
  assert.deepEqual(parseRows(['a,b\n']), [['a', 'b']]);
});
test('invalid quote positions have INVALID_QUOTE', () => {
  syntaxCode(() => parseRows(['a,b"c']), 'INVALID_QUOTE');
  syntaxCode(() => parseRows(['a,"b"x']), 'INVALID_QUOTE');
});
test('open quote and bare CR have distinct errors', () => {
  syntaxCode(() => parseRows(['a,"open']), 'UNTERMINATED_QUOTE');
  syntaxCode(() => parseRows(['a,b\r']), 'BARE_CR');
  syntaxCode(() => parseRows(['a,b\r', 'x']), 'BARE_CR');
});
test('both consumers preserve quoted contents and count the same rows', () => {
  const chunks = ['a,"one,', 'two"\r\nb,"new\nline"'];
  assert.deepEqual(readItems(chunks), [{ id: 'a', note: 'one,two' }, { id: 'b', note: 'new\nline' }]);
  assert.equal(countItems(chunks), 2);
});
test('both consumers reject wrong columns and empty ids', () => {
  for (const consumer of [readItems, countItems]) {
    syntaxCode(() => consumer(['a,b,c']), 'COLUMN_COUNT');
    syntaxCode(() => consumer([',note']), 'EMPTY_ID');
    syntaxCode(() => consumer(['a,"open']), 'UNTERMINATED_QUOTE');
  }
});
test('empty input has no items and invalid chunks throw TypeError', () => {
  assert.deepEqual(readItems([]), []);
  assert.equal(countItems([]), 0);
  assert.throws(() => parseRows('a,b'), TypeError);
  assert.throws(() => parseRows(['a,b', null]), TypeError);
});
