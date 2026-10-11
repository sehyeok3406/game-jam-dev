import matter from './markdown.ts';
import { RESULT_CATEGORIES } from './preview-output.ts';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  defaultTaskInstructions,
} from './task-instructions.ts';
import type { GamejamRequest } from './gamejam-request.ts';
import type { GamejamPage } from './gamejam-wizard.ts';
import type { AiProviderId, CreateTaskInput, HistoryEntry } from './shared.ts';

export type GamejamSavedRequest = {
  version: 1;
  request: GamejamRequest;
  providerId: AiProviderId;
  modelId: string;
  retryOf?: string;
};
export type GamejamDraft = GamejamSavedRequest & {
  updatedAt: number;
  page: GamejamPage;
  instructionPage: 'organize' | 'implement';
};
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value: unknown) =>
  value === undefined || typeof value === 'string';

/** Drafts may be incomplete, but malformed local/server data must never break the dialog. */
export function readSavedRequest(
  value: unknown,
): GamejamSavedRequest | undefined {
  if (
    !object(value) ||
    value.version !== 1 ||
    !['codex-cli', 'claude-cli', 'gemini-cli'].includes(
      String(value.providerId),
    ) ||
    typeof value.modelId !== 'string' ||
    !optionalString(value.retryOf)
  )
    return;
  const request = value.request;
  if (
    !object(request) ||
    typeof request.organize !== 'boolean' ||
    typeof request.implement !== 'boolean' ||
    !Array.isArray(request.inputPaths) ||
    request.inputPaths.some((path) => typeof path !== 'string') ||
    !Number.isFinite(request.x) ||
    !Number.isFinite(request.y) ||
    !optionalString(request.canvasId) ||
    (request.sourceMode !== undefined &&
      !['html', 'html-compose'].includes(String(request.sourceMode))) ||
    typeof request.resultName !== 'string' ||
    !object(request.instructions) ||
    typeof request.instructions.organize !== 'string' ||
    typeof request.instructions.implement !== 'string'
  )
    return;
  const html = request.htmlResult;
  if (
    html !== undefined &&
    (!object(html) ||
      !['new', 'update'].includes(String(html.mode)) ||
      !optionalString(html.basePath) ||
      (html.category !== undefined &&
        !Object.hasOwn(RESULT_CATEGORIES, String(html.category))))
  )
    return;
  const docs = request.documentResult;
  if (
    docs !== undefined &&
    (!object(docs) ||
      !['new', 'update'].includes(String(docs.mode)) ||
      !optionalString(docs.baseDir) ||
      (docs.structure !== undefined &&
        !['custom', 'legacy', 'systems'].includes(String(docs.structure))) ||
      (docs.documents !== undefined &&
        (!Array.isArray(docs.documents) ||
          docs.documents.some(
            (doc) =>
              !object(doc) ||
              typeof doc.key !== 'string' ||
              typeof doc.title !== 'string' ||
              typeof doc.instructions !== 'string' ||
              !['overview', 'system', 'question'].includes(String(doc.type)),
          ))))
  )
    return;
  return structuredClone(value) as GamejamSavedRequest;
}

export function gamejamSnapshotFromInput(
  input: CreateTaskInput,
): GamejamSavedRequest {
  return (
    readSavedRequest(input.requestSnapshot) ?? {
      version: 1,
      providerId: 'codex-cli',
      modelId: '',
      request: {
        canvasId: input.canvasId,
        sourceMode: input.sourceMode,
        organize: input.kind === 'organize',
        implement: input.kind === 'implement' || !!input.thenImplement,
        inputPaths: [...input.inputPaths],
        x: input.x,
        y: input.y,
        resultName: input.resultName ?? '',
        documentResult: input.documentResult,
        htmlResult: input.thenImplement?.htmlResult ?? input.htmlResult,
        instructions: {
          ...DEFAULT_TASK_INSTRUCTIONS,
          [input.kind]:
            input.instructions ??
            defaultTaskInstructions(input.kind, input.sourceMode),
          ...(input.thenImplement
            ? {
                implement:
                  input.thenImplement.instructions ??
                  DEFAULT_TASK_INSTRUCTIONS.implement,
              }
            : {}),
        },
      },
    }
  );
}

