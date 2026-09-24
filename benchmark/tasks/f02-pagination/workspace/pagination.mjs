export function paginate(items, page, pageSize) {
  const start = page * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    totalPages: Math.floor(items.length / pageSize),
    nextPage: page + 1,
  };
}
