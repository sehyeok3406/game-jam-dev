import type {
  AiFileLock,
  AiProviderId,
  AiReasoningEffort,
  CodexRunStatus,
} from './ai.ts';
export type AiQueueTask = {
  taskId: string;
  runId: string;
  taskPath: string;
  title: string;
  providerId: AiProviderId;
  modelId: string | null;
  reasoningEffort?: AiReasoningEffort | null;
  status: CodexRunStatus;
  createdAt: number;
  updatedAt: number;
  actorId?: string;
  message?: string;
  fileLock: AiFileLock;
  readScope: AiFileLock;
  writeScope: AiFileLock;
};
