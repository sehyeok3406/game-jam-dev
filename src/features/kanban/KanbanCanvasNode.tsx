import {
  NodeResizeControl,
  NodeResizer,
  type Node,
  type NodeProps,
  type OnResizeEnd,
} from '@xyflow/react';
import { GripHorizontal, Maximize2, Minimize2, Settings2 } from 'lucide-react';
import { kanbanSizeLimits, type KanbanCanvasPreferences } from './preferences';
import {
  KanbanBoardContent,
  type KanbanBoardProps,
} from './KanbanBoardContent';
export type KanbanCanvasData = KanbanBoardProps & {
  kind: 'kanban';
  locked: boolean;
  canvasId: string;
  preferences: KanbanCanvasPreferences;
  update: (value: KanbanCanvasPreferences) => void;
  controls: () => void;
};
export type KanbanCanvasNode = Node<KanbanCanvasData, 'kanban'>;
export function KanbanNode({ data, selected }: NodeProps<KanbanCanvasNode>) {
  const p = data.preferences;
  const count = data.documents.filter(
    (d) => p.scope === 'project' || (d.canvasId ?? 'default') === data.canvasId,
  ).length;
  const saveSize: OnResizeEnd = (_event, bounds) =>
    data.update({
      ...p,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      placed: true,
    });
  return (
    <>
      <NodeResizer
        isVisible={selected && !p.minimized}
        {...kanbanSizeLimits}
        color="var(--selection)"
        lineClassName="window-resize-edge"
        handleClassName="window-resize-handle"
        onResizeEnd={saveSize}
      />
      {!p.minimized && (
        <NodeResizeControl
          position="bottom-right"
          className="kanban-resize-grip nowheel"
          {...kanbanSizeLimits}
          onResizeEnd={saveSize}
        >
          <span
            title="드래그하여 칸반 보드 크기 조절"
            aria-label="칸반 크기 조절"
          >
            <GripHorizontal size={18} aria-hidden="true" />
          </span>
        </NodeResizeControl>
      )}
      <section
        className={`kanban-canvas-node${p.minimized ? ' kanban-canvas-node--minimized' : ''}`}
        aria-label="캔버스 칸반 보드"
      >
        <header className="kanban-drag-handle">
          <strong>칸반 보드</strong>
          <select
            className="kanban-scope-select nodrag nowheel"
            aria-label="칸반 문서 범위"
            title="보드에 표시할 문서 범위"
            value={p.scope}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) =>
              data.update({
                ...p,
                scope: e.target.value as 'canvas' | 'project',
              })
            }
          >
            <option value="canvas">현재 캔버스 문서</option>
            <option value="project">프로젝트 전체 문서</option>
          </select>
          <span>{count}개 문서</span>
          <div className="kanban-node-actions nodrag">
            <button
              className="icon-button"
              title="칸반 컨트롤 열기"
              aria-label="칸반 컨트롤 열기"
              onClick={data.controls}
            >
              <Settings2 size={15} />
            </button>
            <button
              className="icon-button"
              title={p.minimized ? '칸반 펼치기' : '칸반 최소화'}
              aria-label={p.minimized ? '칸반 펼치기' : '칸반 최소화'}
              onClick={() => data.update({ ...p, minimized: !p.minimized })}
            >
              {p.minimized ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
            </button>
          </div>
        </header>
        {!p.minimized && <KanbanBoardContent {...data} scope={p.scope} />}
      </section>
    </>
  );
}
