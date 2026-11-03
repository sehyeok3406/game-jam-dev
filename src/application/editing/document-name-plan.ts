import type { RenameDocumentInput } from '../../contracts/document-names.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import { documentNamePath } from '../../core/documents/file-name.ts';
import {
  remapProjectFiles,
  type LayoutMarkdownLinks,
} from '../projects/layout-migration.ts';
import { rememberFileName } from '../../core/documents/name-registry.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';

export function planDocumentName(
  files: Snapshot,
  input: RenameDocumentInput,
  codec: MarkdownCodec,
  links: LayoutMarkdownLinks,
) {
  if (
    !input ||
    typeof input.relativePath !== 'string' ||
    typeof input.objectId !== 'string'
  )
    throw Error('이름을 변경할 문서를 확인해주세요.');
  const raw = files[input.relativePath];
  if (raw === undefined)
    throw Error('문서가 이동되거나 삭제되었습니다. 입력한 이름은 유지됩니다.');
  const parsed = codec.parse(raw);
  const id =
    typeof parsed.data.id === 'string' ? parsed.data.id : input.relativePath;
  const title =
    typeof parsed.data.title === 'string'
      ? parsed.data.title
      : input.relativePath.split('/').at(-1)!.slice(0, -3);
  if (
    id !== input.objectId ||
    title !== input.expectedTitle ||
    parsed.content.trim() !== input.expectedBody
  )
    throw Error(
      '문서가 변경되었습니다. 최신 내용을 확인한 후 다시 시도해주세요.',
    );
  if (parsed.data.type === 'ai-task' || parsed.data.html_source)
    throw Error(
      '내부 작업·HTML 관리 문서의 이름은 이 화면에서 변경할 수 없습니다.',
    );
  const { name, to } = documentNamePath(
    input.relativePath,
    input.name,
    Object.keys(files),
  );
  const change = { objectId: id, from: input.relativePath, to, name };
  let next =
    to === input.relativePath
      ? { ...files }
      : remapProjectFiles(files, { [input.relativePath]: to }, codec, links);
  // Layout migration aliases are historical origins, not a rename forwarding table.
  const layout = readProjectLayout(files);
  if (layout) {
    const aliases = Object.fromEntries(
      Object.entries(layout.aliases).map(([from, target]) => [
        from,
        target === input.relativePath ? to : target,
      ]),
    );
    next[PROJECT_LAYOUT_PATH] =
      JSON.stringify(aliases) === JSON.stringify(layout.aliases)
        ? files[PROJECT_LAYOUT_PATH]
        : JSON.stringify({ ...layout, aliases });
    readProjectLayout(next);
  }
  const moved = codec.parse(next[to]);
  if (moved.data.title !== name || moved.data.id !== id)
    next[to] = codec.stringify(moved.content, {
      ...moved.data,
      id,
      title: name,
    });
  if (to !== input.relativePath)
    next = rememberFileName(next, id, 'markdown', input.relativePath, to, name);
  const changes = Object.fromEntries(
    Object.keys({ ...files, ...next })
      .filter((p) => files[p] !== next[p])
      .map((p) => [p, next[p] ?? null]),
  );
  return { before: files, files: next, changes, change };
}
