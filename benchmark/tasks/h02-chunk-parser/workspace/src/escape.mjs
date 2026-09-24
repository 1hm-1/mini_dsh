export function syntax(code) {
  return Object.assign(new SyntaxError(code), { code });
}
