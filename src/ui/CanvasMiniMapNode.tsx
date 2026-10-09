import { useNodesData, type MiniMapNodeProps } from '@xyflow/react';
import { cardColor } from '../card-colors';
import type { CanvasDocument, CanvasSection, PreviewResult } from '../shared';

export function CanvasMiniMapNode(props: MiniMapNodeProps) {
  const node = useNodesData(props.id);
  const data = node?.data as
    | {
        kind?: 'document' | 'section' | 'preview';
        document?: CanvasDocument;
        section?: CanvasSection;
        preview?: PreviewResult;
      }
    | undefined;
  const color = cardColor(
    data?.document?.backgroundColor ?? data?.preview?.backgroundColor,
  );
  const kind = data?.kind ?? 'document';
  return (
    <rect
      className={`react-flow__minimap-node canvas-minimap-node canvas-minimap-node--${kind}${props.selected ? ' is-selected' : ''}`}
      data-node-id={props.id}
      data-card-color={color}
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      rx={props.borderRadius}
      ry={props.borderRadius}
      strokeWidth={props.selected ? 4 : 2}
      shapeRendering={props.shapeRendering}
      onClick={(event) => props.onClick?.(event, props.id)}
    />
  );
}
