import { createState, feedChar, finishState } from './state.mjs';
import { drainRows } from './assembler.mjs';

export function createTokenizer() {
  const state = createState();
  let ended = false;
  return {
    push(chunk) {
      if (ended) throw new Error('tokenizer already finished');
      if (typeof chunk !== 'string') throw new TypeError('chunk must be a string');
      for (const char of chunk) feedChar(state, char);
      return drainRows(state);
    },
    finish() {
      if (ended) throw new Error('tokenizer already finished');
      ended = true;
      return finishState(state);
    },
  };
}

export function parseRows(chunks) {
  if (!Array.isArray(chunks)) throw new TypeError('chunks must be an array of strings');
  const tokenizer = createTokenizer();
  const rows = [];
  for (const chunk of chunks) rows.push(...tokenizer.push(chunk));
  rows.push(...tokenizer.finish());
  return rows;
}
