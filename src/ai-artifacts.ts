import matter from './markdown.ts';
import type { Snapshot } from './project-store';
import { isPreviewPath } from './preview-output.ts';
import { CanvasError } from './app-errors.ts';
import { inspectHtml } from './html-document.ts';

export function expectedArtifacts(task: string): string[] {
  const outputs = matter(task).data.expected_outputs;
  if (
    !Array.isArray(outputs) ||
    !outputs.length ||
    outputs.some(
      (value) =>
        typeof value !== 'string' ||
        (!/^docs\/[\p{L}\p{M}\p{N}_./-]+\.md$/u.test(value) &&
          !isPreviewPath(value)) ||
        value.split('/').includes('..'),
    )
  )
    throw new CanvasError(
      'GC-AI-004',
      '작업의 출력 파일 범위가 올바르지 않습니다.',
    );
  return [...new Set(outputs)] as string[];
}

export function validateArtifacts(
  before: Snapshot,
  after: Snapshot,
  outputs: string[],
) {
  if (!outputs.some((relative) => before[relative] !== after[relative]))
    throw new CanvasError(
      'GC-AI-006',
      '새 결과가 생성되거나 갱신되지 않았습니다. 기존 결과는 유지됩니다.',
    );
  const ids = new Set(
    Object.entries(before)
      .filter(([path]) => path.endsWith('.md'))
      .flatMap(([, raw]) => {
        const id = matter(raw).data.id;
        return typeof id === 'string' ? [id] : [];
      }),
  );
  const resultIds = new Set<string>();
  for (const relative of outputs) {
    const content = after[relative];
    if (!content?.trim())
      throw new CanvasError(
        'GC-AI-005',
        `출력 파일이 없거나 비어 있습니다: ${relative}`,
        { relativePath: relative },
      );
    if (relative.endsWith('.html')) {
      inspectHtml(content, relative);
      continue;
    }
    let parsed;
    try {
      parsed = matter(content);
    } catch (error) {
      throw new CanvasError(
        'GC-MD-001',
        `Markdown frontmatter를 읽을 수 없습니다: ${relative}`,
        {
          relativePath: relative,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const data = parsed.data;
    const previousId = before[relative]
      ? matter(before[relative]).data.id
      : undefined;
    if (previousId && data.id !== previousId)
      throw new CanvasError(
        'GC-MD-002',
        `갱신 문서의 기존 ID를 유지해주세요: ${relative}`,
        { relativePath: relative },
      );
    if (
      !parsed.content.trim() ||
      !['id', 'title', 'type', 'status'].every(
        (key) => typeof data[key] === 'string' && data[key].trim(),
      ) ||
      !['idea', 'system', 'overview', 'question'].includes(data.type) ||
      !Array.isArray(data.sources)
    )
      throw new CanvasError(
        'GC-MD-001',
        `Markdown 필수 정보(id, title, type, status, sources)를 확인해주세요: ${relative}`,
      );
    if (resultIds.has(data.id))
      throw new CanvasError(
        'GC-MD-002',
        `출력 문서 ID가 중복됩니다: ${data.id}`,
        { relativePath: relative },
      );
    resultIds.add(data.id);
    for (const source of data.sources) {
      const id = typeof source === 'string' ? source : source?.id;
      if (typeof id !== 'string' || !ids.has(id))
        throw new CanvasError(
          'GC-MD-003',
          `존재하지 않는 출처입니다: ${relative} → ${String(id)}`,
        );
    }
    if (!data.sources.length)
      throw new CanvasError(
        'GC-MD-003',
        `참고한 입력 문서를 sources에 기록해주세요: ${relative}`,
      );
    for (const [existingPath, raw] of Object.entries(before)) {
      if (
        !outputs.includes(existingPath) &&
        existingPath.endsWith('.md') &&
        matter(raw).data.id === data.id
      )
        throw new CanvasError(
          'GC-MD-002',
          `원본 문서와 출력 문서의 ID가 중복됩니다: ${relative}`,
        );
    }
  }
}
