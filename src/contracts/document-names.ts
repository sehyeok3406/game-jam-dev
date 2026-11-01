import type { CanvasDocument } from './documents.ts';
export const FILE_NAMES_PATH = '.canvas/file-names.json';
export type NamedFile = {
  id: string;
  kind: 'markdown' | 'html';
  path: string;
  name: string;
  previousPaths: string[];
  originalPath: string;
};
export type FileNames = { version: 1; entries: NamedFile[] };
export type FileNameProposal = {
  currentName?: string;
  id: string;
  kind: NamedFile['kind'];
  from: string;
  name: string;
  to: string;
  error?: string;
};
export type FileNamePlan = {
  scope: string;
  session?: import('./project-session.ts').ProjectSessionRef;
  baseline: string;
  proposals: FileNameProposal[];
  affectedPaths: string[];
  needsLayoutUpgrade: boolean;
};
export type ApplyFileNamesInput = {
  scope: string;
  baseline: string;
  proposals: FileNameProposal[];
};
export type RenamePreviewInput = {
  scope: string;
  relativePath: string;
  objectId: string;
  expectedHash: string;
  name: string;
};
export type RenamePreviewResult = {
  preview: import('./preview.ts').PreviewResult;
  change: DocumentNameChange;
  affectedPaths: string[];
};

export type RenameDocumentInput = {
  scope: string;
  objectId: string;
  relativePath: string;
  expectedTitle: string;
  expectedBody: string;
  name: string;
};
export type DocumentNameChange = {
  objectId: string;
  from: string;
  to: string;
  name: string;
};
export type RenameDocumentResult = {
  document: CanvasDocument;
  change: DocumentNameChange;
  affectedPaths: string[];
};
