/** Allocate readable, flat Markdown filenames. Identity remains in frontmatter. */
export function documentFilename(title: string) {
  let stem = title
    .normalize('NFC')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[. ]+/g, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  stem = [...stem]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('');
  if (!stem || /^\.+$/.test(stem)) stem = '문서';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))
    stem = `문서-${stem}`;
  return stem;
}
export function allocateDocumentPath(
  title: string,
  paths: Iterable<string>,
  id: string,
) {
  const used = new Set([...paths].map((p) => p.toLowerCase()));
  const stem = documentFilename(title);
  let path = `docs/${stem}.md`;
  if (!used.has(path.toLowerCase())) return path;
  const suffix = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'copy';
  path = `docs/${stem}-${suffix}.md`;
  let number = 2;
  while (used.has(path.toLowerCase()))
    path = `docs/${stem}-${suffix}-${number++}.md`;
  return path;
}
