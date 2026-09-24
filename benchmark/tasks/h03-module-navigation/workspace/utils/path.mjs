export function parentPath(path) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}
