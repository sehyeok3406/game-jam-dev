import type { Snapshot } from '../../contracts/project.ts';
import type { RenamePreviewInput } from '../../contracts/document-names.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import type { PreviewNameCodec } from '../ports/preview-names.ts';
import { documentName, fileNameKey } from '../../core/documents/file-name.ts';
import { rememberFileName } from '../../core/documents/name-registry.ts';
import {
  remapProjectFiles,
  type LayoutMarkdownLinks,
} from '../projects/layout-migration.ts';

export function planPreviewName(
  files: Snapshot,
  input: RenamePreviewInput,
  codec: MarkdownCodec,
  links: LayoutMarkdownLinks,
  html: PreviewNameCodec,
) {
  if (
    !input ||
    typeof input.relativePath !== 'string' ||
    !html.paths(files).includes(input.relativePath)
  )
    throw Error('이름을 변경할 HTML 결과를 찾을 수 없습니다.');
  const preview = html.describe(files, input.relativePath);
  if (
    preview.sourceId !== input.objectId ||
    html.hash(preview.content) !== input.expectedHash
  )
    throw Error('HTML 결과가 변경되었습니다. 최신 내용을 확인해주세요.');
  const name = documentName(input.name);
  const from = input.relativePath,
    to = from.slice(0, from.lastIndexOf('/') + 1) + name + '.html';
  if (from === to && preview.title === name)
    return {
      before: files,
      files,
      changes: {},
      change: { objectId: preview.sourceId!, from, to, name },
    };
  if (
    to.length > 240 ||
    Object.keys(files).some(
      (p) => p !== from && fileNameKey(p) === fileNameKey(to),
    )
  )
    throw Error('같은 이름의 파일이 있거나 경로가 너무 깁니다.');
  const aliases =
    from === to
      ? {}
      : { [from]: to, [html.controlPath(from)]: html.controlPath(to) };
  let next = remapProjectFiles(files, aliases, codec, links);
  next = html.rewrite(next, { [from]: to });
  const control = html.controlPath(to),
    parsed = codec.parse(next[control] ?? '');
  next[control] = codec.stringify(parsed.content || '# HTML 원본 관리\n', {
    ...parsed.data,
    id: preview.sourceId,
    title: name,
    type: 'reference',
    html_source: to,
  });
  next = rememberFileName(next, preview.sourceId!, 'html', from, to, name);
  const changes = Object.fromEntries(
    Object.keys({ ...files, ...next })
      .filter((p) => files[p] !== next[p])
      .map((p) => [p, next[p] ?? null]),
  );
  return {
    before: files,
    files: next,
    changes,
    change: { objectId: preview.sourceId!, from, to, name },
  };
}
