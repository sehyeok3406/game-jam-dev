import type { GamejamRequest } from './contracts/gamejam-request.ts';
export type { GamejamRequest } from './contracts/gamejam-request.ts';
import { CanvasError } from './app-errors.ts';
import { taskInstructions } from './task-instructions.ts';
import type { CreateTaskInput } from './shared.ts';

import type { GamejamSavedRequest } from './gamejam-history.ts';
import { resolveMultiplayer } from './multiplayer/resolve.ts';
export function resolveGamejamRequest(
  request: GamejamRequest,
  documents: readonly {
    relativePath: string;
    body: string;
  }[],
  previews: readonly {
    relativePath: string;
    content: string;
  }[],
): GamejamRequest {
  if (!request.implement) return request;
  const baseline =
    request.htmlResult?.basePath ??
    (request.htmlResult?.mode !== 'new' ? 'output/index.html' : undefined);
  const multiplayer = resolveMultiplayer({
    explicit: request.multiplayer,
    instructions: request.instructions.implement,
    baselineHtml: previews.find((item) => item.relativePath === baseline)
      ?.content,
    documents: documents
      .filter((doc) => request.inputPaths.includes(doc.relativePath))
      .map((doc) => doc.body),
  });
  return multiplayer === undefined ? request : { ...request, multiplayer };
}
/** Checkbox changes never replace edited instructions or output choices. */
export function gamejamTaskInput(
  request: GamejamRequest,
  settings?: Pick<
    GamejamSavedRequest,
    'providerId' | 'modelId' | 'reasoningEffort' | 'retryOf'
  >,
): CreateTaskInput {
  if (!request.organize && !request.implement)
    throw new CanvasError(
      'GC-AI-001',
      '문서 정리 또는 HTML 구현을 하나 이상 선택해주세요.',
    );
  const kind = request.organize ? 'organize' : 'implement';
  return {
    ...(settings
      ? {
          requestSnapshot: {
            version: 1 as const,
            request: structuredClone(request),
            ...settings,
          },
        }
      : {}),
    kind,
    canvasId: request.canvasId,
    sourceMode:
      request.sourceMode === 'html' && kind === 'implement'
        ? 'html-compose'
        : request.sourceMode,
    inputPaths: request.inputPaths,
    x: request.x,
    y: request.y,
    instructions: taskInstructions(kind, request.instructions[kind]),
    resultName: request.resultName,
    documentResult: request.organize ? request.documentResult : undefined,
    htmlResult: !request.organize ? request.htmlResult : undefined,
    multiplayer: request.implement ? request.multiplayer : undefined,
    ...(request.organize && request.implement
      ? {
          thenImplement: {
            multiplayer: request.multiplayer,
            htmlResult: request.htmlResult,
            resultName: request.resultName,
            instructions: taskInstructions(
              'implement',
              request.instructions.implement,
            ),
          },
        }
      : {}),
  };
}
