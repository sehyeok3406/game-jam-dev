import type { MultiplayerSettings } from './multiplayer.ts';
import type { GamejamSavedRequest } from './gamejam-history.ts';
import type { HtmlResultChoice } from './preview.ts';
import type { DocumentResultChoice } from './document-output.ts';
import type { FailureInfo } from './errors.ts';
import type { ApprovalStart } from './gamejam-approval.ts';
export type CreateTaskInput = {
  queueVersion?: 1;
  multiplayer?: MultiplayerSettings | null;
  requestSnapshot?: GamejamSavedRequest;
  canvasId?: string;
  sourceMode?: 'html' | 'html-compose';
  kind: 'organize' | 'implement';
  inputPaths: string[];
  x: number;
  y: number;
  htmlResult?: HtmlResultChoice;
  documentResult?: DocumentResultChoice;
  instructions?: string;
  resultName?: string;
  thenImplement?: {
    multiplayer?: MultiplayerSettings | null;
    htmlResult?: HtmlResultChoice;
    instructions?: string;
    resultName?: string;
  };
};
export type AiProviderId = 'codex-cli' | 'claude-cli' | 'gemini-cli';
export type AiReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';
export type CodexConnectionStatus = {
  supportsReasoningEffort?: boolean;
  providerId?: AiProviderId;
  available: boolean;
  authenticated: boolean;
  version: string | null;
  executablePath: string | null;
  message: string;
};
export type CodexRunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type AiFileLock = {
  paths: string[];
  folders: string[];
  prefixes?: string[];
};
export type CodexRunEvent = {
  projectSession?: import('./project-session.ts').ProjectSessionRef;
  fileLock?: AiFileLock;
  providerId?: AiProviderId;
  modelId?: string | null;
  reasoningEffort?: AiReasoningEffort | null;
  actorId?: string;
  runId: string;
  taskPath: string;
  status: CodexRunStatus;
  kind: 'status' | 'log' | 'result' | 'error';
  message: string;
  timestamp: number;
  failure?: FailureInfo;
};
export type StartCodexRunInput = {
  queueVersion?: 1;
  approval?: ApprovalStart;
  taskPath: string;
  providerId: AiProviderId;
  modelId: string | null;
  reasoningEffort?: AiReasoningEffort | null;
};
export type StartCodexRunResult = {
  runId: string;
  taskPath: string;
  status: CodexRunStatus;
  providerId: AiProviderId;
  modelId: string | null;
  reasoningEffort?: AiReasoningEffort | null;
};
export type AiTaskRecord = {
  requestSnapshot?: GamejamSavedRequest;
  title: string;
  specification: string;
  inputs: string[];
  outputs: string[];
  origin: 'snapshot' | 'legacy';
};

/** Provider-neutral names; serialized fields and legacy codex:* channels stay unchanged. */
export type AiConnectionStatus = CodexConnectionStatus;
export type AiRunStatus = CodexRunStatus;
export type AiRunEvent = CodexRunEvent;
export type AiRunInput = StartCodexRunInput;
export type AiRunResult = StartCodexRunResult;
