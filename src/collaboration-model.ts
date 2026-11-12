import { ServerLimits } from './contracts/server-limits.ts';
import { GameBuildLimits } from './contracts/game-build.ts';
import {
  isGameBuildPath,
  hasGameBuilds,
  validateGameBuilds,
  deleteGameBuilds,
} from './core/projects/game-build.ts';
import { gameBuildCodec } from './adapters/node/game-build-codec.ts';
import { PROJECT_LAYOUT_PATH } from './contracts/project-layout.ts';
import { FILE_NAMES_PATH } from './contracts/document-names.ts';
import { readFileNames } from './core/documents/name-registry.ts';
import { planDocumentName } from './application/editing/document-name-plan.ts';
import { remapLayoutMarkdown } from './adapters/markdown/layout-links.ts';
import { previewNameCodec } from './adapters/markdown/preview-names.ts';
import { planPreviewName } from './application/editing/preview-name-plan.ts';
import { applyFileNamePlan } from './application/editing/file-name-plan.ts';
import { readProjectLayout } from './core/projects/project-layout.ts';
import {
  allocateNamedDocumentPath,
  documentPathTitle,
} from './core/projects/document-path.ts';
import { importProjectCopy } from './project-copy.ts';
import { layoutValues } from './core/editing/layout.ts';
import { audioAsset } from './core/projects/audio-assets.ts';
import { modelAsset } from './core/projects/model-assets.ts';
import {
  fitChildSections,
  sectionAncestors,
  sectionBranch,
  sectionDeletionPaths,
  sectionTree,
} from './core/editing/section-tree.ts';
import type { CommandEnvironment } from './core/editing/environment.ts';
import { COMMAND_LABELS, isCommandName } from './contracts/commands.ts';
import { documentEditContent } from './core/editing/document-edit.ts';
import { DOCUMENT_STATUSES_PATH, readStatuses } from './document-statuses.ts';
import {
  isGameUiPath,
  readGameUi,
  applyGameUi,
  snapshotGameUi,
} from './game-ui-model.ts';
import type { GameUiCommand } from './game-ui-types.ts';
import {
  KANBAN_VIEW_PATH,
  validateKanbanView,
} from './features/kanban/view.ts';
import {
  moveKanbanCard,
  saveKanbanView,
} from './features/kanban/view-storage.ts';
import {
  applyWorkflow,
  applyStatusProperty,
  saveStatuses,
  initializeWorkflows,
} from './document-workflow.ts';
import type { WorkflowInput, StatusesInput } from './document-statuses.ts';
import {
  CANVAS_SHEETS_PATH,
  canvasId,
  assertCanvas,
  readCanvasSheets,
} from './canvas-sheets.ts';
import {
  isDrawingPath,
  snapshotDrawings,
  readDrawingFile,
  applyDrawing,
  DRAWING_DIRECTORY,
} from './drawing-model.ts';
import type { DrawingCommand } from './drawing-types.ts';
import {
  validateCanvasMembership,
  changeCanvasSheets,
} from './canvas-sheet-commands.ts';
import type { CanvasSheetCommand } from './shared.ts';
import { randomUUID } from 'node:crypto';
import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { createTaskFiles } from './task-plan.ts';
import { isTextMaterial } from './canvas-text-materials.ts';
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
import {
  htmlSourcePath,
  sourceMetadata,
  previewIdentity,
} from './html-source.ts';
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
      isGameBuildPath(relative) ||
      relative === 'output/README.md' ||
      relative === PROJECT_LAYOUT_PATH ||
      relative === FILE_NAMES_PATH ||
      relative === RESULT_CATALOG_PATH ||
      relative === CANVAS_SHEETS_PATH ||
      relative === DOCUMENT_STATUSES_PATH ||
      relative === KANBAN_VIEW_PATH ||
      isDrawingPath(relative) ||
      isGameUiPath(relative) ||
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
            !(segment === '.game-builds' && isGameBuildPath(relative)) &&
            !(
              ([
                RESULT_CATALOG_PATH,
                PROJECT_LAYOUT_PATH,
                FILE_NAMES_PATH,
                CANVAS_SHEETS_PATH,
                DOCUMENT_STATUSES_PATH,
                KANBAN_VIEW_PATH,
              ].includes(relative) ||
                isDrawingPath(relative) ||
                isGameUiPath(relative)) &&
              segment === '.canvas'
            )) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
      )
  )
    throw new Error('공유 프로젝트의 문서 경로가 올바르지 않습니다.');
  return relative;
}

