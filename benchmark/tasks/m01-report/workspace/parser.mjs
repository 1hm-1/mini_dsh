export function parseOrders(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const [sku, quantity, unitPriceCents] = line.split(',');
    return { sku, quantity: Number(quantity), unitPriceCents: Number(unitPriceCents) };
  });
}
