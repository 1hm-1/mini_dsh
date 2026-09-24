import { parseOrders } from './parser.mjs';

export function buildReport(text) {
  const rows = parseOrders(text);
  return {
    items: rows.map(row => ({ sku: row.sku, quantity: row.quantity, totalCents: row.unitPriceCents })),
    totalUnits: rows.length,
    totalCents: rows.reduce((sum, row) => sum + row.unitPriceCents, 0),
  };
}
