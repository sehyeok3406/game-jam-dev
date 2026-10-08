import matter from './markdown.ts';
import { decodeAsset, imageAsset } from './file-assets.ts';
import { CanvasError } from './app-errors.ts';
import type { Snapshot } from './project-store.ts';
import { validateHtmlInputs } from './html-inputs.ts';

/** Only selected, validated project assets may replace these generated placeholders. */
export function embedSelectedAssets(
  html: string,
  specification: string,
  files: Snapshot,
) {
  const paths = new Set<string>();
  validateHtmlInputs(specification, files);
  const data = matter(specification).data;
  const inputs = data.inputs;
  for (const source of Array.isArray(data.html_input_sources)
    ? data.html_input_sources
    : [])
    for (const file of source.files ?? []) paths.add(file.path);
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
      const bytes = decodeAsset(assetPath, files[assetPath]);
      if (!files[assetPath].startsWith('data:application/octet-stream;'))
        return files[assetPath];
      const mimes: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        woff: 'font/woff',
        woff2: 'font/woff2',
        ttf: 'font/ttf',
        mp3: 'audio/mpeg',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
      };
      const mime = mimes[assetPath.split('.').at(-1)!.toLowerCase()];
      if (!mime)
        throw new CanvasError(
          'GC-AI-004',
          'HTML 관련 CSS·JavaScript는 결과 HTML 내부에 작성해주세요.',
        );
      return `data:${mime};base64,${bytes.toString('base64')}`;
    },
  );
}
