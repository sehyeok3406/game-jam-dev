import type { KanbanCanvasPreferences } from './preferences';
export function KanbanControls({
  preferences: p,
  update,
  toggle,
  focus,
  manage,
  manageDisabled,
  reason,
}: {
  preferences: KanbanCanvasPreferences;
  update: (p: KanbanCanvasPreferences) => void;
  toggle: (enabled: boolean) => void;
  focus: () => void;
  manage: () => void;
  manageDisabled: boolean;
  reason?: string;
}) {
  return (
    <div className="kanban-controls">
      <label className="plugin-setting-row">
        <span>칸반 보드 활성화</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="칸반 보드 활성화"
          checked={p.enabled}
          onChange={(e) => toggle(e.target.checked)}
        />
      </label>
      {!p.enabled ? (
        <p className="plugin-control-description">
          활성화하면 이 캔버스에 보드가 표시됩니다. 저장된 위치와 설정을
          복원합니다.
        </p>
      ) : (
        <>
          <label className="plugin-setting-row">
            <span>표시할 문서</span>
            <select
              aria-label="칸반 문서 범위"
              value={p.scope}
              onChange={(e) =>
                update({ ...p, scope: e.target.value as 'canvas' | 'project' })
              }
            >
              <option value="canvas">현재 캔버스</option>
              <option value="project">프로젝트 전체</option>
            </select>
          </label>
          <label className="plugin-setting-row">
            <span>보드 최소화</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="칸반 보드 최소화"
              checked={p.minimized}
              onChange={(e) => update({ ...p, minimized: e.target.checked })}
            />
          </label>
          <button onClick={focus}>캔버스의 보드로 이동</button>
          <button disabled={manageDisabled} title={reason} onClick={manage}>
            상태·색·열 배경 관리
          </button>
          {reason && (
            <p role="status" className="plugin-control-description">
              {reason}
            </p>
          )}
        </>
      )}
    </div>
  );
}