export function checkSnapshot(
  files: unknown,
  local = false,
): asserts files is Snapshot {
  if (!files || typeof files !== 'object' || Array.isArray(files))
    throw new Error('문서 목록이 올바르지 않습니다.');
  readProjectLayout(files as Snapshot);
  validateGameBuilds(files as Snapshot, gameBuildCodec);
  readFileNames(files as Snapshot);
  if ((files as Snapshot)[DOCUMENT_STATUSES_PATH])
    readStatuses((files as Snapshot)[DOCUMENT_STATUSES_PATH]);
  validateCanvasMembership(files as Snapshot);
  if ((files as Snapshot)[KANBAN_VIEW_PATH])
    validateKanbanView(JSON.parse((files as Snapshot)[KANBAN_VIEW_PATH]));
  const sheets = readCanvasSheets((files as Snapshot)[CANVAS_SHEETS_PATH]);
  for (const f of snapshotGameUi(files as Snapshot))
    if (!sheets.canvases.some((c) => c.id === f.canvasId))
      throw new Error('게임 화면의 캔버스를 찾을 수 없습니다.');
    else if (f.descriptionPath && (files as Snapshot)[f.descriptionPath]) {
      const meta = matter((files as Snapshot)[f.descriptionPath]).data;
      if (
        meta.game_ui_frame !== f.id ||
        JSON.stringify(meta.game_ui_rows) !==
          JSON.stringify(f.items.map((i) => ({ id: i.id, name: i.name })))
      )
        throw new Error('게임 화면과 UI 설명 표의 연결이 일치하지 않습니다.');
    }
  for (const path of Object.keys(files).filter(isDrawingPath)) {
    const id = path.slice(DRAWING_DIRECTORY.length + 1, -5);
    if (!sheets.canvases.some((c) => c.id === id))
      throw new Error('그림 파일의 캔버스를 찾을 수 없습니다.');
  }
  for (const o of snapshotDrawings(files as Snapshot))
    if (!sheets.canvases.some((c) => c.id === o.canvasId))
      throw new Error('그림의 캔버스를 찾을 수 없습니다.');
  const entries = Object.entries(files);
  if (entries.length > ServerLimits.files)
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
          ? ServerLimits.assetEncodedBytes
          : isPreviewPath(key)
            ? ServerLimits.htmlBytes
            : ServerLimits.markdownBytes)
    )
      throw new Error(
        'Markdown은 2MB, HTML은 8MB, 원본 이미지는 5MB까지 공유할 수 있습니다.',
      );
    bytes += Buffer.byteLength(value);
    if (isGameBuildPath(key)) continue;
    if (isGameUiPath(key)) {
      readGameUi(value, key);
      continue;
    }
    if (isDrawingPath(key)) {
      readDrawingFile(value, key.slice(DRAWING_DIRECTORY.length + 1, -5));
      continue;
    }
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
          id !== previewIdentity(files as Snapshot, parsed.data.html_source) ||
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
  const snapshotLimit = hasGameBuilds(files as Snapshot)
    ? GameBuildLimits.snapshotBytes
    : ServerLimits.projectBytes;
  if (bytes > snapshotLimit)
    throw new Error(
      `프로젝트 전송 한도(${snapshotLimit / 1_000_000}MB)를 초과했습니다.`,
    );
  const documents = new Map(
    snapshotDocuments(files as Snapshot).map((doc) => [doc.relativePath, doc]),
  );
  const memberships = new Set<string>();
  for (const document of documents.values()) {
    if (!local && document.audio)
      throw Error('사운드 노드는 로컬 프로젝트에서만 사용할 수 있습니다.');
    if (!local && document.model)
      throw Error('3D 모델 노드는 로컬 프로젝트에서만 사용할 수 있습니다.');
    if (
      document.type === 'image' &&
      (!document.asset || !(files as Snapshot)[document.asset.path])
    )
      throw new Error(
        `이미지 카드에 연결된 원본 이미지를 찾을 수 없습니다: ${document.relativePath}`,
      );
  }
  for (const section of snapshotSections(files as Snapshot)) {
    if (!local && section.parentSectionId !== undefined)
      throw Error('중첩 섹션은 로컬 프로젝트에서만 사용할 수 있습니다.');
    for (const member of section.members) {
      const doc = documents.get(member?.path);
      if (!doc || doc.id !== member.id || memberships.has(member.path))
        throw new Error(`섹션 소속을 확인해주세요: ${section.relativePath}`);
      memberships.add(member.path);
    }
  }
}

