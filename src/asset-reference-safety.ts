import { unified } from 'unified';
import remarkParse from 'remark-parse';
import matter from './markdown.ts';
import type { Snapshot } from './project-store.ts';
import { imageAsset } from './file-assets.ts';
import { resolveAssetLink } from './asset-links.ts';

const parser = unified().use(remarkParse);
const normalize = (value: string) =>
  value
    .replace(/%([a-f0-9]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .toLowerCase();

function markdownReferences(path: string, raw: string) {
  const { matter: metadata, content } = matter(raw);
  const definitions = new Map<string, string>();
  const references = new Set<string>();
  const urls: string[] = [];
  const inlineHtml: string[] = [];
  const visit = (node: {
    type: string;
    url?: string;
    identifier?: string;
    value?: string;
    children?: unknown[];
  }) => {
    if (node.type === 'definition')
      definitions.set(node.identifier!, node.url!);
    if (node.type === 'link' || node.type === 'image') urls.push(node.url!);
    if (node.type === 'linkReference' || node.type === 'imageReference')
      references.add(node.identifier!);
    if (node.type === 'html') inlineHtml.push(node.value!);
    for (const child of node.children ?? [])
      visit(child as Parameters<typeof visit>[0]);
  };
  visit(parser.parse(content));
  for (const id of references) {
    const url = definitions.get(id);
    if (url) urls.push(url);
  }
  return {
    links: new Set(
      urls.map((url) =>
        resolveAssetLink(
          normalize(url.split(/[?#]/, 1)[0]),
          path.toLowerCase(),
        ),
      ),
    ),
    other: normalize([metadata, ...inlineHtml].join('\n')),
  };
}

function survivingReferences(files: Snapshot, candidates: Set<string>) {
  const found = new Map<string, string>();
  if (!candidates.size) return found;
  for (const [path, raw] of Object.entries(files)) {
    if (found.size === candidates.size) break;
    const source =
      /\.(?:css|js|mjs|json|svg|txt|html?)$/i.test(path) &&
      raw.startsWith('data:application/octet-stream;base64,')
        ? Buffer.from(
            raw.slice('data:application/octet-stream;base64,'.length),
            'base64',
          ).toString('utf8')
        : raw;
    const text = normalize(source);
    let markdown: ReturnType<typeof markdownReferences> | undefined;
    for (const image of candidates) {
      const name = image.split('/').at(-1)!.toLowerCase();
      if (path === image || found.has(image) || !text.includes(name)) continue;
      if (path.endsWith('.md')) {
        // Parse Markdown links so example code and unused definitions can stay.
        markdown ??= markdownReferences(path, source);
        if (
          !markdown.links.has(image.toLowerCase()) &&
          !markdown.other.includes(name)
        )
          continue;
      }
      found.set(image, path);
    }
  }
  return found;
}

/** A managed image belongs to the project until the last reference is removed. */
export function collectDeletedImageAssets(before: Snapshot, after: Snapshot) {
  const candidates = new Set<string>();
  for (const [path, raw] of Object.entries(before)) {
    if (
      !path.endsWith('.md') ||
      after[path] !== undefined ||
      !raw.includes('assets/images/')
    )
      continue;
    const asset = imageAsset(matter(raw).data.asset);
    if (asset && after[asset.path] !== undefined) candidates.add(asset.path);
  }
  for (const image of survivingReferences(after, candidates).keys())
    candidates.delete(image);
  if (!candidates.size) return after;
  const next = { ...after };
  for (const image of candidates) delete next[image];
  return next;
}

/** History must not remove assets referenced by a surviving file. */
export function assertRemovedImagesUnreferenced(
  current: Snapshot,
  next: Snapshot,
) {
  const removed = new Set(
    Object.keys(current).filter(
      (p) => p.startsWith('assets/images/') && next[p] === undefined,
    ),
  );
  const [reference] = survivingReferences(next, removed).values();
  if (reference)
    throw Error(`다른 파일에서 참조하는 이미지가 있습니다: ${reference}`);
}
