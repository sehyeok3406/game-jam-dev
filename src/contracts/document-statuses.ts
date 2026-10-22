export type DocumentStatuses = {
  version: 1;
  defaultStatusId: string;
  statuses: WorkflowStatus[];
};
export type WorkflowStatus = {
  id: string;
  name: string;
  badgeColor: string;
  /** Legacy compatibility only. New board appearance is owned by KanbanView. */
  boardBackground:
    | {
        mode: 'status' | 'none';
      }
    | {
        mode: 'custom';
        color: string;
      };
};
export type StatusesInput = {
  expected: string | null;
  value: DocumentStatuses;
  replacements?: Record<string, string>;
};
export type WorkflowInput = {
  relativePath: string;
  objectId: string;
  expectedStatus?: string;
  expectedOrder?: number;
  structureRevision?: number;
  workflowRevision?: number;
  statusId: string;
  beforeId?: string;
  afterId?: string;
};
