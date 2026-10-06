/** Resolve Markdown image links without allowing URLs or filesystem escape. */
export function resolveAssetLink(
  source: unknown,
  documentPath: string,
): string | null {
  if (
    typeof source !== 'string' ||
    /[:\\?#%]/.test(source) ||
    source.startsWith('/')
  )
    return null;
  const parts = source.startsWith('assets/images/')
    ? []
    : documentPath.split('/').slice(0, -1);
  for (const segment of source.split('/')) {
    if (segment === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (segment && segment !== '.') parts.push(segment);
  }
  const relative = parts.join('/');
  return /^assets\/images\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif)$/.test(
    relative,
  )
    ? relative
    : null;
}
