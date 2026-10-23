import path from 'node:path';
import matter from './markdown.ts';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import {
  snapshotDocuments,
  snapshotSections,
  collaborationPath,
} from './collaboration-model.ts';
import {
  applyDrawing,
  snapshotDrawings,
  validateDrawingObject,
} from './drawing-model.ts';
import { assertCanvas } from './canvas-sheets.ts';
import { isAssetPath, decodeAsset } from './file-assets.ts';
import { resolveAssetLink } from './asset-links.ts';
import { isPreviewPath, previewDeletionTarget } from './preview-output.ts';
import { htmlSourceId, htmlSourcePath, sourceMetadata } from './html-source.ts';
import { htmlReferences } from './html-references.ts';
import {
  extractDocumentLinks,
  parseDocumentLink,
  documentLinkMarkdown,
  escapeLinkLabel,
} from './document-links.ts';
import { DOCUMENT_STATUSES_PATH, readStatuses } from './document-statuses.ts';
import type { Snapshot } from './contracts/project.ts';
import type { CommandEnvironment } from './core/editing/environment.ts';
import type {
  ProjectCopyBundle,
  ProjectCopyImport,
  ProjectCopyResult,
  ProjectCopySelection,
} from './contracts/project-copy.ts';

const parser = unified().use(remarkParse);
const coordinate = (value: unknown, fallback = 120) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
type Node = {
  type: string;
  url?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
function markdownUrls(body: string) {
  const nodes: Node[] = [];
  const walk = (node: Node) => {
    if (node.url) nodes.push(node);
    node.children?.forEach(walk);
  };
  walk(parser.parse(body) as Node);
  return nodes;
}
function present(files: Snapshot, relative: string) {
  collaborationPath(relative);
  if (!Object.hasOwn(files, relative) || typeof files[relative] !== 'string')
    throw Error(`복사에 필요한 파일을 찾을 수 없습니다: ${relative}`);
  return files[relative];
}
function localReference(from: string, reference: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return null;
  const clean = reference.split(/[?#]/)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    throw Error(`잘못된 파일 참조: ${reference}`);
  }
  if (decoded.startsWith('/') || decoded.includes('\\'))
    throw Error(`프로젝트 밖 파일 참조: ${reference}`);
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), decoded),
  );
  collaborationPath(resolved);
  return resolved;
}

