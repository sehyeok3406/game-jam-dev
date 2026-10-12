import { useRef, useState, type CSSProperties } from 'react';
import {
  workflowId,
  workflowCompare,
  statusForeground,
  type DocumentStatuses,
} from '../../document-statuses';
import type { KanbanPreferences } from './preferences';
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
export function KanbanPanel({
  documents,
  statuses,
  activeCanvas,
  preferences: p,
  update,
  move,
  open,
  manage,
  editable,
  busy,
}: {
  documents: KanbanDocument[];
  statuses: DocumentStatuses;
  activeCanvas: string;
  preferences: KanbanPreferences;
  update: (p: KanbanPreferences) => void;
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
}) {
  const [query, setQuery] = useState(''),
    [error, setError] = useState('');
  const panel = useRef<HTMLElement>(null),
    drag = useRef<string | null>(null);
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
    (d) => p.scope === 'project' || (d.canvasId ?? 'default') === activeCanvas,
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
    <section
      ref={panel}
      className={`kanban-panel floating-surface${p.minimized ? ' kanban-panel--minimized' : ''}`}
      aria-label="칸반 보드"
      style={{
        left: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - 320)),
        top: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - 50)),
        width: Math.min(p.width, window.innerWidth - 16),
        height: p.minimized
          ? 'auto'
          : Math.min(p.height, window.innerHeight - 100),
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerUp={() => {
        if (!p.minimized && panel.current) {
          const r = panel.current.getBoundingClientRect();
          if (
            Math.abs(r.width - p.width) > 2 ||
            Math.abs(r.height - p.height) > 2
          )
            update({ ...p, width: r.width, height: r.height });
        }
      }}
    >
      <header
        className="kanban-header"
        onPointerDown={(e) => {
          if (
            (e.target as HTMLElement).closest('button,input,select') ||
            e.button !== 0
          )
            return;
          const target = e.currentTarget,
            x = e.clientX,
            y = e.clientY;
          target.setPointerCapture(e.pointerId);
          const moving = (event: PointerEvent) => {
            if (panel.current) {
              panel.current.style.left = `${Math.max(0, Math.min(window.innerWidth - 320, p.x + event.clientX - x))}px`;
              panel.current.style.top = `${Math.max(0, Math.min(window.innerHeight - 50, p.y + event.clientY - y))}px`;
            }
          };
          const end = () => {
            target.removeEventListener('pointermove', moving);
            target.removeEventListener('pointerup', end);
            target.removeEventListener('pointercancel', end);
            const r = panel.current?.getBoundingClientRect();
            if (r) update({ ...p, x: r.x, y: r.y });
          };
          target.addEventListener('pointermove', moving);
          target.addEventListener('pointerup', end);
          target.addEventListener('pointercancel', end);
        }}
      >
        <strong>칸반 보드</strong>
        <span>{scoped.length}개 문서</span>
        <select
          aria-label="보드 범위"
          value={p.scope}
          onChange={(e) =>
            update({ ...p, scope: e.target.value as 'canvas' | 'project' })
          }
        >
          <option value="canvas">현재 캔버스</option>
          <option value="project">프로젝트 전체</option>
        </select>
        <button disabled={!editable || busy} onClick={manage}>
          상태 관리
        </button>
        <button
          aria-label={p.minimized ? '칸반 펼치기' : '칸반 최소화'}
          onClick={() => update({ ...p, minimized: !p.minimized })}
        >
          {p.minimized ? '펼치기' : '최소화'}
        </button>
        <button onClick={() => update({ ...p, enabled: false })}>
          비활성화
        </button>
      </header>
      {!p.minimized && (
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
                          {p.scope === 'project' ? ` · ${d.canvasName}` : ''}
                          {d.sectionName ? ` · ${d.sectionName}` : ''}
                          {d.locked ? ' · 잠금' : ''}
                        </small>
                        <div className="kanban-card-actions">
                          <select
                            aria-label={`${d.title} 상태 변경`}
                            disabled={!editable || busy || d.locked}
                            value={workflowId(d)}
                            onChange={(e) => void apply(d, e.target.value)}
                          >
                            {!statuses.statuses.some(
                              (n) => n.id === workflowId(d),
                            ) && (
                              <option value={workflowId(d)}>
                                알 수 없는 상태
                              </option>
                            )}
                            {statuses.statuses.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.name}
                              </option>
                            ))}
                          </select>
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
                              void apply(
                                d,
                                s.id,
                                undefined,
                                cards[index + 1].id,
                              )
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
      )}
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
    </section>
  );
}
