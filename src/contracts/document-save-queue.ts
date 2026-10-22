import type { EditorDraft } from './editor.ts';
import type { CanvasDocument } from './documents.ts';
export type DocumentSaveRequest = EditorDraft & {
  scope: string;
  key: string;
  relativePath: string;
  documentId: string;
  sequence: number;
  sessionId?: string;
  base: EditorDraft;
};
export type DocumentSaveState = {
  projectSession?: import('./project-session.ts').ProjectSessionRef;
  scope: string;
  key: string;
  documentId: string;
  relativePath: string;
  sequence: number;
  savedSequence: number;
  phase: DocumentSavePhase;
  latest: EditorDraft;
  saved: EditorDraft;
  document?: CanvasDocument;
  error?: string;
};
export type DocumentSavePhase =
  | 'queued'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'conflict'
  | 'failed'
  | 'discarded';
