import type { Project, Job } from '../project-state.ts';
import type { Snapshot } from '../../contracts/project.ts';
import {
  CanvasError,
  ERROR_CODES,
  failureInfo,
  errorText,
  type ErrorCode,
} from '../../app-errors.ts';
import { aiLockedSnapshot } from '../../ai-file-lock.ts';
import { resolveTaskArtifacts } from '../../document-bundle.ts';
import { validateArtifacts } from '../../ai-artifacts.ts';
import { validateHtmlAnalysis } from '../../html-source.ts';
import matter from '../../markdown.ts';
import { layoutNewDocuments } from '../../new-document-layout.ts';
import { canvasId } from '../../canvas-sheets.ts';
import { checkSnapshot } from '../../collaboration-model.ts';
import { ApiError } from './errors.ts';
/** Validate/prepare completion without mutating the project or persisting success. */
export function planAiResult(
  project: Project,
  job: Job,
  input: Record<string, unknown>,
  now: () => number,
  hash: (value: string) => string,
) {
  const success = input.status === 'completed';
  if (
    job.baselineHash !==
    hash(
      JSON.stringify(
        job.fileLock
          ? aiLockedSnapshot(project.files, job.fileLock)
          : project.files,
      ),
    )
  )
    throw new CanvasError(
      'GC-SYNC-001',
      'AI 입력 버전이 변경되어 결과를 반영하지 않습니다.',
    );
  let files = project.files;
  if (success) {
    const artifacts = input.artifacts;
    if (
      !artifacts ||
      typeof artifacts !== 'object' ||
      Array.isArray(artifacts) ||
      Object.values(artifacts).some((content) => typeof content !== 'string')
    )
      throw new ApiError('허용된 AI 결과만 제출할 수 있습니다.');
    files = { ...files, ...(artifacts as Snapshot) };
    const outputs = resolveTaskArtifacts(
      project.files[job.taskPath],
      files,
      project.files,
    );
    if (
      Object.keys(artifacts).length !== outputs.length ||
      Object.keys(artifacts).some((relative) => !outputs.includes(relative))
    )
      throw new ApiError('허용된 AI 결과만 제출할 수 있습니다.');
    validateArtifacts(project.files, files, outputs);
    validateHtmlAnalysis(project.files[job.taskPath], files, outputs);
    const taskData = matter(project.files[job.taskPath]).data;
    files = {
      ...files,
      ...layoutNewDocuments(project.files, artifacts as Snapshot, {
        x: Number.isFinite(taskData.x) ? taskData.x : 120,
        y: Number.isFinite(taskData.y) ? taskData.y : 120,
        canvasId: canvasId(taskData.canvas_id),
      }),
    };
    checkSnapshot(files);
  }
  const status: 'completed' | 'cancelled' | 'failed' = success
    ? 'completed'
    : input.status === 'cancelled'
      ? 'cancelled'
      : 'failed';
  const report = input.failure as
    | {
        code?: unknown;
        message?: unknown;
      }
    | undefined;
  const failure =
    status === 'failed'
      ? failureInfo(
          new CanvasError(
            report &&
              typeof report.code === 'string' &&
              Object.hasOwn(ERROR_CODES, report.code)
              ? (report.code as ErrorCode)
              : 'GC-AI-002',
            typeof report?.message === 'string'
              ? report.message.slice(0, 4000)
              : 'AI 작업이 실패했습니다.',
          ),
        )
      : undefined;
  const task = matter(files[job.taskPath]);
  files = {
    ...files,
    [job.taskPath]: matter.stringify(task.content, {
      ...task.data,
      status,
      ai_finished_at: new Date(now()).toISOString(),
      ai_error: failure ? errorText(failure) : null,
      ai_error_code: failure?.code ?? null,
    }),
  };
  return { files, status, success, failure };
}
