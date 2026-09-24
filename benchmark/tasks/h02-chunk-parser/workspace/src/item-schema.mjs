import { syntax } from './escape.mjs';

export function validateItemRow(row) {
  if (row.length !== 2) throw syntax('COLUMN_COUNT');
  if (row[0] === '') throw syntax('EMPTY_ID');
  return { id: row[0], note: row[1] };
}
