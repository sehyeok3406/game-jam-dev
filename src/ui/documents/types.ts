import type { DraftFlusherRegistry } from '../editor/draft-flushers';
import type { FilePropertyVisibility } from '../../file-properties';
import type { DocumentStatuses } from '../../contracts/document-statuses';
import type { CanvasDocument } from '../../contracts/documents';
import type { Node } from '@xyflow/react';

export type DocumentNodeData = {
  draftRegistry: DraftFlusherRegistry;
  aiUsage?: string;
  propertyVisibility: FilePropertyVisibility;
  authorshipKey: string;
  statuses: DocumentStatuses;
  workflowDisabled: boolean;
  workflowReason?: string;
  onWorkflow: (id: string) => void;
  onManageWorkflow: () => void;
  sectionHidden?: boolean;
  kind: 'document';
  locked: boolean;
  onBlocked: () => void;
  registerEditor: (
    id: string,
    flush: ((finish?: boolean) => Promise<void>) | null,
  ) => void;
  document: CanvasDocument;
  collaborative: boolean;
  layoutLocked: boolean;
  draftKey: string;
  saveScope: string;
  sessionId?: string;
  editingBy?: string;
  beginEdit: (document: CanvasDocument) => Promise<void>;
  endEdit: (document: CanvasDocument) => Promise<void>;
  onSave: (
    document: CanvasDocument,
    title: string,
    body: string,
  ) => Promise<void>;
  onResize: (
    document: CanvasDocument,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<void>;
  onSource: (id: string) => void;
  onCopyTask: (document: CanvasDocument) => Promise<void>;
  onReveal: (document: CanvasDocument) => Promise<void>;
  onDetails: () => void;
  onCollapse: () => void;
  sourceTitles: Record<string, string>;
  reportEdit: (
    id: string,
    state: { dirty: boolean; saving: boolean; failed: boolean },
  ) => void;
};

export type DocumentCanvasNode = Node<DocumentNodeData, 'document'>;
