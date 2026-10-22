import type { AiRunEvent, AiRunStatus } from '../../contracts/ai.ts';
import type { FailureInfo } from '../../contracts/errors.ts';
import type { HistoryEntry } from '../../contracts/history.ts';
import type { AiEventIdentity } from './run-events.ts';

export type AiRunDiagnostic = {
  schemaVersion: 1;
  appVersion?: string;
  runId: string;
  taskPath: string;
  providerId?: AiEventIdentity['providerId'];
  modelId?: string | null;
  reasoningEffort?: AiEventIdentity['reasoningEffort'];
  workflowStage?: string | null;
  status: AiRunStatus;
  phase: string;
  exitCode?: number | null;
  startedAt?: string;
  finishedAt?: string;
  failure: FailureInfo | null;
  outputs?: string[];
  events: AiRunEvent[];
};
export interface AiRunRecords {
  diagnostic(report: AiRunDiagnostic): Promise<void>;
  history(entry: Omit<HistoryEntry, 'files'>): Promise<unknown>;
  task(status: AiRunStatus, fields: Record<string, unknown>): Promise<void>;
  specification(): Promise<string | undefined>;
}
