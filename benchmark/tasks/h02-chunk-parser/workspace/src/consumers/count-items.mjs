import { parseRows } from '../tokenizer.mjs';
import { validateItemRow } from '../item-schema.mjs';

export function countItems(chunks) {
  const rows = parseRows(chunks);
  for (const row of rows) validateItemRow(row);
  return rows.length;
}
