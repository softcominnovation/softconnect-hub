export function canonicalEvolutionEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
