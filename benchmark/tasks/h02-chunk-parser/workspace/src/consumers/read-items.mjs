import { parseRows } from '../tokenizer.mjs';
import { validateItemRow } from '../item-schema.mjs';

export function readItems(chunks) {
  return parseRows(chunks).map(validateItemRow);
}
