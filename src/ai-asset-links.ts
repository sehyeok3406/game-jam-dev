import matter from './markdown.ts';
import { decodeAsset, imageAsset } from './file-assets.ts';
import { CanvasError } from './app-errors.ts';
import type { Snapshot } from './project-store.ts';

/** Only selected, validated project assets may replace these generated placeholders. */
export function embedSelectedAssets(
  html: string,
  specification: string,
  files: Snapshot,
) {
  const paths = new Set<string>();
  const inputs = matter(specification).data.inputs;
  for (const input of Array.isArray(inputs) ? inputs : []) {
    if (typeof input !== 'string' || !input.endsWith('.md') || !files[input])
      continue;
    const asset = imageAsset(matter(files[input]).data.asset);
    if (asset) paths.add(asset.path);
  }
  return html.replace(
    /gamecanvas-asset:([^\s"'`<>\\)]+)/g,
    (_match, assetPath: string) => {
      if (!paths.has(assetPath) || !files[assetPath])
        throw new CanvasError(
          'GC-AI-004',
          'AI가 선택되지 않은 이미지 경로를 사용했습니다.',
        );
      decodeAsset(assetPath, files[assetPath]);
      return files[assetPath];
    },
  );
}
