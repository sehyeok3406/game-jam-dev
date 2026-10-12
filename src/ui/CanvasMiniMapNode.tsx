import { useNodesData, type MiniMapNodeProps } from '@xyflow/react';
import { cardColor } from '../card-colors';
import type { CanvasDocument, CanvasSection, PreviewResult } from '../shared';

export function CanvasMiniMapNode(props: MiniMapNodeProps) {
  const node = useNodesData(props.id);
  const data = node?.data as
    | {
        kind?: 'document' | 'section' | 'preview' | 'drawing' | 'kanban';
        object?: import('../drawing-types').DrawingObject;
        document?: CanvasDocument;
        sectionHidden?: boolean;
        section?: CanvasSection;
        preview?: PreviewResult;
      }
    | undefined;
  const color = cardColor(
    data?.document?.backgroundColor ?? data?.preview?.backgroundColor,
  );
  const kind = data?.kind ?? 'document';
  const visualKind =
    kind === 'document'
      ? data?.document?.type === 'idea'
        ? 'note'
        : 'file'
      : kind === 'preview'
        ? 'html'
        : kind;
  if (data?.sectionHidden) return null;
  return (
    <rect
      className={`react-flow__minimap-node canvas-minimap-node canvas-minimap-node--${kind}${props.selected ? ' is-selected' : ''}`}
      data-node-id={props.id}
      data-card-color={color}
      data-minimap-kind={visualKind}
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      rx={props.borderRadius}
      ry={props.borderRadius}
      strokeWidth={props.selected ? 2.5 : 1.3}
      vectorEffect="non-scaling-stroke"
      shapeRendering={props.shapeRendering}
      style={{
        strokeWidth: props.selected ? 2.5 : 1.3,
        fill:
          kind === 'drawing'
            ? (data?.object?.style.stroke ?? 'var(--minimap-node-fill)')
            : color !== 'default'
              ? 'color-mix(in srgb, var(--swatch) 85%, var(--minimap-node-fill))'
              : 'var(--minimap-node-fill)',
        stroke: props.selected
          ? 'var(--minimap-selected)'
          : 'var(--minimap-node-stroke)',
      }}
      onClick={(event) => props.onClick?.(event, props.id)}
    />
  );
}
