import type {
  AiProviderId,
  AiReasoningEffort,
  AiTaskRecord,
  CodexRunStatus,
} from './ai.ts';
import type { FailureInfo } from './errors.ts';
export type HistoryEntry = {
  providerId?: AiProviderId;
  aiTask?: AiTaskRecord;
  failure?: FailureInfo;
  id: string;
  label: string;
  kind: 'user' | 'ai' | 'restore';
  status: CodexRunStatus;
  createdAt: number;
  finishedAt?: number;
  taskPath?: string;
  modelId?: string | null;
  reasoningEffort?: AiReasoningEffort | null;
  error?: string;
  files: {
    relativePath: string;
    before: boolean;
    after: boolean;
  }[];
  actorId?: string;
  actorName?: string;
  action?: string;
  revision?: number;
};
