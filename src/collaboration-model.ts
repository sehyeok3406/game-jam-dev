import {
  CANVAS_SHEETS_PATH,
  canvasId,
  assertCanvas,
  readCanvasSheets,
} from './canvas-sheets.ts';
import {
  validateCanvasMembership,
  changeCanvasSheets,
} from './canvas-sheet-commands.ts';
import type { CanvasSheetCommand } from './shared.ts';
import { randomUUID } from 'node:crypto';
import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { createTaskFiles } from './task-plan.ts';
import { documentBounds, layoutNewDocuments } from './new-document-layout.ts';
import { verticalLayouts } from './canvas-placement.ts';
import {
  isAssetPath,
  decodeAsset,
  imageAsset,
  buildFileImports,
} from './file-assets.ts';
import type {
  CanvasDocument,
  CanvasSection,
  SourceReference,
  ImportBatchInput,
  CreateTaskInput,
} from './shared.ts';
import { isPreviewPath, previewDeletionTarget } from './preview-output.ts';
import type { Snapshot } from './project-store.ts';
import { htmlSourceId, htmlSourcePath, sourceMetadata } from './html-source.ts';
import { cardColor, CARD_COLORS } from './card-colors.ts';
import {
  relocateResults,
  legacyResultMoves,
  moveDestination,
  RESULT_CATALOG_PATH,
  readResultCatalog,
  type MoveResultInput,
} from './result-structure.ts';

export function collaborationPath(relative: unknown): string {
  if (
    typeof relative !== 'string' ||
    relative.length > 240 ||
    relative.includes('..') ||
    relative.includes('\\') ||
    !(
      /^(?:project\.md|(?:ideas|docs|sections|\.ai\/tasks)\/.+\.md)$/.test(
        relative,
      ) ||
      isPreviewPath(relative) ||
      relative === 'output/README.md' ||
      relative === RESULT_CATALOG_PATH ||
      relative === CANVAS_SHEETS_PATH ||
      isAssetPath(relative)
    ) ||
    relative
      .split('/')
      .some(
        (segment) =>
          !segment ||
          /[<>:"|?*]/.test(segment) ||
          [...segment].some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(segment) ||
          (segment.startsWith('.') &&
            segment !== '.ai' &&
            !(
              [RESULT_CATALOG_PATH, CANVAS_SHEETS_PATH].includes(relative) &&
              segment === '.canvas'
            )) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
      )
  )
    throw new Error('공유 프로젝트의 문서 경로가 올바르지 않습니다.');
  return relative;
}

export function checkSnapshot(files: unknown): asserts files is Snapshot {
  if (!files || typeof files !== 'object' || Array.isArray(files))
    throw new Error('문서 목록이 올바르지 않습니다.');
  validateCanvasMembership(files as Snapshot);
  const entries = Object.entries(files);
  if (entries.length > 500)
    throw new Error('최대 500개 파일을 공유할 수 있습니다.');
  let bytes = 0;
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [key, value] of entries) {
    collaborationPath(key);
    const canonicalPath = key.toLowerCase();
    if (paths.has(canonicalPath))
      throw new Error(`대소문자만 다른 파일 경로는 공유할 수 없습니다: ${key}`);
    paths.add(canonicalPath);
    if (
      typeof value !== 'string' ||
      Buffer.byteLength(value) >
        (isAssetPath(key)
          ? 6_666_800
          : isPreviewPath(key)
            ? 8_000_000
            : 2_000_000)
    )
      throw new Error(
        'Markdown은 2MB, HTML은 8MB, 원본 이미지는 5MB까지 공유할 수 있습니다.',
      );
    bytes += Buffer.byteLength(value);
    if (key === CANVAS_SHEETS_PATH) {
      readCanvasSheets(value);
      continue;
    }
    if (key === RESULT_CATALOG_PATH) {
      readResultCatalog(value);
      continue;
    }
    if (isAssetPath(key)) {
      decodeAsset(key, value);
      continue;
    }
    const first = value.split(/\r?\n/, 1)[0];
    if (
      first.startsWith('---') &&
      !['---', '---yaml', '---yml'].includes(first.trim())
    )
      throw new Error('문서는 YAML frontmatter만 사용할 수 있습니다.');
    if (key.endsWith('.md')) {
      const parsed = matter(value),
        id = parsed.data.id ?? key;
      if (
        key.startsWith('docs/html-sources/') &&
        (!isPreviewPath(parsed.data.html_source) ||
          key !== htmlSourcePath(parsed.data.html_source) ||
          id !== htmlSourceId(parsed.data.html_source) ||
          typeof (files as Snapshot)[parsed.data.html_source] !== 'string')
      )
        throw new CanvasError(
          'GC-AI-007',
          'HTML 관리 문서와 연결된 원본 파일을 확인해주세요.',
        );
      if (typeof id !== 'string' || ids.has(id))
        throw new Error(`문서 ID가 중복되거나 올바르지 않습니다: ${key}`);
      ids.add(id);
    }
  }
  if (bytes > 20_000_000)
    throw new Error('초기 협업 프로젝트는 총 20MB까지 공유할 수 있습니다.');
  const documents = new Map(
    snapshotDocuments(files as Snapshot).map((doc) => [doc.relativePath, doc]),
  );
  const memberships = new Set<string>();
  for (const document of documents.values()) {
    if (
      document.type === 'image' &&
      (!document.asset || !(files as Snapshot)[document.asset.path])
    )
      throw new Error(
        `이미지 카드에 연결된 원본 이미지를 찾을 수 없습니다: ${document.relativePath}`,
      );
  }
  for (const section of snapshotSections(files as Snapshot))
    for (const member of section.members) {
      const doc = documents.get(member?.path);
      if (!doc || doc.id !== member.id || memberships.has(member.path))
        throw new Error(`섹션 소속을 확인해주세요: ${section.relativePath}`);
      memberships.add(member.path);
    }
}

