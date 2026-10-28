import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { Frame, Folder, Maximize2, Minimize2 } from 'lucide-react';
import type { CanvasSection } from '../../contracts/canvas';
import { useRuntime } from '../runtime/RuntimeProvider';

type SectionNodeData = {
  collapsed: boolean;
  onCollapse: () => void;
  kind: 'section';
  locked: boolean;
  section: CanvasSection;
  onResize: (
    section: CanvasSection,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<void>;
  onReveal: (section: CanvasSection) => Promise<void>;
};

export type SectionCanvasNode = Node<SectionNodeData, 'section'>;

const SectionCardContent = memo(function SectionCardContent({
  data,
  selected,
}: Pick<NodeProps<SectionCanvasNode>, 'data' | 'selected'>) {
  const { section } = data;
  const { capabilities } = useRuntime();
  return (
    <section
      className={`section-card${data.collapsed ? ' section-card--collapsed' : ''}`}
    >
      <NodeResizer
        color="var(--selection)"
        isVisible={selected && !data.locked && !data.collapsed}
        lineClassName="window-resize-edge"
        handleClassName="window-resize-handle"
        minWidth={420}
        minHeight={280}
        onResizeEnd={(_event, params) => {
          void data.onResize(
            section,
            params.x,
            params.y,
            params.width,
            params.height,
          );
        }}
      />
      <header className="section-card__header">
        <div
          className="section-card__title"
          data-find-section={`section:${data.section.id}`}
        >
          <Frame size={15} />
          <strong>{section.title}</strong>
          <span>{section.members.length}개 파일</span>
        </div>
        <div className="section-card__file">
          <button
            type="button"
            className="nodrag"
            aria-expanded={!data.collapsed}
            title={data.collapsed ? '섹션 펼치기' : '섹션 최소화'}
            onClick={data.onCollapse}
          >
            {data.collapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          <code>{section.relativePath}</code>
          <button
            type="button"
            className="nodrag"
            onClick={() => void data.onReveal(section)}
            disabled={!capabilities.localFiles}
            title="섹션 Markdown 파일 보기"
          >
            <Folder size={13} />
          </button>
        </div>
      </header>
      <div className="section-card__empty-hint">
        섹션을 선택하면 내부 파일 전체를 AI 작업 범위로 사용할 수 있습니다.
      </div>
    </section>
  );
});

// Position and dragging belong to React Flow; content receives only its own inputs.
export function SectionCard({ data, selected }: NodeProps<SectionCanvasNode>) {
  return <SectionCardContent data={data} selected={selected} />;
}
