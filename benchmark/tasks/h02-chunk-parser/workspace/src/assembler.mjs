export function finishField(state) {
  state.fields.push(state.field);
  state.field = '';
  state.atFieldStart = true;
}

export function finishRecord(state) {
  state.rows.push(state.fields);
  state.fields = [];
  state.touched = false;
}

export function drainRows(state) {
  const rows = state.rows;
  state.rows = [];
  return rows;
}
