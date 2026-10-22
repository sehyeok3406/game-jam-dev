import type { CanvasSheetCommand } from '../../contracts/canvas';
import type { DrawingObject } from '../../contracts/drawing-types';

export interface CanvasTransfer {
  source: string;
  paths: string[];
  drawings?: DrawingObject[];
}

/** A mixed move remains one existing canvas transaction and one undo entry. */
export function canvasTransferPlan(
  transfer: CanvasTransfer,
  target: string,
  raw: string | null,
) {
  const command: CanvasSheetCommand = {
    action: 'move',
    id: transfer.source,
    paths: [...transfer.paths],
    targetId: target,
    expected: raw,
  };
  const drawings = transfer.drawings ?? [];
  return {
    command,
    commands: [
      ...(transfer.paths.length
        ? [{ channel: 'canvases:change', input: command }]
        : []),
      ...(drawings.length
        ? [
            {
              channel: 'drawings:apply',
              input: {
                canvasId: transfer.source,
                action: 'move',
                targetCanvasId: target,
                targets: drawings.map(({ id, generation }) => ({
                  id,
                  generation,
                })),
              },
            },
          ]
        : []),
    ],
    mixed: drawings.length > 0,
  };
}
