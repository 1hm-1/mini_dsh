import { finishField, finishRecord, drainRows } from './assembler.mjs';
import { syntax } from './escape.mjs';
import { consumeLine } from './line.mjs';

export function createState() {
  return { field: '', fields: [], rows: [], mode: 'plain', atFieldStart: true, pendingCR: false, touched: false };
}

export function feedChar(state, char) {
  if (state.pendingCR) {
    consumeLine(state, char);
    return;
  }
  if (state.mode === 'quoted') {
    if (char === '"') state.mode = 'afterQuote';
    else state.field += char;
    return;
  }
  if (state.mode === 'afterQuote') {
    if (char === '"') throw syntax('INVALID_QUOTE');
    if (char === ',') { finishField(state); state.mode = 'plain'; state.touched = true; return; }
    if (char === '\r' || char === '\n') {
      finishField(state); state.mode = 'plain'; consumeLine(state, char); return;
    }
    throw syntax('INVALID_QUOTE');
  }
  if (char === ',') { finishField(state); state.touched = true; return; }
  if (char === '\r' || char === '\n') { finishField(state); consumeLine(state, char); return; }
  if (char === '"') {
    if (!state.atFieldStart) throw syntax('INVALID_QUOTE');
    state.mode = 'quoted'; state.touched = true; return;
  }
  state.field += char;
  state.atFieldStart = false;
  state.touched = true;
}

export function finishState(state) {
  if (state.pendingCR) throw syntax('BARE_CR');
  if (state.mode === 'quoted') throw syntax('UNTERMINATED_QUOTE');
  if (state.touched || state.fields.length > 0 || state.field !== '') {
    finishField(state);
    finishRecord(state);
  }
  return drainRows(state);
}
