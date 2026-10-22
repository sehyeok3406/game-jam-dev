import { expectedArtifacts } from '../ai-artifacts.ts';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Project } from './project-state.ts';
import type { Snapshot } from '../contracts/project.ts';
import type { CodexRunEvent } from '../shared.ts';
import { queueFileLock } from '../ai-task-queue.ts';
import {
  taskFileLock,
  aiLockedSnapshot,
  mergeAiFileLocks,
} from '../ai-file-lock.ts';
import { applyExternalCommand } from '../application/editing/command-service.ts';
import { gamejamTaskInput, type GamejamRequest } from '../gamejam-request.ts';
import matter from '../markdown.ts';
export const cloneProject = (project: Project): Project => ({
  ...project,
  approvals: structuredClone(project.approvals ?? {}),
  approvalReceipts: { ...project.approvalReceipts },
  revisions: { ...project.revisions },
  members: project.members.map((member) => ({ ...member })),
  history: [...project.history],
  applied: [...project.applied],
  job: project.job ? structuredClone(project.job) : null,
  aiQueue: structuredClone(project.aiQueue ?? []),
});
export const protectedFiles = (project: Project) =>
  mergeAiFileLocks([
    project.job?.fileLock,
    queueFileLock(project.aiQueue ?? []),
  ]);
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const planApproval = (
  project: Project,
  request: GamejamRequest,
  providerId: import('../shared.ts').AiProviderId = 'codex-cli',
  modelId = '',
  reasoningEffort?: import('../shared.ts').AiReasoningEffort | null,
) => {
  const planned = applyExternalCommand(
    project.files,
    'tasks:create',
    gamejamTaskInput(request, { providerId, modelId, reasoningEffort }),
  );
  const taskPath = (
    planned.result as {
      relativePath: string;
    }
  ).relativePath;
  const lock = taskFileLock(planned.files, taskPath);
  const related = aiLockedSnapshot(project.files, lock);
  const paths = [...new Set([...lock.paths, ...Object.keys(related)])]
    .filter((p) => !p.startsWith('.ai/tasks/'))
    .sort();
  const reviewToken = digest(
    JSON.stringify(paths.map((p) => [p, project.files[p] ?? null])),
  );
  return {
    files: planned.files,
    taskPath,
    reviewToken,
    outputs: expectedArtifacts(planned.files[taskPath]),
  };
};
export const secret = () => randomBytes(32).toString('base64url');
export const same = (value: string, hash: string) =>
  timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(hash, 'hex'));
export const activeEvent = (event: CodexRunEvent | null) =>
  !!event && ['starting', 'running', 'validating'].includes(event.status);
export const taskState = (
  files: Snapshot,
  relative: string,
  status: string,
) => {
  const parsed = matter(files[relative]);
  return {
    ...files,
    [relative]: matter.stringify(parsed.content, {
      ...parsed.data,
      status,
      ai_updated_at: new Date().toISOString(),
    }),
  };
};