export function snapshotDocuments(files: Snapshot): CanvasDocument[] {
  return Object.entries(files)
    .filter(
      ([key]) =>
        key.endsWith('.md') &&
        !key.startsWith('sections/') &&
        !key.startsWith('output/'),
    )
    .map(([relativePath, raw]) => {
      const { data, content } = matter(raw);
      const number = (key: string, fallback: number) =>
        Number.isFinite(data[key]) ? (data[key] as number) : fallback;
      return {
        canvasId: canvasId(data.canvas_id),
        id: typeof data.id === 'string' ? data.id : relativePath,
        title: typeof data.title === 'string' ? data.title : relativePath,
        type: [
          'idea',
          'system',
          'overview',
          'question',
          'ai-task',
          'reference',
          'image',
        ].includes(data.type)
          ? data.type
          : 'idea',
        status: typeof data.status === 'string' ? data.status : 'draft',
        relativePath,
        body: content.trim(),
        x: number('x', 120),
        y: number('y', 120),
        width: number('width', 340),
        height: number('height', 300),
        collapsed: data.collapsed === true,
        backgroundColor: cardColor(data.background_color),
        sources: Array.isArray(data.sources)
          ? data.sources.flatMap((source: unknown) =>
              typeof source === 'string'
                ? [{ id: source }]
                : source &&
                    typeof source === 'object' &&
                    typeof (source as { id: unknown }).id === 'string'
                  ? [source as SourceReference]
                  : [],
            )
          : [],
        asset: imageAsset(data.asset),
        htmlSource:
          typeof data.html_source === 'string' &&
          isPreviewPath(data.html_source)
            ? data.html_source
            : undefined,
        modifiedAt: number('updated_at', 0),
      };
    });
}

export function snapshotSections(files: Snapshot): CanvasSection[] {
  return Object.entries(files)
    .filter(([key]) => key.startsWith('sections/'))
    .map(([relativePath, raw]) => {
      const { data } = matter(raw);
      return {
        canvasId: canvasId(data.canvas_id),
        id: data.id ?? relativePath,
        title: typeof data.title === 'string' ? data.title : '섹션',
        relativePath,
        x: data.x ?? 80,
        y: data.y ?? 80,
        width: Math.max(data.width ?? 860, 420),
        height: Math.max(data.height ?? 620, 280),
        members: Array.isArray(data.members) ? data.members : [],
        modifiedAt: data.updated_at ?? 0,
      };
    });
}

export const commandLabels: Record<string, string> = {
  'canvases:change': '캔버스 구성 변경',
  'results:move': 'HTML 결과물 폴더 이동',
  'results:organize': '기존 HTML 결과물 폴더 정리',
  'documents:set-color': '카드 배경색 변경',
  'files:import-batch': '파일 불러오기',
  'documents:delete-many': '선택 문서 삭제',
  'documents:create-idea': '메모 추가',
  'documents:save': '문서 수정',
  'documents:delete': '문서 삭제',
  'documents:duplicate': '문서 복사',
  'sections:create': '섹션 생성',
  'sections:rename': '섹션 이름 변경',
  'sections:delete': '섹션 해제·삭제',
  'sections:move-document': '섹션 소속 변경',
  'documents:update-layout': '문서 배치 변경',
  'sections:update-layout': '섹션 배치 변경',
  'layouts:update': '여러 항목 배치 변경',
  'tasks:create': 'AI 작업 요청',
};

