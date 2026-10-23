import { useEffect, useRef, useState } from 'react';
import type { AppApi } from '../contracts/app-api.ts';
import type {
  ProjectCopyRequest,
  ProjectCopyTarget,
  ProjectCopyResult,
} from '../contracts/project-copy.ts';
import type { ProjectEntry } from '../contracts/project.ts';
import { requireDesktopApi } from './runtime/desktop-api.ts';

export function ProjectCopyDialog({
  api,
  request,
  flush,
  onClose,
  onOpen,
}: {
  api: AppApi;
  request: Omit<ProjectCopyRequest, 'targetId' | 'canvasId' | 'requestId'>;
  flush(): Promise<void>;
  onClose(): void;
  onOpen(id: string): Promise<void>;
}) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]),
    [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState(''),
    [target, setTarget] = useState<ProjectCopyTarget | null>(null),
    [canvasId, setCanvasId] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [done, setDone] = useState<ProjectCopyResult | null>(null);
  const mounted = useRef(false),
    running = useRef(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    void api.projects
      .listProjects()
      .then((items) => {
        if (live) setProjects(items.filter((item) => !item.current));
      })
      .catch((e) => {
        if (live) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [api]);
  useEffect(() => {
    let live = true;
    setTarget(null);
    setCanvasId('');
    setError('');
    if (targetId) {
      setLoading(true);
      void requireDesktopApi(api)
        .getProjectCopyTarget(targetId)
        .then((value) => {
          if (live) {
            setTarget(value);
            setCanvasId(value.sheets.canvases[0]?.id ?? '');
          }
        })
        .catch((e) => {
          if (live) setError(String(e.message ?? e));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }
    return () => {
      live = false;
    };
  }, [api, targetId]);
  const copy = async () => {
    if (running.current || !target || !canvasId) return;
    running.current = true;
    setBusy(true);
    setError('');
    const key = `${targetId}:${canvasId}`;
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    try {
      await flush();
      if (!mounted.current) return;
      const value = await requireDesktopApi(api).copySelectionToProject({
        ...request,
        targetId,
        canvasId,
        requestId: attempt.current.id,
      });
      if (mounted.current) setDone(value);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const selection = request.selection;
  return (
    <div
      data-ui-id="project-copy"
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="canvas-sheet-dialog floating-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-copy-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <h2 id="project-copy-title">다른 프로젝트로 복사</h2>
        <p>
          파일 {selection.documents.length} · HTML {selection.previews.length} ·
          섹션 {selection.sections.length} · 그림/텍스트{' '}
          {selection.drawings.length}
        </p>
        <p>
          섹션 내부 자료와 이미지·HTML 관련 파일도 함께 복사합니다. 원본은
          유지됩니다.
        </p>
        {!done && (
          <>
            <label>
              프로젝트 검색
              <input
                aria-label="프로젝트 검색"
                autoFocus
                value={search}
                disabled={busy}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              대상 프로젝트
              <select
                aria-label="대상 프로젝트"
                value={targetId}
                disabled={busy}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">프로젝트 선택</option>
                {projects
                  .filter(
                    (item) =>
                      item.id === targetId ||
                      `${item.name} ${item.root ?? ''}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={
                        item.role === 'viewer' ||
                        (item.lifecycle && item.lifecycle.status !== 'active')
                      }
                    >
                      {item.name} ·{' '}
                      {item.kind === 'local'
                        ? `로컬 · ${item.root ?? ''}`
                        : `공유 · ${item.serverUrl ?? ''}`}{' '}
                      {item.role === 'viewer' ? '(읽기 전용)' : ''}
                    </option>
                  ))}
              </select>
            </label>
            {!loading && !projects.length && (
              <p>
                복사할 다른 프로젝트가 없습니다. 홈에서 프로젝트를 추가해주세요.
              </p>
            )}
            {target && (
              <label>
                대상 캔버스
                <select
                  aria-label="대상 캔버스"
                  value={canvasId}
                  disabled={busy}
                  onChange={(e) => setCanvasId(e.target.value)}
                >
                  {target.sheets.canvases.map((sheet) => (
                    <option key={sheet.id} value={sheet.id}>
                      {sheet.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <small>
              선택 밖 문서 연결은 원본 출처 텍스트로 보존합니다. 대상에 없는
              진행 상태는 기본 상태로 지정됩니다.
            </small>
          </>
        )}
        {loading && <p role="status">프로젝트 정보를 확인하는 중…</p>}
        {busy && <p role="status">자료와 관련 파일을 복사하는 중…</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {done && (
          <>
            <p role="status">
              {target?.name}에 {done.count}개 항목을 복사했습니다.
            </p>
            {done.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {done ? '닫기' : '취소'}
          </button>
          {done ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onOpen(targetId).catch((e) => {
                  if (mounted.current) {
                    setError(
                      `복사는 완료됐지만 프로젝트를 열지 못했습니다: ${String(e.message ?? e)}`,
                    );
                    setBusy(false);
                  }
                });
              }}
            >
              대상 프로젝트 열기
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={busy || loading || !target || !canvasId}
              onClick={() => void copy()}
            >
              복사
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
