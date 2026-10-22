import type { WorkflowInput } from './document-statuses.ts';
export type StatusPropertyInput = Omit<
  WorkflowInput,
  'statusId' | 'beforeId' | 'afterId'
> & {
  expectedEnabled: boolean;
  enabled?: boolean;
  statusId?: string;
};