type Input = Record<string, unknown>;
function record(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('작업 정보가 올바르지 않습니다.');
  return value as Input;
}
function text(value: unknown, max = 100_000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('텍스트가 올바르지 않습니다.');
  return value;
}
function number(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1_000_000
  )
    throw new Error('캔버스 좌표/크기가 올바르지 않습니다.');
  return Math.round(value);
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error('항목 목록이 올바르지 않습니다.');
  return value;
}

/** Pure reducer: never writes files; the server publishes the whole result atomically. */
export function reduceCollaboration(
  files: Snapshot,
  channel: string,
  value: unknown,
): { files: Snapshot; result: unknown } {
  if (!commandLabels[channel])
    throw new Error('허용되지 않은 공동 작업입니다.');
  const next = { ...files };
  const input = record(value);
  if (channel === 'canvases:change') {
    const changed = changeCanvasSheets(
      files,
      input as unknown as CanvasSheetCommand,
    );
    checkSnapshot(changed);
    return { files: changed, result: undefined };
  }
  if (
    [
      'files:import-batch',
      'documents:create-idea',
      'sections:create',
      'tasks:create',
    ].includes(channel)
  )
    assertCanvas(files, input.canvasId);
  if (channel === 'results:move' || channel === 'results:organize') {
    const moves =
      channel === 'results:organize'
        ? legacyResultMoves(files)
        : [
            {
              from: input.relativePath as string,
              to: moveDestination(files, input as MoveResultInput),
            },
          ];
    const relocated = relocateResults(files, moves);
    checkSnapshot(relocated);
    return { files: relocated, result: moves };
  }
  if (channel === 'files:import-batch') {
    const additions = layoutNewDocuments(
      files,
      buildFileImports(input as ImportBatchInput),
      {
        x: Number(input.x),
        y: Number(input.y),
        canvasId: canvasId(input.canvasId),
      },
      true,
    );
    if (Object.keys(additions).some((relative) => next[relative] !== undefined))
      throw new CanvasError(
        'GC-IMPORT-001',
        '이미 존재하는 파일을 덮어쓸 수 없습니다.',
      );
    Object.assign(next, additions);
    checkSnapshot(next);
    return { files: next, result: snapshotDocuments(additions) };
  }
  if (channel === 'documents:delete-many') {
    const documents = array(input.documents);
    if (!documents.length) throw new Error('삭제할 문서를 선택해주세요.');
    let current = next;
    for (const document of documents)
      current = reduceCollaboration(
        current,
        'documents:delete',
        document,
      ).files;
    return { files: current, result: undefined };
  }
  const read = (key: unknown) => {
    const relative = collaborationPath(key);
    if (!relative.endsWith('.md') || next[relative] === undefined)
      throw new Error('문서를 찾을 수 없습니다.');
    return { relative, ...matter(next[relative]) };
  };
  const write = (relative: string, data: Input, content: string) => {
    next[relative] = matter.stringify(content, {
      ...data,
      updated_at: Date.now(),
    });
  };
  const layout = (entry: Input) => {
    const parsed = read(entry.relativePath);
    const x = number(entry.position === false ? parsed.data.x : entry.x),
      y = number(entry.position === false ? parsed.data.y : entry.y);
    const width = number(
        entry.size === false ? parsed.data.width : entry.width,
      ),
      height = number(entry.size === false ? parsed.data.height : entry.height);
    if (width < 120 || height < 38) throw new Error('창 크기가 너무 작습니다.');
    if (entry.kind === 'section' && entry.moveMembers !== false) {
      for (const member of parsed.data.members ?? []) {
        const child = read(member.path);
        write(
          child.relative,
          {
            ...child.data,
            x: number(child.data.x ?? 120) + x - number(parsed.data.x ?? 80),
            y: number(child.data.y ?? 120) + y - number(parsed.data.y ?? 80),
          },
          child.content,
        );
      }
    }
    write(
      parsed.relative,
      { ...parsed.data, x, y, width, height },
      parsed.content,
    );
  };
  const removeMembers = (paths: Set<string>, target?: string) => {
    for (const section of snapshotSections(next)) {
      const parsed = read(section.relativePath);
      const members = section.members.filter(
        (member) => !paths.has(member.path),
      );
      if (section.id === target)
        for (const relative of paths) {
          const doc = read(relative);
          members.push({ id: doc.data.id ?? relative, path: relative });
        }
      if (JSON.stringify(members) !== JSON.stringify(section.members))
        write(
          section.relativePath,
          { ...parsed.data, members },
          parsed.content,
        );
    }
  };
  let result: unknown;
  if (channel === 'documents:create-idea') {
    const id = `idea-${randomUUID().slice(0, 8)}`,
      relative = `ideas/${id}.md`;
    const explicit = input.width !== undefined || input.height !== undefined;
    const bounds = explicit
      ? {
          x: number(input.x),
          y: number(input.y),
          width: number(input.width),
          height: number(input.height),
        }
      : null;
    if (bounds && (bounds.width <= 0 || bounds.height <= 0))
      throw new Error('메모 크기는 0보다 커야 합니다.');
    const [automatic] = bounds
      ? []
      : verticalLayouts(
          [{ width: 340, height: 300 }],
          documentBounds(next, canvasId(input.canvasId)),
          { x: number(input.x), y: number(input.y) },
        );
    const layout = bounds ?? automatic;
    write(
      relative,
      {
        id,
        canvas_id: canvasId(input.canvasId),
        title: '새 아이디어',
        type: 'idea',
        status: 'draft',
        ...layout,
        sources: [],
      },
      '# 새 아이디어\n\n여기에 게임 아이디어를 적어보세요.',
    );
    result = snapshotDocuments(next).find(
      (doc) => doc.relativePath === relative,
    );
  } else if (channel === 'documents:set-color') {
    let relative = collaborationPath(input.relativePath);
    if (isPreviewPath(relative)) {
      if (next[relative] === undefined)
        throw new Error('HTML 파일을 찾을 수 없습니다.');
      const source = htmlSourcePath(relative);
      if (!next[source])
        next[source] = sourceMetadata(relative, next[relative]);
      relative = source;
    }
    const parsed = read(relative);
    if (!CARD_COLORS.some((item) => item.id === input.color))
      throw new Error('지원하지 않는 카드 색상입니다.');
    write(
      parsed.relative,
      { ...parsed.data, background_color: input.color },
      parsed.content,
    );
  } else if (channel === 'documents:save') {
    const parsed = read(input.relativePath);
    write(
      parsed.relative,
      { ...parsed.data, title: text(input.title, 300).trim() || '제목 없음' },
      text(input.body, 2_000_000),
    );
  } else if (channel === 'documents:delete') {
    const relative = collaborationPath(input.relativePath);
    const removed = new Set<string>();
    if (isPreviewPath(relative)) {
      if (next[relative] === undefined)
        throw new Error('삭제할 HTML 결과를 찾을 수 없습니다.');
      const target = previewDeletionTarget(relative);
      for (const key of Object.keys(next))
        if (key === relative || key.startsWith(`${target}/`)) removed.add(key);
      removed.add(htmlSourcePath(relative));
    } else {
      const parsed = read(relative);
      if (
        parsed.data.id !== input.documentId &&
        parsed.relative !== input.documentId
      )
        throw new Error('문서 ID가 올바르지 않습니다.');
      removed.add(relative);
    }
    for (const key of removed) delete next[key];
    removeMembers(removed);
  } else if (channel === 'documents:duplicate') {
    const paths: string[] = [];
    for (const item of array(input.documents)) {
      const member = record(item),
        parsed = read(member.path),
        suffix = randomUUID().slice(0, 8);
      const relative =
        parsed.relative === 'project.md'
          ? `docs/project-copy-${suffix}.md`
          : parsed.relative.replace(/\.md$/, `-copy-${suffix}.md`);
      write(
        relative,
        {
          ...parsed.data,
          canvas_id:
            input.canvasId !== undefined
              ? assertCanvas(files, input.canvasId)
              : canvasId(parsed.data.canvas_id),
          id: `copy-${suffix}`,
          title: `${parsed.data.title ?? '문서'} 복사본`,
          x: number(parsed.data.x ?? 120) + number(input.offsetX),
          y: number(parsed.data.y ?? 120) + number(input.offsetY),
        },
        parsed.content,
      );
      paths.push(relative);
    }
    result = snapshotDocuments(next).filter((doc) =>
      paths.includes(doc.relativePath),
    );
  } else if (
    channel === 'documents:update-layout' ||
    channel === 'sections:update-layout'
  ) {
    layout({
      ...input,
      kind: channel.startsWith('sections') ? 'section' : 'document',
    });
  } else if (channel === 'layouts:update') {
    for (const item of array(input.updates)) {
      const entry = record(item);
      if (entry.kind !== 'section' && entry.kind !== 'document')
        throw new Error('배치 종류가 올바르지 않습니다.');
      layout(entry);
    }
  } else if (channel === 'sections:rename') {
    const parsed = read(input.relativePath);
    if (!parsed.relative.startsWith('sections/'))
      throw new Error('섹션을 찾을 수 없습니다.');
    const title = text(input.title, 120).trim();
    if (!title) throw new Error('섹션 이름을 입력해주세요.');
    write(parsed.relative, { ...parsed.data, title }, parsed.content);
  } else if (channel === 'sections:create') {
    const members = array(input.members).map((item) => {
      const member = record(item),
        doc = read(member.path);
      return { id: doc.data.id ?? doc.relative, path: doc.relative };
    });
    if (
      !members.length ||
      new Set(members.map((member) => member.path)).size !== members.length
    )
      throw new Error('섹션 구성원을 확인해주세요.');
    if (
      members.some(
        (member) =>
          canvasId(read(member.path).data.canvas_id) !==
          canvasId(input.canvasId),
      )
    )
      throw new Error('같은 캔버스의 자료로 섹션을 만들어주세요.');
    removeMembers(new Set(members.map((member) => member.path)));
    const id = `section-${randomUUID().slice(0, 8)}`,
      relative = `sections/${id}.md`,
      title = text(input.title, 300).trim() || '새 섹션';
    write(
      relative,
      {
        id,
        title,
        canvas_id: canvasId(input.canvasId),
        type: 'section',
        status: 'active',
        x: number(input.x),
        y: number(input.y),
        width: Math.max(number(input.width), 420),
        height: Math.max(number(input.height), 280),
        members,
      },
      `# ${title}\n\n섹션 멤버십과 위치를 관리합니다.`,
    );
    result = snapshotSections(next).find(
      (section) => section.relativePath === relative,
    );
  } else if (channel === 'sections:delete') {
    const parsed = read(input.relativePath);
    if (
      !parsed.relative.startsWith('sections/') ||
      parsed.data.id !== input.sectionId
    )
      throw new Error('섹션을 확인할 수 없습니다.');
    const paths = new Set<string>(
      (parsed.data.members ?? []).map((member: { path: string }) =>
        collaborationPath(member.path),
      ),
    );
    let deletedDocumentCount = 0;
    if (input.deleteMembers === true)
      for (const relative of paths)
        if (next[relative]) {
          delete next[relative];
          deletedDocumentCount++;
        }
    delete next[parsed.relative];
    if (input.deleteMembers === true) removeMembers(paths);
    result = {
      deletedDocumentCount,
      preservedDocumentCount: paths.size - deletedDocumentCount,
    };
  } else if (channel === 'sections:move-document') {
    const doc = read(input.documentPath),
      target = input.targetSectionId;
    if (
      target !== null &&
      !snapshotSections(next).some((section) => section.id === target)
    )
      throw new Error('대상 섹션을 찾을 수 없습니다.');
    if (target) {
      const section = snapshotSections(next).find(
        (item) => item.id === target,
      )!;
      if (canvasId(section.canvasId) !== canvasId(doc.data.canvas_id))
        throw new Error('다른 캔버스의 섹션으로 이동할 수 없습니다.');
    }
    removeMembers(new Set([doc.relative]), target as string | undefined);
    layout({ ...input, kind: 'document', relativePath: doc.relative });
  } else if (channel === 'tasks:create') {
    const paths = array(input.inputPaths).map((value) => {
      const relative = collaborationPath(value);
      if (isPreviewPath(relative) && next[relative] !== undefined)
        return relative;
      return read(value).relative;
    });
    if (!paths.length) throw new Error('입력 문서를 선택해주세요.');
    const kind = input.kind;
    if (kind !== 'organize' && kind !== 'implement')
      throw new Error('AI 작업 종류가 올바르지 않습니다.');
    const id = `${input.thenImplement !== undefined ? 'gamejam' : kind}-${randomUUID()}`,
      relative = `.ai/tasks/${id}.md`;
    const additions = createTaskFiles(
      {
        kind,
        canvasId: canvasId(input.canvasId),
        sourceMode: input.sourceMode as CreateTaskInput['sourceMode'],
        inputPaths: paths,
        x: number(input.x),
        y: number(input.y),
        htmlResult: input.htmlResult as CreateTaskInput['htmlResult'],
        documentResult:
          input.documentResult as CreateTaskInput['documentResult'],
        instructions: input.instructions as string | undefined,
        resultName: input.resultName as string | undefined,
        thenImplement: input.thenImplement as CreateTaskInput['thenImplement'],
      },
      id,
      files,
    );
    Object.assign(next, additions);
    const specification = matter(next[relative]);
    write(relative, specification.data, specification.content);
    result = snapshotDocuments(next).find(
      (doc) => doc.relativePath === relative,
    );
  }
  checkSnapshot(next);
  return { files: next, result };
}
