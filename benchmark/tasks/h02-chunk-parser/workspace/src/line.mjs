import { finishRecord } from './assembler.mjs';

export function consumeLine(state, char) {
  if (char === '\r' || char === '\n') {
    finishRecord(state);
    return true;
  }
  return false;
}