export function snapshotDocuments(files: Snapshot): CanvasDocument[] {
  return Object.entries(files)
    .filter(
      ([key]) =>
        key.endsWith('.md') &&
        !key.startsWith('docs/text-sources/') &&
        !key.startsWith('sections/') &&
        !key.startsWith('output/'),
    )
    .map(([relativePath, raw]) => {
      const { data, content } = matter(raw);
      const audio = audioAsset(data.audio_asset);
      const model = audio ? undefined : modelAsset(data.model_asset);
      const number = (key: string, fallback: number) =>
        Number.isFinite(data[key]) ? (data[key] as number) : fallback;
      return {
        canvasId: canvasId(data.canvas_id),
        identitySource: typeof data.id === 'string' ? 'frontmatter' : 'path',
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
        statusPropertyEnabled:
          typeof data.status_property_enabled === 'boolean'
            ? data.status_property_enabled
            : undefined,
        workflowStatusId:
          typeof data.workflow_status_id === 'string'
            ? data.workflow_status_id
            : undefined,
        workflowOrder: Number.isFinite(data.workflow_order)
          ? data.workflow_order
          : undefined,
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
        ...(audio && { audio }),
        ...(model && { model }),
        systemId:
          typeof data.system_id === 'string' ? data.system_id : undefined,
        outputKey:
          typeof data.document_output?.key === 'string'
            ? data.document_output.key
            : undefined,
        outputInstructions:
          typeof data.document_output?.instructions === 'string'
            ? data.document_output.instructions
            : undefined,
        documentBundleId:
          typeof data.document_bundle_id === 'string'
            ? data.document_bundle_id
            : typeof data.document_bundle?.id === 'string'
              ? data.document_bundle.id
              : undefined,
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
        ...(typeof data.parent_section_id === 'string'
          ? { parentSectionId: data.parent_section_id }
          : {}),
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

export const commandLabels: Record<string, string> = COMMAND_LABELS;

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
  environment: CommandEnvironment = { now: Date.now, id: randomUUID },
  local = false,
): { files: Snapshot; result: unknown } {
  if (!isCommandName(channel))
    throw new Error('허용되지 않은 공동 작업입니다.');
  let next = { ...files };
  const input = record(value);
  if (
    !local &&
    (input.parentSectionId !== undefined || input.membership !== undefined)
  )
    throw Error('중첩 섹션은 로컬 프로젝트에서만 사용할 수 있습니다.');
  const validate = (snapshot: Snapshot) => checkSnapshot(snapshot, local);
  if (channel === 'preview:rename') {
    const plan = planPreviewName(
      files,
      value as import('./contracts/document-names.ts').RenamePreviewInput,
      {
        parse: matter,
        stringify: (body, data) => matter.stringify(body, data),
      },
      remapLayoutMarkdown,
      previewNameCodec,
    );
    validate(plan.files);
    return { files: plan.files, result: plan.change };
  }
  if (channel === 'files:unify-names') {
    const plan = applyFileNamePlan(
      files,
      value as import('./contracts/document-names.ts').ApplyFileNamesInput,
      {
        parse: matter,
        stringify: (body, data) => matter.stringify(body, data),
      },
      remapLayoutMarkdown,
      previewNameCodec,
    );
    validate(plan.files);
    return { files: plan.files, result: plan.affectedPaths };
  }
  if (channel === 'documents:rename') {
    const plan = planDocumentName(
      files,
      value as import('./contracts/document-names.ts').RenameDocumentInput,
      {
        parse: matter,
        stringify: (body, data) => matter.stringify(body, data),
      },
      remapLayoutMarkdown,
    );
    validate(plan.files);
    return { files: plan.files, result: plan.change };
  }
  if (channel === 'projects:import-copy') {
    const copied = importProjectCopy(
      files,
      value as import('./contracts/project-copy.ts').ProjectCopyImport,
      environment,
    );
    validate(copied.files);
    return copied;
  }
  if (channel === 'kanban:move-card' || channel === 'kanban:save-view') {
    const changed =
      channel === 'kanban:move-card'
        ? moveKanbanCard(
            files,
            input as unknown as import('./features/kanban/view-storage').KanbanMoveInput,
            environment.now,
          )
        : saveKanbanView(
            files,
            input as unknown as import('./features/kanban/view').KanbanViewInput,
          );
    validate(changed);
    return { files: changed, result: undefined };
  }
  if (
    channel === 'files:set-status-property' ||
    channel === 'documents:set-workflow' ||
    channel === 'document-statuses:save'
  ) {
    const changed =
      channel === 'files:set-status-property'
        ? applyStatusProperty(
            files,
            input as unknown as import('./file-properties').StatusPropertyInput,
            environment.now,
          )
        : channel === 'documents:set-workflow'
          ? applyWorkflow(
              files,
              input as unknown as WorkflowInput,
              environment.now,
            )
          : saveStatuses(
              files,
              input as unknown as StatusesInput,
              environment.now,
            );
    validate(changed);
    return { files: changed, result: undefined };
  }
  if (channel === 'canvas:batch') {
    const commands = array(input.commands);
    const colorsOnly = commands.every(
      (command) => record(command).channel === 'documents:set-color',
    );
    if (!commands.length || commands.length > (colorsOnly ? 500 : 10))
      throw new Error('함께 편집할 항목을 확인해주세요.');
    let changed = files;
    const results: unknown[] = [];
    const allowed = [
      'documents:set-color',
      'drawings:apply',
      'game-ui:apply',
      'layouts:update',
      'documents:duplicate',
      'documents:delete-many',
      'sections:delete',
      'canvases:change',
    ];
    for (const command of commands) {
      const part = record(command);
      if (!allowed.includes(String(part.channel)))
        throw new Error('허용되지 않은 묶음 작업입니다.');
      const reduced = reduceCollaboration(
        changed,
        String(part.channel),
        part.input,
        environment,
        local,
      );
      changed = reduced.files;
      results.push(reduced.result);
    }
    validate(changed);
    return { files: changed, result: results };
  }
  if (channel === 'drawings:apply') {
    assertCanvas(files, input.canvasId);
    if (input.action === 'move') assertCanvas(files, input.targetCanvasId);
    const changed = applyDrawing(files, input as unknown as DrawingCommand);
    validate(changed);
    return { files: changed, result: undefined };
  }
  if (channel === 'game-ui:apply') {
    const changed = applyGameUi(files, input as unknown as GameUiCommand);
    validate(changed);
    return { files: changed, result: snapshotGameUi(changed) };
  }
  if (channel === 'canvases:change') {
    const changed = changeCanvasSheets(
      files,
      input as unknown as CanvasSheetCommand,
      local ? snapshotSections(files) : undefined,
    );
    validate(changed);
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
    validate(relocated);
    return { files: relocated, result: moves };
  }
  if (channel === 'files:import-batch') {
    const additions = layoutNewDocuments(
      files,
      buildFileImports(input as ImportBatchInput, environment, files, local),
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
    validate(next);
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
        environment,
        local,
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
      updated_at: environment.now(),
    });
  };
  const patchSection = (section: CanvasSection, fields: Input) => {
    const parsed = read(section.relativePath);
    const data = { ...parsed.data, ...fields };
    if (data.parent_section_id === undefined) delete data.parent_section_id;
    write(parsed.relative, data, parsed.content);
  };
  const expandParents = (id: string) => {
    const tree = sectionTree(snapshotSections(next));
    for (const parent of sectionAncestors(tree, id)) {
      const children = (tree.children.get(parent.id) ?? []).map((child) => {
        const { x, y, width, height } = read(child.relativePath).data;
        return {
          ...child,
          x: x ?? child.x,
          y: y ?? child.y,
          width: width ?? child.width,
          height: height ?? child.height,
        };
      });
      const frame = fitChildSections(parent, children);
      if (
        frame.x !== parent.x ||
        frame.y !== parent.y ||
        frame.width !== parent.width ||
        frame.height !== parent.height
      )
        patchSection(parent, frame);
    }
  };
  const layout = (entry: Input) => {
    const parsed = read(entry.relativePath);
    let frame = layoutValues(parsed.data, entry);
    if (entry.kind !== 'section') {
      write(parsed.relative, { ...parsed.data, ...frame }, parsed.content);
      return;
    }
    const sections = snapshotSections(next);
    const section = sections.find(
      (item) => item.relativePath === parsed.relative,
    );
    if (
      !section ||
      (entry.objectId !== undefined && entry.objectId !== section.id)
    )
      throw Error('섹션이 변경되었습니다. 목록을 새로고침해주세요.');
    const tree = sectionTree(sections);
    const branch = sectionBranch(tree, section);
    const parentPatch: Input = {};
    if (entry.membership !== undefined) {
      if (!local)
        throw Error('중첩 섹션은 로컬 프로젝트에서만 사용할 수 있습니다.');
      const { expectedParentId, targetParentId } = record(entry.membership);
      if (expectedParentId !== (section.parentSectionId ?? null))
        throw Error('상위 섹션이 변경되었습니다. 다시 옮겨주세요.');
      if (
        targetParentId !== null &&
        !sections.some(
          (target) =>
            target.id === targetParentId &&
            target.canvasId === section.canvasId &&
            !branch.some((child) => child.id === target.id),
        )
      )
        throw Error(
          '같은 캔버스에서 자신이나 하위 섹션 밖의 상위 섹션을 선택해주세요.',
        );
      parentPatch.parent_section_id = targetParentId ?? undefined;
    }
    const dx = frame.x - section.x,
      dy = frame.y - section.y;
    if (entry.moveMembers !== false && (dx || dy)) {
      for (const child of branch.slice(1))
        patchSection(child, { x: child.x + dx, y: child.y + dy });
      for (const relative of new Set(
        branch.flatMap((child) => child.members.map((member) => member.path)),
      )) {
        const child = read(relative);
        write(
          child.relative,
          {
            ...child.data,
            x: number(child.data.x ?? 120) + dx,
            y: number(child.data.y ?? 120) + dy,
          },
          child.content,
        );
      }
    }
    if (local) {
      const children = tree.children.get(section.id) ?? [];
      const placed =
        entry.moveMembers === false
          ? children
          : children.map((child) => ({
              ...child,
              x: child.x + dx,
              y: child.y + dy,
            }));
      frame = fitChildSections(
        {
          ...frame,
          width: Math.max(frame.width, 420),
          height: Math.max(frame.height, 280),
        },
        placed,
      );
    }
    patchSection(section, { ...frame, ...parentPatch });
    if (local) expandParents(section.id);
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
    const id = `idea-${environment.id().slice(0, 8)}`,
      relative = allocateNamedDocumentPath('새 아이디어', Object.keys(next));
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
        title: documentPathTitle(relative),
        creation_origin: 'manual',
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
        next[source] = sourceMetadata(
          relative,
          next[relative],
          {},
          environment.now,
        );
      relative = source;
    }
    const parsed = read(relative);
    if (
      input.objectId !== undefined &&
      input.objectId !== (parsed.data.id ?? parsed.relative)
    )
      throw Error('색상을 변경할 객체가 교체되었습니다.');
    if (!CARD_COLORS.some((item) => item.id === input.color))
      throw new Error('지원하지 않는 카드 색상입니다.');
    write(
      parsed.relative,
      { ...parsed.data, background_color: input.color },
      parsed.content,
    );
  } else if (channel === 'documents:save') {
    const parsed = read(input.relativePath);
    const content = documentEditContent({
      title: text(input.title, 300),
      body: text(input.body, 2_000_000),
    });
    write(
      parsed.relative,
      { ...parsed.data, title: content.title },
      content.body,
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
    const cleaned = deleteGameBuilds(next, removed);
    for (const key of Object.keys(next))
      if (!(key in cleaned)) delete next[key];
    Object.assign(next, cleaned);
    removeMembers(removed);
  } else if (channel === 'documents:duplicate') {
    const paths: string[] = [];
    for (const item of array(input.documents)) {
      const member = record(item),
        parsed = read(member.path),
        suffix = environment.id().slice(0, 8);
      const relative = allocateNamedDocumentPath(
        `${parsed.data.title ?? '문서'} 복사본`,
        Object.keys(next),
      );
      write(
        relative,
        {
          ...parsed.data,
          canvas_id:
            input.canvasId !== undefined
              ? assertCanvas(files, input.canvasId)
              : canvasId(parsed.data.canvas_id),
          id: `copy-${suffix}`,
          creation_origin: 'duplicate',
          status_property_enabled:
            parsed.data.status_property_enabled !== false,
          title: documentPathTitle(relative),
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
    const entries = array(input.updates).map(record);
    const carried = new Set<string>();
    if (local) {
      const sections = snapshotSections(next);
      const tree = sectionTree(sections);
      const moving = new Set(
        entries
          .filter(
            (entry) =>
              entry.kind === 'section' &&
              entry.moveMembers !== false &&
              entry.position !== false,
          )
          .map((entry) => entry.relativePath),
      );
      for (const section of sections) {
        if (!moving.has(section.relativePath)) continue;
        for (const child of sectionBranch(tree, section)) {
          if (child !== section) carried.add(child.relativePath);
          for (const member of child.members) carried.add(member.path);
        }
      }
    }
    for (const entry of entries) {
      if (entry.kind !== 'section' && entry.kind !== 'document')
        throw new Error('배치 종류가 올바르지 않습니다.');
      if (carried.has(String(entry.relativePath))) continue;
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
    const parent =
      input.parentSectionId === undefined
        ? undefined
        : snapshotSections(next).find(
            (item) =>
              item.id === input.parentSectionId &&
              item.canvasId === canvasId(input.canvasId),
          );
    if (input.parentSectionId !== undefined && !parent)
      throw Error('상위 섹션을 찾을 수 없습니다.');
    const members = array(input.members).map((item) => {
      const member = record(item),
        doc = read(member.path);
      return { id: doc.data.id ?? doc.relative, path: doc.relative };
    });
    if (new Set(members.map((member) => member.path)).size !== members.length)
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
    const id = `section-${environment.id().slice(0, 8)}`,
      relative = `sections/${id}.md`,
      title = text(input.title, 300).trim() || '새 섹션';
    if (next[relative] !== undefined)
      throw Error('섹션 ID가 중복되었습니다. 다시 시도해주세요.');
    write(
      relative,
      {
        id,
        title,
        canvas_id: canvasId(input.canvasId),
        type: 'section',
        ...(parent ? { parent_section_id: parent.id } : {}),
        status: 'active',
        x: number(input.x),
        y: number(input.y),
        width: Math.max(number(input.width), 420),
        height: Math.max(number(input.height), 280),
        members,
      },
      `# ${title}\n\n섹션 멤버십과 위치를 관리합니다.`,
    );
    if (parent) expandParents(id);
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
    const sections = snapshotSections(next);
    const section = sections.find(
      (item) => item.relativePath === parsed.relative,
    )!;
    const tree = sectionTree(sections);
    const recursive = input.deleteMembers === true;
    const paths = sectionDeletionPaths(tree, section, recursive);
    if (
      input.expectedPaths !== undefined &&
      JSON.stringify(array(input.expectedPaths).slice().sort()) !==
        JSON.stringify(paths.slice().sort())
    )
      throw Error('섹션의 삭제 대상이 변경되었습니다. 다시 확인해주세요.');
    const branch = recursive ? sectionBranch(tree, section) : [section];
    const sectionPaths = new Set(branch.map((child) => child.relativePath));
    let deletedDocumentCount = 0;
    if (recursive) {
      const documents = new Set(
        paths.filter((path) => !sectionPaths.has(path)),
      );
      for (const relative of documents)
        if (next[relative]) {
          delete next[relative];
          deletedDocumentCount++;
        }
      removeMembers(documents);
    } else {
      const parent = tree.parents.get(section.id);
      for (const child of tree.children.get(section.id) ?? [])
        patchSection(child, { parent_section_id: parent?.id });
      if (parent)
        removeMembers(
          new Set(section.members.map((member) => member.path)),
          parent.id,
        );
    }
    for (const relative of sectionPaths) delete next[relative];
    result = {
      deletedDocumentCount,
      preservedDocumentCount: recursive ? 0 : section.members.length,
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
      if (typeof value === 'string' && isTextMaterial(value)) return value;
      const relative = collaborationPath(value);
      if (isPreviewPath(relative) && next[relative] !== undefined)
        return relative;
      return read(value).relative;
    });
    if (!paths.length) throw new Error('입력 문서를 선택해주세요.');
    const kind = input.kind;
    if (kind !== 'organize' && kind !== 'implement')
      throw new Error('AI 작업 종류가 올바르지 않습니다.');
    const id = `${input.thenImplement !== undefined ? 'gamejam' : kind}-${environment.id()}`,
      relative = `.ai/tasks/${id}.md`;
    const additions = createTaskFiles(
      {
        kind,
        gameBuildVersion:
          input.gameBuildVersion as CreateTaskInput['gameBuildVersion'],
        canvasId: canvasId(input.canvasId),
        sourceMode: input.sourceMode as CreateTaskInput['sourceMode'],
        inputPaths: paths,
        x: number(input.x),
        y: number(input.y),
        nodePlacement: input.nodePlacement as CreateTaskInput['nodePlacement'],
        htmlResult: input.htmlResult as CreateTaskInput['htmlResult'],
        documentResult:
          input.documentResult as CreateTaskInput['documentResult'],
        instructions: input.instructions as string | undefined,
        instructionOrigin:
          input.instructionOrigin as CreateTaskInput['instructionOrigin'],
        resultName: input.resultName as string | undefined,
        thenImplement: input.thenImplement as CreateTaskInput['thenImplement'],
        requestSnapshot:
          input.requestSnapshot as CreateTaskInput['requestSnapshot'],
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
  if (
    [
      'documents:create-idea',
      'documents:duplicate',
      'files:import-batch',
      'tasks:create',
    ].includes(channel)
  )
    next = initializeWorkflows(files, next);
  validate(next);
  if (result && typeof result === 'object' && 'relativePath' in result)
    result =
      snapshotDocuments(next).find(
        (d) => d.relativePath === (result as CanvasDocument).relativePath,
      ) ?? result;
  return { files: next, result };
}
