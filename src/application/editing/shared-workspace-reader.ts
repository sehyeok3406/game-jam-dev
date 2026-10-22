import type {
  SharedProjectView,
  SharedCanvasView,
} from '../ports/shared-editing-project.ts';
import type { CanvasDocument } from '../../contracts/documents.ts';
import {
  snapshotDocuments,
  snapshotSections,
  collaborationPath,
} from '../../collaboration-model.ts';
import {
  DOCUMENT_STATUSES_PATH,
  readStatuses,
} from '../../document-statuses.ts';
import {
  KANBAN_VIEW_PATH,
  readKanbanView,
} from '../../features/kanban/view.ts';
import { CANVAS_SHEETS_PATH, readCanvasSheets } from '../../canvas-sheets.ts';
import { snapshotDrawings } from '../../drawing-model.ts';
import { snapshotGameUi } from '../../game-ui-model.ts';
import { drawingChanges } from './canvas-service.ts';
import { describePreview } from '../../html-source.ts';
import {
  isPreviewPath,
  previewVersion,
  assertPreviewPath,
  DEFAULT_PREVIEW_PATH,
} from '../../preview-output.ts';
import { isAssetPath } from '../../file-assets.ts';
import { resolveAuthorship } from '../../file-authorship.ts';
import { CanvasError } from '../../app-errors.ts';

/** One session owns personal collapse overrides and its stable canvas projection. */
export class SharedWorkspaceReader {
  private source: () => SharedProjectView;
  private canvas: SharedCanvasView;
  private signature: (value: unknown) => string;
  private collapsed = new Map<string, boolean>();
  constructor(
    source: () => SharedProjectView,
    canvas: SharedCanvasView,
    signature: (value: unknown) => string,
  ) {
    this.source = source;
    this.canvas = canvas;
    this.signature = signature;
  }
  private documentValue(
    document: CanvasDocument,
    state: SharedProjectView,
    workflow: boolean,
  ) {
    const relative = document.relativePath;
    return {
      ...document,
      revision: state.revisions[relative],
      contentRevision: state.properties[relative]?.content ?? 0,
      ...(workflow
        ? { workflowRevision: state.properties[relative]?.workflow ?? 0 }
        : {}),
      structureRevision: state.properties[relative]?.structure ?? 0,
      assetVersion: document.asset
        ? state.revisions[document.asset.path]
        : undefined,
      collapsed: this.collapsed.get(relative) ?? document.collapsed,
    };
  }
  document(relative: string) {
    relative = collaborationPath(relative);
    const state = this.source();
    if (!state.files[relative]) return null;
    const document = snapshotDocuments({
      [relative]: state.files[relative],
    })[0];
    return document ? this.documentValue(document, state, true) : null;
  }
  documents() {
    const state = this.source();
    // Preserve the list DTO; detailed reads and saves also carry workflowRevision.
    return snapshotDocuments(state.files).map((document) =>
      this.documentValue(document, state, false),
    );
  }
  sections() {
    const state = this.source();
    return snapshotSections(state.files).map((section) => ({
      ...section,
      revision: state.revisions[section.relativePath],
      structureRevision: state.properties[section.relativePath]?.structure ?? 0,
    }));
  }
  setCollapsed(relative: string, collapsed: boolean) {
    this.collapsed.set(relative, collapsed);
  }
  canvasChanges(known: Record<string, string>) {
    const state = this.source();
    return this.canvas.read(
      state.files,
      state.revisions,
      state.properties,
      this.collapsed,
      known,
    );
  }
  canvases() {
    const { files } = this.source();
    return {
      ...readCanvasSheets(files[CANVAS_SHEETS_PATH]),
      raw: files[CANVAS_SHEETS_PATH] ?? null,
    };
  }
  statuses() {
    const raw = this.source().files[DOCUMENT_STATUSES_PATH] ?? null;
    return { value: readStatuses(raw), raw };
  }
  kanban() {
    const { files } = this.source();
    const raw = files[KANBAN_VIEW_PATH] ?? null;
    return {
      value: readKanbanView(raw, readStatuses(files[DOCUMENT_STATUSES_PATH])),
      raw,
    };
  }
  authorship(relative: string) {
    relative = collaborationPath(relative);
    const state = this.source();
    if (state.files[relative] === undefined)
      throw Error('현재 프로젝트에 없는 파일입니다.');
    return resolveAuthorship(state.authorship, relative, state.files[relative]);
  }
  asset(relative: string) {
    const { files } = this.source();
    if (!isAssetPath(relative) || !files[relative])
      throw new CanvasError(
        'GC-IMPORT-002',
        '프로젝트 이미지를 찾을 수 없습니다.',
      );
    return files[relative];
  }
  drawings() {
    return snapshotDrawings(this.source().files);
  }
  drawingDelta(known: Record<string, string> = {}) {
    return drawingChanges(this.source().files, known, this.signature);
  }
  gameUi() {
    return snapshotGameUi(this.source().files);
  }
  previews() {
    const state = this.source();
    return Object.keys(state.files)
      .filter(isPreviewPath)
      .sort((left, right) => previewVersion(left) - previewVersion(right))
      .map((relativePath) => ({
        ...describePreview(state.files, relativePath),
        revision: state.revisions[relativePath],
      }));
  }
  preview(relative?: string) {
    const relativePath = assertPreviewPath(relative ?? DEFAULT_PREVIEW_PATH);
    const { files } = this.source();
    return {
      exists: files[relativePath] !== undefined,
      relativePath,
      content: files[relativePath] ?? '',
    };
  }
}
