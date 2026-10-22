import type { GamejamRequest } from './gamejam-request.ts';
import type { AiProviderId, AiReasoningEffort } from './ai.ts';
export type ApprovalStart = {
  id: string;
  revision: number;
  reviewToken: string;
  commandId: string;
};
export type ApprovalList = {
  items: GamejamApproval[];
  version: number;
};
export type GamejamApproval = {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  status: ApprovalStatus;
  request: GamejamRequest;
  feedback?: string;
  copiedFrom?: string;
  approvedBy?: string;
  approvedName?: string;
  approvedAt?: number;
  approvedRevision?: number;
  executionRequest?: GamejamRequest;
  approvalCommandId?: string;
  runId?: string;
  taskPath?: string;
  approvedReviewToken?: string;
  providerId?: AiProviderId;
  modelId?: string | null;
  reasoningEffort?: AiReasoningEffort | null;
  outputs?: string[];
  error?: string;
  changes: ApprovalChange[];
};
export type ApprovalStatus =
  | 'pending'
  | 'feedback'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stopped';
export type ApprovalChange = {
  at: number;
  actorId: string;
  actorName: string;
  action: string;
  revision: number;
  request?: GamejamRequest;
  message?: string;
};
export type ApprovalDetail = {
  item: GamejamApproval;
  reviewToken: string | null;
  reviewError?: string;
  outputs: string[];
};
export type ApprovalMutation = {
  commandId: string;
  id?: string;
  revision?: number;
  request?: GamejamRequest;
  message?: string;
  copiedFrom?: string;
};
