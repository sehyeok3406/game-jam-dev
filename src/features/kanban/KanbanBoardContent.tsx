import { useRef, useState, type CSSProperties } from 'react';
import {
  workflowId,
  workflowCompare,
  statusForeground,
  type DocumentStatuses,
} from '../../document-statuses';
import { DocumentStatusBadge } from '../../ui/DocumentStatusBadge';
export type KanbanDocument = {
  id: string;
  title: string;
  kind: string;
  canvasId?: string;
  canvasName?: string;
  sectionName?: string;
  workflowStatusId?: string;
  workflowOrder?: number;
  locked: boolean;
};
export type KanbanBoardProps = {
  documents: KanbanDocument[];
  statuses: DocumentStatuses;
  activeCanvas: string;
  scope: 'canvas' | 'project';
  move: (
    doc: KanbanDocument,
    statusId: string,
    beforeId?: string,
    afterId?: string,
  ) => Promise<void>;
  open: (id: string) => void;
  manage: () => void;
  editable: boolean;
  busy: boolean;
  reason?: string;
};
export function KanbanBoardContent({
  documents,
  statuses,
  activeCanvas,
  scope,
  move,
  open,
  manage,
  editable,
  busy,
  reason,
}: KanbanBoardProps) {
  const [query, setQuery] = useState(''),
    [error, setError] = useState('');
  const drag = useRef<string | null>(null);
  const apply = async (
    d: KanbanDocument,
    id: string,
    before?: string,
    after?: string,
  ) => {
    setError('');
    try {
      await move(d, id, before, after);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const scoped = documents.filter(
    (d) => scope === 'project' || (d.canvasId ?? 'default') === activeCanvas,
  );
  const visible = scoped.filter((d) =>
    d.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const statusesWithUnknown = [...statuses.statuses];
  if (
    scoped.some((d) => !statuses.statuses.some((s) => s.id === workflowId(d)))
  )
    statusesWithUnknown.push({
      id: '__unknown__',
      name: '알 수 없는 상태',
      badgeColor: '#6B7280',
      boardBackground: { mode: 'none' },
    });
  return (
    <div
      className="kanban-board-content nodrag nowheel"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <>
        <input
          className="kanban-search"
          aria-label="칸반 문서 제목 검색"
          placeholder="문서 제목 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!scoped.length && (
          <p className="kanban-empty">
            이 범위에 문서가 없습니다. 메모를 만들거나 파일을 불러오세요.
          </p>
        )}
        <div className="kanban-columns">
          {statusesWithUnknown.map((s) => {
            const matches = (d: KanbanDocument) =>
              s.id === '__unknown__'
                ? !statuses.statuses.some((n) => n.id === workflowId(d))
                : workflowId(d) === s.id;
            const cards = visible.filter(matches).sort(workflowCompare),
              all = scoped.filter(matches).length;
            const custom =
              s.boardBackground.mode === 'custom'
                ? s.boardBackground.color
                : undefined;
            return (
              <div
                key={s.id}
                className="kanban-column"
                style={
                  {
                    '--column-color': s.badgeColor,
                    ...(custom
                      ? {
                          backgroundColor: custom,
                          color: statusForeground(custom),
                        }
                      : {}),
                  } as CSSProperties
                }
                data-background={s.boardBackground.mode}
                onDragOver={(e) => {
                  if (editable && !busy && s.id !== '__unknown__') {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const doc = documents.find((d) => d.id === drag.current);
                  drag.current = null;
                  if (doc && !doc.locked && s.id !== '__unknown__')
                    void apply(doc, s.id);
                }}
              >
                <h3>
                  <span
                    className="kanban-status-dot"
                    style={{ backgroundColor: s.badgeColor }}
                  />
                  {s.name}
                  <small>{query ? `${cards.length}/${all}` : all}</small>
                </h3>
                <div className="kanban-card-list">
                  {cards.map((d, index) => (
                    <article
                      key={d.id}
                      className="kanban-card"
                      draggable={editable && !busy && !d.locked}
                      onDragStart={(e) => {
                        drag.current = d.id;
                        e.dataTransfer.setData('text/plain', d.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        drag.current = null;
                      }}
                      onDrop={(e) => {
                        if (query || s.id === '__unknown__') return;
                        e.preventDefault();
                        e.stopPropagation();
                        const doc = documents.find(
                          (n) => n.id === drag.current,
                        );
                        drag.current = null;
                        if (doc && !doc.locked && doc.id !== d.id)
                          void apply(doc, s.id, d.id);
                      }}
                    >
                      <button
                        className="kanban-card-title"
                        onClick={() => open(d.id)}
                      >
                        {d.title}
                      </button>
                      <small>
                        {d.kind}
                        {scope === 'project' ? ` · ${d.canvasName}` : ''}
                        {d.sectionName ? ` · ${d.sectionName}` : ''}
                        {d.locked ? ' · 잠금' : ''}
                      </small>
                      <div className="kanban-card-actions">
                        <DocumentStatusBadge
                          document={d}
                          statuses={statuses}
                          disabled={!editable || busy || d.locked}
                          reason={
                            d.locked ? 'AI 작업이 보호하는 문서입니다.' : reason
                          }
                          change={(id) => void apply(d, id)}
                          manage={manage}
                        />

                        <button
                          aria-label={`${d.title} 위로 이동`}
                          disabled={
                            !editable ||
                            busy ||
                            d.locked ||
                            !!query ||
                            index === 0 ||
                            s.id === '__unknown__'
                          }
                          onClick={() =>
                            void apply(d, s.id, cards[index - 1].id)
                          }
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`${d.title} 아래로 이동`}
                          disabled={
                            !editable ||
                            busy ||
                            d.locked ||
                            !!query ||
                            index === cards.length - 1 ||
                            s.id === '__unknown__'
                          }
                          onClick={() =>
                            void apply(d, s.id, undefined, cards[index + 1].id)
                          }
                        >
                          ↓
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </>
      {busy && (
        <p role="status" className="kanban-save-state">
          상태 저장 중…
        </p>
      )}
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
    </div>
  );
}
