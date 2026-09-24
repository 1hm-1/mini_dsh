export function mergeRanges(ranges) {
  if (!ranges.length) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const output = [ranges[0]];
  for (const range of ranges.slice(1)) {
    const last = output[output.length - 1];
    if (range[0] <= last[1]) last[1] = range[1];
    else output.push(range);
  }
  return output;
}
