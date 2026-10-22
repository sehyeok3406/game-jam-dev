import type { CardColor } from './card-colors.ts';
import type { SectionMember } from './canvas.ts';
export type DocumentType =
  | 'idea'
  | 'system'
  | 'overview'
  | 'question'
  | 'reference'
  | 'image'
  | 'ai-task';
export type SourceReference = {
  id: string;
  path?: string;
  contribution?: string;
};
export type FileActor = {
  id?: string;
  name: string;
  kind: 'member' | 'local' | 'ai';
};
export type FileAuthorship = {
  createdBy?: FileActor;
  createdAt?: number;
  lastEditedBy?: FileActor;
  lastEditedAt?: number;
};
export type FileAuthorshipRecord = FileAuthorship & {
  fileId: string;
  contentHash: string;
};
export type FileAuthorshipMap = Record<string, FileAuthorshipRecord>;
export type CanvasDocument = {
  statusPropertyEnabled?: boolean;
  identitySource?: 'frontmatter' | 'path';
  workflowStatusId?: string;
  workflowOrder?: number;
  workflowRevision?: number;
  systemId?: string;
  documentBundleId?: string;
  outputKey?: string;
  outputInstructions?: string;
  structureRevision?: number;
  contentRevision?: number;
  canvasId?: string;
  backgroundColor?: CardColor;
  htmlSource?: string;
  asset?: ImageAsset;
  assetVersion?: number;
  revision?: number;
  id: string;
  title: string;
  type: DocumentType;
  status: string;
  relativePath: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  sources: SourceReference[];
  modifiedAt: number;
};
export type ImageAsset = {
  path: string;
  purpose: 'asset' | 'diagram';
  originalName: string;
  mime: string;
  bytes: number;
};
export type SaveDocumentInput = {
  /** Internal process-local guard; never changes durable draft/scope keys. */
  queueSessionId?: string;
  /** Internal queue guard, checked again inside the main-process mutation queue. */
  queueScope?: string;
  structureRevision?: number;
  objectId?: string;
  contentRevision?: number;
  expectedTitle?: string;
  expectedBody?: string;
  revision?: number;
  relativePath: string;
  title: string;
  body: string;
};
export type SetDocumentCollapsedInput = {
  relativePath: string;
  collapsed: boolean;
};
export type DeleteDocumentInput = {
  revision?: number;
  documentId: string;
  relativePath: string;
};
export type DuplicateDocumentsInput = {
  scope?: string;
  clipboardContextId?: string;
  requestId?: string;
  canvasId?: string;
  documents: SectionMember[];
  offsetX: number;
  offsetY: number;
};
export type CreateIdeaInput = {
  canvasId?: string;
  x: number;
  y: number;
  /** Explicit drawing bounds; omitted dimensions retain automatic placement. */
  width?: number;
  height?: number;
};
export type ImportFilesInput = {
  canvasId?: string;
  x: number;
  y: number;
  imagePurpose: 'asset' | 'diagram';
};
export type CanvasClipboardCopyInput = {
  scope: string;
  contextId: string;
  copyId: string;
};
export type CanvasClipboardPasteInput = ImportFilesInput & {
  scope: string;
  contextId: string;
  requestId: string;
  internalCopyId?: string;
};
export type CanvasClipboardPasteResult =
  | {
      kind: 'internal';
      copyId: string;
    }
  | {
      kind: 'images';
      documents: CanvasDocument[];
    }
  | {
      kind: 'empty' | 'unsupported' | 'stale-internal';
    };
export type ImportBatchInput = ImportFilesInput & {
  files: {
    name: string;
    content: string;
  }[];
};
