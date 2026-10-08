import { parse, type DefaultTreeAdapterMap } from 'parse5';
import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { isAssetPath, decodeAsset } from './file-assets.ts';
import { isResultFolderPath, isPreviewPath } from './preview-output.ts';
import { htmlHash, htmlSourceId, htmlSourcePath } from './html-source.ts';
import type { Snapshot } from './project-store.ts';

export type HtmlInputSource = {
  id: string;
  path: string;
  sha256: string;
  files: { path: string; sha256: string }[];
  warnings: string[];
};

/** Static dependency inspection only; never execute code or download resources. */
function references(content: string, html: boolean) {
  const result = new Set<string>();
  if (html) {
    const walk = (node: DefaultTreeAdapterMap['node']) => {
      if ('attrs' in node)
        for (const attr of node.attrs) {
          if (node.tagName === 'a' && attr.name === 'href') continue;
          if (['src', 'href', 'poster'].includes(attr.name))
            result.add(attr.value);
          if (attr.name === 'srcset')
            for (const item of attr.value.match(
              /(?:data:[^\s]+|[^,\s]+)(?:\s+[\d.]+[wx])?/g,
            ) ?? [])
              result.add(item.trim().split(/\s+/)[0].replace(/,$/, ''));
        }
      if ('childNodes' in node)
        for (const child of node.childNodes) walk(child);
    };
    walk(parse(content));
  }
  for (const match of content.matchAll(
    /(?:url\(\s*['"]?|(?:fetch|import)\(\s*['"]|(?:\bfrom|@import)\s*['"]|\bimport\s*['"])([^'"\s)]+)/gi,
  ))
    result.add(match[1]);
  return [...result].filter(
    (value) => value && !/^(?:data:|blob:|#)/i.test(value),
  );
}

export function describeHtmlInput(
  files: Snapshot,
  path: string,
): HtmlInputSource {
  const folder = isResultFolderPath(path)
    ? path.slice(0, path.lastIndexOf('/'))
    : undefined;
  const support = Object.keys(files)
    .filter(
      (relative) =>
        folder && relative.startsWith(`${folder}/`) && isAssetPath(relative),
    )
    .sort();
  const warnings = new Set<string>();
  for (const relative of [
    path,
    ...support.filter((file) => /\.(?:css|js)$/i.test(file)),
  ]) {
    const content =
      relative === path
        ? files[path]
        : decodeAsset(relative, files[relative]).toString('utf8');
    for (const ref of references(content, relative === path)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) {
        warnings.add(`외부 참조는 내려받지 않습니다: ${ref.slice(0, 200)}`);
        continue;
      }
      let resolved: string;
      try {
        if (ref.includes('\\') || ref.startsWith('/')) throw new Error();
        resolved = decodeURIComponent(
          new URL(ref, `file:///${relative}`).pathname.slice(1),
        );
      } catch {
        throw new CanvasError(
          'GC-AI-007',
          `HTML 관련 파일 경로를 확인해주세요: ${relative} → ${ref.slice(0, 200)}`,
        );
      }
      if (!support.includes(resolved))
        throw new CanvasError(
          'GC-AI-007',
          `HTML 전용 폴더에 관련 파일이 없거나 허용되지 않는 참조입니다: ${relative} → ${ref.slice(0, 200)}`,
        );
    }
  }
  return {
    id: htmlSourceId(path),
    path,
    sha256: htmlHash(files[path]),
    files: support.map((relative) => ({
      path: relative,
      sha256: htmlHash(files[relative]),
    })),
    warnings: [...warnings],
  };
}

/** Validate frozen provenance before execution and publication, including assets. */
export function validateHtmlInputs(
  task: string,
  files: Snapshot,
  outputs?: string[],
) {
  const data = matter(task).data;
  if (data.html_inputs_version === undefined) {
    if (data.source_mode === 'html-compose')
      throw new CanvasError(
        'GC-AI-007',
        'HTML 입력 출처가 없습니다. 새 작업을 만들어주세요.',
      );
    return;
  }
  const sources: HtmlInputSource[] = data.html_input_sources;
  if (
    data.html_inputs_version !== 1 ||
    !Array.isArray(sources) ||
    !sources.length ||
    !Array.isArray(data.inputs) ||
    data.inputs.some(
      (path: unknown) =>
        typeof path !== 'string' || path.split('/').includes('..'),
    ) ||
    data.inputs.filter(isPreviewPath).length !== sources.length ||
    new Set(sources.map((source) => source?.path)).size !== sources.length
  )
    throw new CanvasError(
      'GC-AI-007',
      'HTML 입력 출처 형식이 올바르지 않습니다.',
    );
  for (const source of sources) {
    if (
      !source ||
      !isPreviewPath(source.path) ||
      typeof files[source.path] !== 'string' ||
      source.id !== htmlSourceId(source.path) ||
      source.sha256 !== htmlHash(files[source.path]) ||
      !Array.isArray(source.files) ||
      !Array.isArray(data.inputs) ||
      !data.inputs.includes(source.path) ||
      !data.inputs.includes(htmlSourcePath(source.path))
    )
      throw new CanvasError(
        'GC-SYNC-001',
        'HTML 입력이 변경되었거나 출처 정보가 올바르지 않습니다.',
      );
    const record = matter(files[htmlSourcePath(source.path)] ?? '').data;
    if (record.id !== source.id || record.html_source !== source.path)
      throw new CanvasError(
        'GC-SYNC-001',
        'HTML 관리 문서와 입력 출처가 일치하지 않습니다.',
      );
    if (
      source.files.some(
        (file) =>
          !file ||
          typeof file.path !== 'string' ||
          typeof files[file.path] !== 'string' ||
          file.sha256 !== htmlHash(files[file.path]),
      )
    )
      throw new CanvasError('GC-SYNC-001', 'HTML 관련 파일이 변경되었습니다.');
    const expected = describeHtmlInput(files, source.path);
    if (
      JSON.stringify(source.files) !== JSON.stringify(expected.files) ||
      source.files.some((file) => !data.inputs.includes(file.path))
    )
      throw new CanvasError(
        'GC-SYNC-001',
        'HTML 관련 파일이 변경되었거나 입력 범위를 벗어났습니다.',
      );
  }
  if (Array.isArray(data.workflow_steps)) {
    const second = matter(data.workflow_steps[1] ?? '').data;
    if (
      second.html_inputs_version !== 1 ||
      JSON.stringify(second.html_input_sources) !== JSON.stringify(sources) ||
      sources.some((source) =>
        [
          source.path,
          htmlSourcePath(source.path),
          ...source.files.map((file) => file.path),
        ].some((path) => !second.inputs?.includes(path)),
      )
    )
      throw new CanvasError(
        'GC-AI-007',
        'HTML 구현 단계에서 선택한 재료가 누락되거나 변경되었습니다.',
      );
  }
  if (!outputs || data.source_mode !== 'html-compose') return;
  for (const relative of outputs.filter((path) => path.endsWith('.md'))) {
    const doc = matter(files[relative] ?? '').data;
    if (
      !Array.isArray(doc.sources) ||
      sources.some(
        (source) =>
          !doc.sources.some(
            (ref: string | { id?: string }) =>
              (typeof ref === 'string' ? ref : ref?.id) === source.id,
          ),
      ) ||
      !Array.isArray(doc.analyzed_htmls) ||
      doc.analyzed_htmls.length !== sources.length ||
      sources.some(
        (source) =>
          !doc.analyzed_htmls.some(
            (ref: { id?: string; path?: string; sha256?: string }) =>
              ref?.id === source.id &&
              ref.path === source.path &&
              ref.sha256 === source.sha256,
          ),
      )
    )
      throw new CanvasError(
        'GC-MD-003',
        `선택한 모든 HTML의 출처(analyzed_htmls)를 기록해주세요: ${relative}`,
      );
  }
}
