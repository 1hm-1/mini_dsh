export function takePage(items, offset, count) {
  return items.slice(offset, offset + count);
}