/** Collect only selected objects and their owned files; never a whole-project export. */
export function projectCopyBundle(
  files: Snapshot,
  selection: ProjectCopySelection,
): ProjectCopyBundle {
  if (
    !selection ||
    !Array.isArray(selection.documents) ||
    !Array.isArray(selection.sections) ||
    !Array.isArray(selection.previews) ||
    !Array.isArray(selection.drawings) ||
    selection.documents.length +
      selection.sections.length +
      selection.previews.length +
      selection.drawings.length >
      500
  )
    throw Error('복사할 선택 항목을 확인해주세요.');
  const documents = new Set<string>(),
    sections = new Set<string>(),
    previews = new Set<string>();
  const allDocuments = snapshotDocuments(files),
    allSections = snapshotSections(files);
  const addDocument = (member: { id: string; path: string }) => {
    const doc = allDocuments.find(
      (item) => item.relativePath === member.path && item.id === member.id,
    );
    if (!doc || doc.canvasId !== selection.canvasId)
      throw Error(`복사할 문서가 변경되었습니다: ${member.path}`);
    if (doc.htmlSource) previews.add(doc.htmlSource);
    else documents.add(doc.relativePath);
  };
  for (const member of selection.documents) addDocument(member);
  for (const member of selection.sections) {
    const section = allSections.find(
      (item) => item.id === member.id && item.relativePath === member.path,
    );
    if (!section || section.canvasId !== selection.canvasId)
      throw Error('복사할 섹션이 변경되었습니다.');
    sections.add(section.relativePath);
    section.members.forEach(addDocument);
  }
  for (const relative of selection.previews) {
    if (!isPreviewPath(relative))
      throw Error('복사할 HTML 경로를 확인해주세요.');
    const meta = files[htmlSourcePath(relative)]
      ? matter(files[htmlSourcePath(relative)]).data
      : {};
    if ((meta.canvas_id ?? 'default') !== selection.canvasId)
      throw Error('HTML의 캔버스가 변경되었습니다.');
    previews.add(relative);
  }
  const drawings = selection.drawings.map((target) => {
    const item = snapshotDrawings(files).find(
      (object) =>
        object.id === target.id &&
        object.generation === target.generation &&
        object.canvasId === selection.canvasId,
    );
    if (!item) throw Error('복사할 그림이 변경되었습니다.');
    const { canvasId: _canvasId, ...object } = item;
    return object;
  });
  const collected: Snapshot = {};
  const add = (relative: string) => {
    collected[relative] = present(files, relative);
  };
  for (const relative of [...documents, ...sections]) add(relative);
  for (const relative of previews) {
    add(relative);
    const source = htmlSourcePath(relative);
    collected[source] =
      files[source] ?? sourceMetadata(relative, files[relative]);
    const window = selection.previewWindows?.[relative];
    if (window) {
      if (
        ![window.x, window.y, window.width, window.height].every(
          (value) =>
            typeof value === 'number' &&
            Number.isFinite(value) &&
            Math.abs(value) <= 1e6,
        ) ||
        window.width <= 0 ||
        window.height <= 0 ||
        typeof window.collapsed !== 'boolean'
      )
        throw Error('복사할 HTML 창 배치를 확인해주세요.');
      const parsed = matter(collected[source]);
      collected[source] = matter.stringify(parsed.content, {
        ...parsed.data,
        ...window,
      });
    }
    const owned = previewDeletionTarget(relative);
    if (owned !== relative)
      for (const key of Object.keys(files))
        if (key.startsWith(`${owned}/`) && isAssetPath(key)) add(key);
    // Validate static HTML/CSS/JS dependencies, including nested support files.
    for (const [key, raw] of Object.entries(collected).filter(
      ([key]) =>
        key === relative || (owned !== relative && key.startsWith(`${owned}/`)),
    )) {
      const extension = key.split('.').at(-1);
      if (!['html', 'css', 'js'].includes(extension ?? '')) continue;
      const text = isAssetPath(key)
        ? decodeAsset(key, raw).toString('utf8')
        : raw;
      for (const ref of htmlReferences(
        text,
        extension === 'css' ? 'css' : extension === 'js' ? 'js' : 'html',
      )) {
        const resolved = localReference(key, ref);
        if (!resolved) continue;
        if (
          resolved !== relative &&
          !(owned !== relative && resolved.startsWith(`${owned}/`))
        )
          throw Error(
            `HTML 결과 폴더 밖의 파일 참조는 먼저 결과 폴더 안으로 정리해주세요: ${ref}`,
          );
        add(resolved);
      }
    }
  }
  for (const relative of documents) {
    const { data, content } = matter(files[relative]);
    if (data.asset?.path) add(data.asset.path);
    for (const node of markdownUrls(content)) {
      const asset = resolveAssetLink(node.url, relative);
      if (asset) add(asset);
      else if (
        node.type === 'image' &&
        node.url &&
        !/^(?:https?:|data:|#)/i.test(node.url)
      )
        throw Error(`지원하지 않는 본문 이미지 경로입니다: ${node.url}`);
    }
  }
  if (!documents.size && !sections.size && !previews.size && !drawings.length)
    throw Error('복사할 자료를 선택해주세요.');
  return {
    version: 1,
    files: collected,
    documents: [...documents],
    sections: [...sections],
    previews: [...previews],
    drawings,
    statusNames: Object.fromEntries(
      readStatuses(files[DOCUMENT_STATUSES_PATH]).statuses.map((status) => [
        status.id,
        status.name,
      ]),
    ),
  };
}

/** Both native and authenticated server commands use this same additive import plan. */
export function importProjectCopy(
  files: Snapshot,
  input: ProjectCopyImport,
  environment: CommandEnvironment,
): { files: Snapshot; result: ProjectCopyResult } {
  if (
    !input ||
    !/^[a-f0-9-]{36}$/i.test(input.requestId ?? '') ||
    input.bundle?.version !== 1
  )
    throw Error('프로젝트 복사 요청을 확인해주세요.');
  const canvasId = assertCanvas(files, input.canvasId),
    bundle = input.bundle;
  if (
    !bundle.files ||
    typeof bundle.files !== 'object' ||
    Array.isArray(bundle.files) ||
    Object.keys(bundle.files).length > 500 ||
    ![
      bundle.documents,
      bundle.sections,
      bundle.previews,
      bundle.drawings,
    ].every(Array.isArray) ||
    bundle.drawings.length > 500
  )
    throw Error('프로젝트 복사 자료를 확인해주세요.');
  const lists = [bundle.documents, bundle.sections, bundle.previews];
  if (
    lists.reduce((sum, list) => sum + list.length, bundle.drawings.length) >
      500 ||
    lists.some((list) => new Set(list).size !== list.length)
  )
    throw Error('복사 항목 수나 중복 선택을 확인해주세요.');
  // Rebuild the bundle on the server: unlisted files/settings cannot be smuggled in.
  const normalized: Snapshot = {};
  for (const [relative, raw] of Object.entries(bundle.files)) {
    collaborationPath(relative);
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8_000_000)
      throw Error('복사 파일 크기나 형식을 확인해주세요.');
    if (isAssetPath(relative)) decodeAsset(relative, raw);
    normalized[relative] = raw;
  }
  if (
    Object.values(normalized).reduce(
      (sum, raw) => sum + Buffer.byteLength(raw),
      0,
    ) > 20_000_000
  )
    throw Error('복사 자료는 한 번에 20MB까지 지원합니다.');
  const paths = new Map<string, string>(),
    ids = new Map<string, string>(),
    warnings = new Set<string>();
  const next = { ...files },
    used = new Set(Object.keys(files).map((key) => key.toLowerCase()));
  const allocate = (old: string, relative: string) => {
    collaborationPath(relative);
    if (used.has(relative.toLowerCase()))
      throw Error('복사 경로가 중복되었습니다. 다시 시도해주세요.');
    used.add(relative.toLowerCase());
    paths.set(old, relative);
    return relative;
  };
  const stamp = environment.id();
  for (const relative of bundle.documents) {
    const parsed = matter(present(normalized, relative));
    if (
      relative.startsWith('sections/') ||
      relative.startsWith('docs/html-sources/') ||
      !relative.endsWith('.md')
    )
      throw Error('복사 문서 형식을 확인해주세요.');
    const id = environment.id();
    ids.set(String(parsed.data.id ?? relative), id);
    allocate(relative, `docs/copy-${stamp}/${id}.md`);
  }
  for (const relative of bundle.sections) {
    const parsed = matter(present(normalized, relative));
    if (
      !relative.startsWith('sections/') ||
      !relative.endsWith('.md') ||
      !Array.isArray(parsed.data.members)
    )
      throw Error('복사 섹션을 확인해주세요.');
    const id = environment.id();
    ids.set(String(parsed.data.id ?? relative), id);
    allocate(relative, `sections/copy-${id}.md`);
  }
  for (const relative of bundle.previews) {
    if (!isPreviewPath(relative))
      throw Error('복사할 HTML 경로를 확인해주세요.');
    present(normalized, relative);
    const id = environment.id();
    const destination = allocate(
      relative,
      `output/inbox/copy-${id}/v001/index.html`,
    );
    allocate(htmlSourcePath(relative), htmlSourcePath(destination));
    ids.set(htmlSourceId(relative), htmlSourceId(destination));
    const owned = previewDeletionTarget(relative);
    if (owned !== relative)
      for (const key of Object.keys(normalized))
        if (key.startsWith(`${owned}/`) && isAssetPath(key))
          allocate(
            key,
            `${previewDeletionTarget(destination)}${key.slice(owned.length)}`,
          );
  }
  for (const [relative] of Object.entries(normalized))
    if (isAssetPath(relative) && !paths.has(relative)) {
      if (!relative.startsWith('assets/images/'))
        throw Error('선택한 HTML에 속하지 않는 관련 파일입니다.');
      allocate(
        relative,
        `assets/images/${environment.id()}.${relative.split('.').at(-1)}`,
      );
    }
  const allowedFiles = new Set(paths.keys());
  if (Object.keys(normalized).some((key) => !allowedFiles.has(key)))
    throw Error('선택 자료 외의 파일은 복사할 수 없습니다.');
  const rawDocuments = [
    ...bundle.documents,
    ...bundle.sections,
    ...bundle.previews.map(htmlSourcePath),
  ];
  const bounds = rawDocuments.map(
    (key) => matter(present(normalized, key)).data,
  );
  const sourceX = Math.min(
    ...bounds.map((data) => coordinate(data.x)),
    ...bundle.drawings.map((o) => o.transform.x),
  );
  const sourceY = Math.min(
    ...bounds.map((data) => coordinate(data.y)),
    ...bundle.drawings.map((o) => o.transform.y),
  );
  const occupied = [
    ...snapshotDocuments(files),
    ...snapshotSections(files),
  ].filter((doc) => doc.canvasId === canvasId);
  const dx = 120 - sourceX;
  const dy =
    Math.max(
      120,
      ...occupied.map((doc) => doc.y + doc.height + 100),
      ...snapshotDrawings(files)
        .filter((object) => object.canvasId === canvasId)
        .map((object) => object.transform.y + object.transform.height + 100),
    ) - sourceY;
  const targetStatuses = readStatuses(files[DOCUMENT_STATUSES_PATH]);
  const statuses = targetStatuses.statuses;
  const remapBody = (body: string, from: string, to: string) => {
    const edits: { from: number; to: number; text: string }[] = [];
    for (const link of extractDocumentLinks(body)) {
      const target = parseDocumentLink(link.href)!;
      const mapped = (target.kind === 'file' ? paths : ids).get(target.value);
      edits.push({
        from: link.from,
        to: link.to,
        text: mapped
          ? documentLinkMarkdown(
              `gamejam://${target.kind}/${encodeURIComponent(mapped)}`,
              link.label,
              link.automatic,
            )
          : `${escapeLinkLabel(link.label)} (원본 참조: ${escapeLinkLabel(target.value)})`,
      });
      if (!mapped)
        warnings.add(
          '선택하지 않은 문서의 링크는 원본 출처 텍스트로 보존했습니다.',
        );
    }
    for (const node of markdownUrls(body)) {
      if (!node.url || node.url.startsWith('gamejam:')) continue;
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      const asset = resolveAssetLink(node.url, from);
      if (asset && paths.has(asset)) {
        const replacement = path.posix.relative(
          path.posix.dirname(to),
          paths.get(asset)!,
        );
        edits.push({
          from: start,
          to: end,
          text: body.slice(start, end).replace(node.url, replacement),
        });
      } else if (
        /\.md(?:#.*)?$/i.test(node.url) &&
        !/^[a-z]+:/i.test(node.url)
      ) {
        const referenced = localReference(from, node.url),
          mapped = referenced && paths.get(referenced);
        const raw = body.slice(start, end);
        edits.push({
          from: start,
          to: end,
          text: mapped
            ? raw.replace(
                node.url,
                path.posix.relative(path.posix.dirname(to), mapped) +
                  (node.url.includes('#') ? `#${node.url.split('#')[1]}` : ''),
              )
            : `${raw.replace(/!?\[([^\]]*)\]\([^)]*\)/, '$1')} (원본 참조: ${escapeLinkLabel(node.url)})`,
        });
        if (!mapped)
          warnings.add(
            '선택하지 않은 문서의 링크는 원본 출처 텍스트로 보존했습니다.',
          );
      }
    }
    for (const edit of edits.sort((a, b) => b.from - a.from))
      body = body.slice(0, edit.from) + edit.text + body.slice(edit.to);
    return body;
  };
  for (const [from, to] of paths) {
    const raw = present(normalized, from);
    if (!from.endsWith('.md')) {
      next[to] = raw;
      continue;
    }
    const { data, content } = matter(raw);
    const metadata = { ...data };
    // Project-local execution/group identities must never point at a target's existing objects.
    for (const key of [
      'document_bundle_id',
      'system_id',
      'document_output',
      'game_ui_frame',
      'game_ui_rows',
      'canvas_placement_id',
      'execution',
      'run_id',
      'task_id',
      'request_id',
    ])
      delete metadata[key];
    metadata.id = ids.get(String(data.id ?? from)) ?? environment.id();
    metadata.canvas_id = canvasId;
    metadata.x = coordinate(data.x) + dx;
    metadata.y = coordinate(data.y) + dy;
    metadata.updated_at = environment.now();
    if (metadata.type === 'ai-task') {
      metadata.type = 'reference';
      metadata.status = 'draft';
    }
    if (data.html_source) {
      metadata.html_source = paths.get(data.html_source);
      metadata.id = htmlSourceId(metadata.html_source);
    }
    if (data.asset)
      metadata.asset = { ...data.asset, path: paths.get(data.asset.path) };
    if (data.members)
      metadata.members = data.members.map(
        (member: { id: string; path: string }) => {
          const id = ids.get(member.id),
            target = paths.get(member.path);
          if (!id || !target) throw Error('섹션 멤버 자료가 누락되었습니다.');
          return { id, path: target };
        },
      );
    if (Array.isArray(data.sources))
      metadata.sources = data.sources.flatMap(
        (source: string | { id: string; path?: string }) => {
          const value = typeof source === 'string' ? { id: source } : source;
          const id = ids.get(value.id);
          if (!id) {
            warnings.add(
              '선택 밖 출처 연결은 본문의 원본 출처 안내로 보존했습니다.',
            );
            return [];
          }
          return [
            {
              ...value,
              id,
              ...(value.path ? { path: paths.get(value.path) } : {}),
            },
          ];
        },
      );
    if (data.workflow_status_id) {
      const status = statuses.find(
        (status) =>
          status.name === bundle.statusNames?.[data.workflow_status_id],
      );
      metadata.workflow_status_id =
        status?.id ?? targetStatuses.defaultStatusId;
      if (!status)
        warnings.add('대상에 없는 진행 상태는 기본 상태로 지정했습니다.');
    }
    const missingSources = Array.isArray(data.sources)
      ? data.sources.filter(
          (source: string | { id: string }) =>
            !ids.has(typeof source === 'string' ? source : source.id),
        )
      : [];
    next[to] = matter.stringify(
      remapBody(content, from, to) +
        (missingSources.length
          ? `\n\n원본 출처: ${missingSources.map((source: string | { id: string; path?: string }) => (typeof source === 'string' ? source : (source.path ?? source.id))).join(', ')}\n`
          : ''),
      metadata,
    );
  }
  const drawings = bundle.drawings.map((object) => {
    validateDrawingObject(object);
    return {
      ...object,
      id: environment.id(),
      generation: environment.id(),
      createdAt: environment.now(),
      updatedAt: environment.now(),
      transform: {
        ...object.transform,
        x: object.transform.x + dx,
        y: object.transform.y + dy,
      },
    };
  });
  const resultFiles = drawings.length
    ? applyDrawing(next, { canvasId, action: 'create', objects: drawings })
    : next;
  const count =
    bundle.documents.length +
    bundle.sections.length +
    bundle.previews.length +
    drawings.length;
  if (!count) throw Error('복사할 자료가 없습니다.');
  return {
    files: resultFiles,
    result: {
      count,
      paths: [...paths.values()].filter((key) => !isAssetPath(key)),
      drawingIds: drawings.map((o) => o.id),
      warnings: [...warnings],
    },
  };
}