/** Older request files still contain enough metadata to rebuild the execution form. */
export function requestSnapshotFromTask(
  raw: string,
): GamejamSavedRequest | undefined {
  try {
    const { data } = matter(raw);
    if (data.type !== 'ai-task') return;
    const saved = readSavedRequest(data.gamejam_request);
    if (saved) return saved;
    const first = Array.isArray(data.workflow_steps)
      ? data.workflow_steps[0]
      : raw;
    const second = Array.isArray(data.workflow_steps)
      ? data.workflow_steps[1]
      : undefined;
    if (
      typeof first !== 'string' ||
      (second !== undefined && typeof second !== 'string')
    )
      return;
    const stage = matter(first),
      html = second ? matter(second) : stage;
    const outputs = Array.isArray(stage.data.expected_outputs)
      ? stage.data.expected_outputs
      : [];
    const organize = outputs.some(
      (path) => typeof path === 'string' && path.endsWith('.md'),
    );
    const instruction = (body: string) => {
      const start = '## 사용자 작업 지시\n\n',
        end = '\n\n## 고정 보호 규칙\n';
      const from = body.indexOf(start),
        to = body.lastIndexOf(end);
      return from >= 0 && to > from
        ? body.slice(from + start.length, to)
        : undefined;
    };
    const primary = instruction(stage.content),
      secondary = second ? instruction(html.content) : undefined;
    if (primary === undefined || (second && secondary === undefined)) return;
    const format = stage.data.document_output_format;
    const request = {
      canvasId: data.canvas_id,
      sourceMode: data.source_mode,
      organize,
      implement: !organize || !!second,
      inputPaths: data.inputs,
      x: data.x ?? 0,
      y: data.y ?? 0,
      resultName: data.result_name ?? '',
      instructions: {
        ...DEFAULT_TASK_INSTRUCTIONS,
        [organize ? 'organize' : 'implement']: primary,
        ...(second ? { implement: secondary } : {}),
      },
      ...(organize
        ? {
            documentResult: {
              mode: data.document_output_mode ?? 'update',
              ...(typeof data.document_base_dir === 'string'
                ? { baseDir: data.document_base_dir }
                : {}),
              structure: format
                ? 'custom'
                : data.document_bundle
                  ? 'systems'
                  : 'legacy',
              ...(format
                ? {
                    documents: format.documents?.map(
                      ({
                        key,
                        title,
                        type,
                        instructions,
                      }: Record<string, unknown>) => ({
                        key,
                        title,
                        type,
                        instructions,
                      }),
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(!organize || second
        ? {
            htmlResult: {
              mode: html.data.html_output_mode ?? 'update',
              ...(typeof html.data.base_html === 'string'
                ? { basePath: html.data.base_html }
                : {}),
            },
          }
        : {}),
    };
    // Source support files were generated by the app, not selected by the user.
    if (Array.isArray(request.inputPaths))
      request.inputPaths = request.inputPaths.filter(
        (path: unknown) =>
          typeof path === 'string' && !path.startsWith('docs/html-sources/'),
      );
    return readSavedRequest({
      version: 1,
      request,
      providerId: data.ai_provider ?? 'codex-cli',
      modelId: data.ai_model === 'default' ? '' : (data.ai_model ?? ''),
    });
  } catch {
    return undefined;
  }
}

export function entryRequest(
  entry: HistoryEntry,
): GamejamSavedRequest | undefined {
  const saved = readSavedRequest(entry.aiTask?.requestSnapshot);
  if (!saved) return;
  return {
    ...saved,
    providerId: entry.providerId ?? saved.providerId,
    modelId:
      entry.modelId === undefined ? saved.modelId : (entry.modelId ?? ''),
    retryOf: entry.id,
  };
}

const draftKey = (project: string) => `game-canvas-gamejam-draft:${project}`;
export function loadGamejamDraft(
  storage: Storage,
  project: string,
): GamejamDraft | undefined {
  try {
    const value = JSON.parse(storage.getItem(draftKey(project)) ?? 'null');
    const saved = readSavedRequest(value);
    if (
      !saved ||
      !Number.isFinite(value.updatedAt) ||
      ![1, 2, 3, 4, 5].includes(value.page) ||
      !['organize', 'implement'].includes(value.instructionPage)
    )
      return;
    return {
      ...saved,
      updatedAt: value.updatedAt,
      page: value.page,
      instructionPage: value.instructionPage,
    };
  } catch {
    return undefined;
  }
}
export function saveGamejamDraft(
  storage: Storage,
  project: string,
  draft: GamejamDraft,
): boolean {
  try {
    storage.setItem(draftKey(project), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function clearGamejamDraft(storage: Storage, project: string) {
  try {
    storage.removeItem(draftKey(project));
  } catch {
    /* The execution record is already saved. */
  }
}
