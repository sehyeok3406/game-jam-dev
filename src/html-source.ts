import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { inspectHtml } from './html-document.ts';
import { isPreviewPath } from './preview-output.ts';
import type { Snapshot } from './project-store.ts';
import type { PreviewResult } from './shared.ts';

export const MAX_HTML_BYTES = 8_000_000;

export const htmlHash = (content: string) =>
  createHash('sha256').update(content).digest('hex');
export const htmlSourceId = (relative: string) =>
  `html-${htmlHash(relative).slice(0, 24)}`;
export const htmlSourcePath = (relative: string) =>
  `docs/html-sources/${htmlSourceId(relative)}.md`;

/** Parse inertly, never evaluate scripts or fetch referenced resources. */
export function inspectImportedHtml(content: string, name: string) {
  if (Buffer.byteLength(content) > MAX_HTML_BYTES || content.includes('\0'))
    throw new CanvasError(
      'GC-IMPORT-003',
      `${name}: HTML은 UTF-8 텍스트, 최대 8MB여야 합니다.`,
    );
  try {
    inspectHtml(content, name);
  } catch (error) {
    throw new CanvasError(
      'GC-IMPORT-003',
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const references = new Set<string>();
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('attrs' in node)
      for (const attr of node.attrs) {
        if (
          ['src', 'href', 'poster', 'srcset'].includes(attr.name) &&
          !(node.tagName === 'a' && attr.name === 'href') &&
          attr.value &&
          !/^(?:data:|#)/i.test(attr.value)
        )
          references.add(attr.value.slice(0, 200));
      }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child);
  };
  walk(parse(content));
  // Include CSS URLs and JavaScript network/file loads without executing them.
  for (const match of content.matchAll(
    /(?:url\(\s*['"]?|(?:fetch|import)\(\s*['"])([^'"\s)]+)/gi,
  )) {
    if (!/^(?:data:|#)/i.test(match[1])) references.add(match[1].slice(0, 200));
  }
  return references.size
    ? [
        `외부 파일·URL 참조가 있습니다. 단일 HTML만 복사되므로 일부 기능이 동작하지 않을 수 있습니다: ${[...references].slice(0, 8).join(', ')}`,
      ]
    : [];
}

export function sourceMetadata(
  relative: string,
  content: string,
  options: {
    title?: string;
    originalName?: string;
    x?: number;
    y?: number;
  } = {},
) {
  const id = htmlSourceId(relative);
  return matter.stringify(
    '# HTML 원본 관리\n\n이 문서는 HTML 창의 고유 ID와 원본 정보를 관리합니다.\n',
    {
      id,
      title: options.title ?? relative.split('/').at(-1),
      type: 'reference',
      status: 'imported',
      sources: [],
      html_source: relative,
      imported_from: options.originalName ?? null,
      imported_sha256: htmlHash(content),
      x: options.x ?? 120,
      y: options.y ?? 120,
      width: 720,
      height: 520,
      updated_at: Date.now(),
    },
  );
}

export function describePreview(
  files: Snapshot,
  relative: string,
): PreviewResult {
  const recordPath = htmlSourcePath(relative);
  const data = files[recordPath] ? matter(files[recordPath]).data : {};
  const content = files[relative] ?? '';
  let warnings: string[] = [];
  if (data.html_source === relative) {
    try {
      warnings = inspectImportedHtml(content, relative);
    } catch (error) {
      warnings = [error instanceof Error ? error.message : String(error)];
    }
  }
  return {
    exists: files[relative] !== undefined,
    relativePath: relative,
    content,
    sourceId: htmlSourceId(relative),
    sourcePath: recordPath,
    title: typeof data.title === 'string' ? data.title : undefined,
    ...(data.html_source === relative
      ? {
          initialWindow: {
            x: Number.isFinite(data.x) ? data.x : 120,
            y: Number.isFinite(data.y) ? data.y : 120,
            width: 720,
            height: 520,
            collapsed: false,
          },
          warnings,
        }
      : {}),
  };
}

export function prepareHtmlSource(
  files: Snapshot,
  paths: string[],
  sourceMode?: string,
) {
  const htmlPaths = paths.filter(isPreviewPath);
  if (!htmlPaths.length && sourceMode !== 'html') return null;
  if (htmlPaths.length !== 1 || sourceMode !== 'html')
    throw new CanvasError(
      'GC-AI-007',
      'HTML 분석에는 게임 한 개만 선택해주세요.',
    );
  const path = htmlPaths[0],
    content = files[path];
  if (typeof content !== 'string')
    throw new CanvasError('GC-AI-007', '분석할 HTML 파일을 찾을 수 없습니다.');
  inspectImportedHtml(content, path);
  const recordPath = htmlSourcePath(path),
    id = htmlSourceId(path);
  if (files[recordPath]) {
    const data = matter(files[recordPath]).data;
    if (data.id !== id || data.html_source !== path)
      throw new CanvasError(
        'GC-AI-007',
        'HTML 관리 문서의 ID·원본 경로가 일치하지 않습니다.',
      );
  }
  const additions = files[recordPath]
    ? {}
    : { [recordPath]: sourceMetadata(path, content) };
  return {
    additions,
    recordPath,
    descriptor: { id, path, sha256: htmlHash(content) },
  };
}

export function validateHtmlAnalysis(
  task: string,
  files: Snapshot,
  outputs?: string[],
) {
  const data = matter(task).data;
  if (data.source_mode !== 'html') return;
  const source = data.html_analysis_source;
  if (
    !source ||
    !isPreviewPath(source.path) ||
    source.id !== htmlSourceId(source.path) ||
    typeof files[source.path] !== 'string' ||
    source.sha256 !== htmlHash(files[source.path]) ||
    !Array.isArray(data.inputs) ||
    !data.inputs.includes(source.path) ||
    !data.inputs.includes(htmlSourcePath(source.path))
  )
    throw new CanvasError(
      'GC-SYNC-001',
      '분석 대상 HTML이 변경되었거나 출처 정보가 올바르지 않습니다.',
    );
  if (!outputs) return;
  for (const relative of outputs.filter((path) => path.endsWith('.md'))) {
    const doc = matter(files[relative] ?? '').data;
    if (
      !Array.isArray(doc.sources) ||
      !doc.sources.some(
        (ref: unknown) =>
          (typeof ref === 'string' ? ref : (ref as { id?: string })?.id) ===
          source.id,
      ) ||
      doc.analyzed_html?.id !== source.id ||
      doc.analyzed_html?.path !== source.path ||
      doc.analyzed_html?.sha256 !== source.sha256
    )
      throw new CanvasError(
        'GC-MD-003',
        `HTML 분석 출처와 파일 상태(analyzed_html)를 기록해주세요: ${relative}`,
      );
  }
}
