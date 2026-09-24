export function queryPairs(search) {
  return [...new URLSearchParams(search).entries()];
}
