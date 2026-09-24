let current = 0;

export function createCounter(initial = 0) {
  if (typeof initial !== 'number' || !Number.isFinite(initial)) throw new TypeError('invalid initial');
  current = initial;
  return {
    value() { return current; },
    increment(step = 1) { current += step; return current; },
    decrement(step = 1) { current -= step; return current; },
  };
}
