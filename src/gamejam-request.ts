import { CanvasError } from './app-errors.ts';
import { taskInstructions } from './task-instructions.ts';
import type { CreateTaskInput, HtmlResultChoice } from './shared.ts';
import type { DocumentResultChoice } from './document-output.ts';
import type { GamejamSavedRequest } from './gamejam-history.ts';

export type GamejamRequest = {
  multiplayer?: import('./multiplayer/types').MultiplayerSettings | null;
  canvasId?: string;
  sourceMode?: 'html' | 'html-compose';
  organize: boolean;
  implement: boolean;
  inputPaths: string[];
  x: number;
  y: number;
  htmlResult?: HtmlResultChoice;
  documentResult?: DocumentResultChoice;
  instructions: Record<'organize' | 'implement', string>;
  resultName: string;
};

/** Checkbox changes never replace edited instructions or output choices. */
export function gamejamTaskInput(
  request: GamejamRequest,
  settings?: Pick<GamejamSavedRequest, 'providerId' | 'modelId' | 'retryOf'>,
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
