import type { WorkflowStatus } from './document-statuses.ts';
import type { StatusPropertyInput } from './file-properties.ts';
export type KanbanView = {
  version: 1;
  backgrounds: Record<string, WorkflowStatus['boardBackground']>;
  orders: Record<string, number>;
};
export type KanbanViewInput = {
  expected: string | null;
  value: KanbanView;
};
export type KanbanMoveInput = StatusPropertyInput & {
  statusId: string;
  beforeId?: string;
  afterId?: string;
  expectedView: string | null;
};
