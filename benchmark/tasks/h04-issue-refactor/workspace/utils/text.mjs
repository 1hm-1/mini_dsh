export function truncateLabel(value, length) {
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}
