import type { KanbanCanvasPreferences } from './preferences';
import type { ReactNode } from 'react';
export function KanbanControls({
  preferences: p,
  update,
  toggle,
  focus,
  manage,
  appearance,
  manageDisabled,
  reason,
  activationEnabled,
  visibilityPicker,
}: {
  preferences: KanbanCanvasPreferences;
  update: (p: KanbanCanvasPreferences) => void;
  toggle: (enabled: boolean) => void;
  focus: () => void;
  manage: () => void;
  appearance: () => void;
  manageDisabled: boolean;
  reason?: string;
  activationEnabled: boolean;
  visibilityPicker: ReactNode;
}) {
  return (
    <div className="kanban-controls">
      <label className="plugin-setting-row">
        <span>칸반 보드 활성화</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="칸반 보드 활성화"
          checked={activationEnabled}
          onChange={(e) => toggle(e.target.checked)}
        />
      </label>
      <div className="plugin-setting-row">
        <span>보드를 표시할 캔버스</span>
        {visibilityPicker}
      </div>
      {!activationEnabled ? (
        <p className="plugin-control-description">
          활성화하면 선택한 캔버스에 보드가 표시됩니다. 저장된 위치와 설정을
          복원합니다.
        </p>
      ) : (
        <>
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
          <button disabled={!p.enabled} onClick={focus}>
            캔버스의 보드로 이동
          </button>
          <button disabled={manageDisabled} title={reason} onClick={manage}>
            상태 옵션·색 관리
          </button>
          <button disabled={manageDisabled} title={reason} onClick={appearance}>
            열 배경 관리
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
