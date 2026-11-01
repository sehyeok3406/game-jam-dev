import type { Snapshot } from '../../contracts/project.ts';
import type {
  FileNamePlan,
  ApplyFileNamesInput,
  FileNameProposal,
} from '../../contracts/document-names.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import type { PreviewNameCodec } from '../ports/preview-names.ts';
import {
  availableDocumentName,
  documentName,
} from '../../core/documents/file-name.ts';
import { planDocumentName } from './document-name-plan.ts';
import { planPreviewName } from './preview-name-plan.ts';
import type { LayoutMarkdownLinks } from '../projects/layout-migration.ts';

const baseline = (files: Snapshot, html: PreviewNameCodec) =>
  html.hash(
    JSON.stringify(
      Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
export function inspectFileNames(
  files: Snapshot,
  scope: string,
  codec: MarkdownCodec,
  html: PreviewNameCodec,
  links: LayoutMarkdownLinks,
): FileNamePlan {
  const proposals: FileNameProposal[] = [];
  const reserved = new Set(Object.keys(files));
  let needsLayoutUpgrade = false;
  for (const [from, raw] of Object.entries(files).filter(
    ([p]) =>
      /^(?:project\.md|(?:docs|ideas)\/.+\.md)$/.test(p) &&
      !/^docs\/(?:html-sources|text-sources)\//.test(p),
  )) {
    const data = codec.parse(raw).data;
    if (data.type === 'ai-task') continue;
    const desired = String(data.title ?? from.split('/').at(-1)!.slice(0, -3));
    if (desired === from.split('/').at(-1)!.slice(0, -3)) continue;
    let name = desired,
      error: string | undefined;
    if (from === 'project.md') {
      needsLayoutUpgrade = true;
      error = '프로젝트 파일 구조 정리 후 이름을 통일할 수 있습니다.';
    }
    try {
      name = availableDocumentName(
        desired,
        from.slice(0, from.lastIndexOf('/')),
        [...reserved].filter((p) => p !== from),
      );
    } catch (e) {
      error = String((e as Error).message);
    }
    const to = from.slice(0, from.lastIndexOf('/') + 1) + name + '.md';
    reserved.add(to);
    proposals.push({
      id: String(data.id ?? from),
      kind: 'markdown',
      currentName: desired,
      from,
      to,
      name,
      ...(error ? { error } : {}),
    });
  }
  for (const from of html.paths(files)) {
    const preview = html.describe(files, from),
      desired = preview.title?.trim() || from.split('/').at(-1)!.slice(0, -5);
    if (desired === from.split('/').at(-1)!.slice(0, -5)) continue;
    let name = desired,
      error: string | undefined;
    try {
      name = availableDocumentName(
        desired,
        from.slice(0, from.lastIndexOf('/')),
        [...reserved].filter((p) => p !== from),
        '.html',
      );
    } catch (e) {
      error = String((e as Error).message);
    }
    const to = from.slice(0, from.lastIndexOf('/') + 1) + name + '.html';
    reserved.add(to);
    proposals.push({
      id: preview.sourceId!,
      kind: 'html',
      currentName: desired,
      from,
      to,
      name,
      ...(error ? { error } : {}),
    });
  }
  const affected = new Set<string>();
  for (const p of proposals.filter((p) => !p.error)) {
    try {
      const change =
        p.kind === 'markdown'
          ? planDocumentName(
              files,
              {
                scope,
                objectId: p.id,
                relativePath: p.from,
                expectedTitle: String(
                  codec.parse(files[p.from]).data.title ??
                    p.from.split('/').at(-1)!.slice(0, -3),
                ),
                expectedBody: codec.parse(files[p.from]).content.trim(),
                name: p.name,
              },
              codec,
              links,
            )
          : planPreviewName(
              files,
              {
                scope,
                objectId: p.id,
                relativePath: p.from,
                expectedHash: html.hash(files[p.from]),
                name: p.name,
              },
              codec,
              links,
              html,
            );
      for (const path of Object.keys(change.changes)) affected.add(path);
    } catch (e) {
      p.error = (e as Error).message;
    }
  }
  return {
    scope,
    baseline: baseline(files, html),
    proposals,
    affectedPaths: [...affected],
    needsLayoutUpgrade,
  };
}
export function applyFileNamePlan(
  files: Snapshot,
  input: ApplyFileNamesInput,
  codec: MarkdownCodec,
  links: LayoutMarkdownLinks,
  html: PreviewNameCodec,
) {
  if (
    !input ||
    input.baseline !== baseline(files, html) ||
    !Array.isArray(input.proposals) ||
    input.proposals.length > 500
  )
    throw Error('파일이 변경되었습니다. 이름 통일 목록을 다시 확인해주세요.');
  let next = { ...files };
  const ids = new Set<string>();
  for (const p of input.proposals) {
    if (!p || ids.has(p.id))
      throw Error('이름 통일 목록의 대상이 중복되었습니다.');
    ids.add(p.id);
    documentName(p.name);
    if (p.kind === 'markdown') {
      const data = codec.parse(next[p.from] ?? '');
      next = planDocumentName(
        next,
        {
          scope: input.scope,
          relativePath: p.from,
          objectId: p.id,
          expectedTitle: String(
            data.data.title ?? p.from.split('/').at(-1)!.slice(0, -3),
          ),
          expectedBody: data.content.trim(),
          name: p.name,
        },
        codec,
        links,
      ).files;
    } else if (p.kind === 'html')
      next = planPreviewName(
        next,
        {
          scope: input.scope,
          relativePath: p.from,
          objectId: p.id,
          expectedHash: html.hash(next[p.from] ?? ''),
          name: p.name,
        },
        codec,
        links,
        html,
      ).files;
    else throw Error('이름 통일 대상의 형식이 올바르지 않습니다.');
  }
  const changes = Object.fromEntries(
    Object.keys({ ...files, ...next })
      .filter((p) => files[p] !== next[p])
      .map((p) => [p, next[p] ?? null]),
  );
  return {
    before: files,
    files: next,
    changes,
    affectedPaths: Object.keys(changes),
  };
}
