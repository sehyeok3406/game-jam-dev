import type { Snapshot } from '../contracts/project.ts';
import type { PropertyVersions } from '../contracts/sync-properties.ts';
import type {
  CollaborationRole,
  CodexRunEvent,
  HistoryEntry,
  FileAuthorshipMap,
} from '../shared.ts';
import type { GamejamApproval } from '../gamejam-approval.ts';

/** Existing in-memory/persisted project shape. No schema or wire format changes. */
export type Member = {
  id: string;
  nickname: string;
  role: CollaborationRole;
  owner: boolean;
  tokenHash: string;
  removed?: boolean;
};
export type StoredHistory = {
  entry: HistoryEntry;
  before: Snapshot;
  after: Snapshot;
};
export type Job = {
  claimId?: string;
  queueTaskId?: string;
  requestId?: string;
  fileLock?: import('../shared.ts').AiFileLock;
  providerId?: import('../shared.ts').AiProviderId;
  startedAt?: number;
  modelId?: string | null;
  reasoningEffort?: import('../shared').AiReasoningEffort | null;
  id: string;
  memberId: string;
  taskPath: string;
  outputs: string[];
  revision: number;
  baselineHash: string;
  expiresAt: number;
  event: CodexRunEvent;
};
export type Project = {
  creation?: { id: string; tokenHash: string; fingerprint: string };
  handover?: import('../contracts/project-mode.ts').ProjectHandover & {
    recoveryHash?: string;
  };
  detachReceipts?: Record<string, { proofHash: string; memberId: string }>;
  aiQueue?: import('../ai-task-queue.ts').StoredAiQueueTask[];
  approvals?: Record<string, GamejamApproval>;
  requestsVersion?: number;
  approvalReceipts?: Record<
    string,
    {
      memberId: string;
      fingerprint: string;
      requestId: string;
    }
  >;
  lifecycle?: {
    status: 'active' | 'trashing' | 'trashed' | 'restoring' | 'purging';
    version: number;
    trashId: string;
    identity: string | null;
    trashedAt?: number;
    expiresAt?: number;
    error?: string;
  };
  propertyVersions?: PropertyVersions;
  propertySync?: boolean;
  sequences?: Record<string, number>;
  id: string;
  name: string;
  createdAt?: number;
  modifiedAt?: number;
  revision: number;
  files: Snapshot;
  revisions: Record<string, number>;
  members: Member[];
  inviteHash: string;
  inviteExpiresAt: number;
  recoveryHash: string;
  history: StoredHistory[];
  applied: {
    id: string;
    memberId: string;
    result: unknown;
  }[];
  job: Job | null;
  lastRun: CodexRunEvent | null;
  authorship: FileAuthorshipMap;
};
export type Lock = {
  memberId: string;
  token: string;
  expiresAt: number;
};
