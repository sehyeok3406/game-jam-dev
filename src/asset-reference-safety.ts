import { unified } from 'unified';
import remarkParse from 'remark-parse';
import matter from './markdown.ts';
import { resolveAssetLink } from './asset-links.ts';
import type { Snapshot } from './project-store.ts';

/** Undo must not remove assets now referenced by another surviving document. */
export function assertRemovedImagesUnreferenced(
  current: Snapshot,
  next: Snapshot,
) {
  const removed = new Set(
    Object.keys(current).filter(
      (p) => p.startsWith('assets/images/') && next[p] === undefined,
    ),
  );
  if (!removed.size) return;
  for (const [path, raw] of Object.entries(next)) {
    if (!path.endsWith('.md')) continue;
    const tree = unified().use(remarkParse).parse(matter(raw).content);
    const definitions = new Map<string, string>();
    const images: string[] = [],
      references: string[] = [];
    const visit = (node: {
      type: string;
      url?: string;
      identifier?: string;
      children?: unknown[];
    }) => {
      if (node.type === 'definition')
        definitions.set(node.identifier!, node.url!);
      if (node.type === 'image') images.push(node.url!);
      if (node.type === 'imageReference') references.push(node.identifier!);
      for (const child of node.children ?? [])
        visit(child as Parameters<typeof visit>[0]);
    };
    visit(tree);
    for (const id of references)
      if (definitions.has(id)) images.push(definitions.get(id)!);
    for (const source of images) {
      const image = resolveAssetLink(source, path);
      if (image && removed.has(image))
        throw new Error(
          `다른 문서에서 참조하는 이미지가 있어 실행 취소할 수 없습니다: ${path}`,
        );
    }
  }
}
