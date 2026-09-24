export function matchDynamic(pattern, path) {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    const value = pathParts[i];
    if (part.startsWith(':')) {
      if (!value) return null;
      params[part.slice(1)] = value;
    } else if (part !== value) return null;
  }
  return params;
}
