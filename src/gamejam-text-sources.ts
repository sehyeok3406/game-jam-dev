import { createHash } from 'node:crypto';
import matter from './markdown.ts';
import { snapshotDrawings } from './drawing-model.ts';
import {
  isTextMaterial,
  parseTextMaterial,
  textMaterialMarkdown,
} from './canvas-text-materials.ts';
import type { Snapshot } from './contracts/project.ts';

export const TEXT_SOURCE_DIRECTORY = 'docs/text-sources/';
/** Resolve server-owned drawings and retain exactly the selected content per request. */
export function prepareTextSources(files: Snapshot, paths: string[]) {
  const references = [...new Set(paths.filter(isTextMaterial))];
  if (!references.length) return { paths, additions: {} as Snapshot };
  if (references.length > 100)
    throw Error('텍스트 자료는 한 번에 100개까지 선택해주세요.');
  const items = snapshotDrawings(files);
  const additions: Snapshot = {};
  const resolved = new Map<string, string>();
  for (const reference of references) {
    const key = parseTextMaterial(reference);
    const item = items.find(
      (item) =>
        item.canvasId === key.canvasId &&
        item.id === key.id &&
        item.generation === key.generation &&
        item.kind === 'text',
    );
    if (!item || item.kind !== 'text')
      throw Error(
        '선택한 텍스트가 삭제되거나 다른 캔버스로 이동했습니다. 자료를 다시 선택해주세요.',
      );
    const body = textMaterialMarkdown(item.geometry.document);
    if (!body)
      throw Error(
        '빈 텍스트는 재료로 사용할 수 없습니다. 내용을 입력하거나 자료에서 제외해주세요.',
      );
    const hash = createHash('sha256')
      .update(`${reference}\0${item.geometry.document}`)
      .digest('hex')
      .slice(0, 32);
    const relative = `${TEXT_SOURCE_DIRECTORY}${hash}.md`;
    const raw = matter.stringify(body + '\n', {
      id: `text-${hash}`,
      title: `텍스트 · ${body.replace(/\s+/g, ' ').slice(0, 60)}`,
      type: 'reference',
      status: 'snapshot',
      sources: [],
      canvas_id: item.canvasId,
      canvas_text_source: {
        version: 1,
        reference,
      },
    });
    if (files[relative] !== undefined) {
      const previous = matter(files[relative]);
      if (
        previous.content.trim() !== body ||
        previous.data.id !== `text-${hash}` ||
        previous.data.canvas_text_source?.version !== 1 ||
        previous.data.canvas_text_source?.reference !== reference
      )
        throw Error(
          '텍스트 자료 사본이 변경되었습니다. 원본을 복구한 뒤 다시 요청해주세요.',
        );
    }
    if (files[relative] === undefined) additions[relative] = raw;
    resolved.set(reference, relative);
  }
  return {
    paths: [...new Set(paths.map((path) => resolved.get(path) ?? path))],
    additions,
  };
}
