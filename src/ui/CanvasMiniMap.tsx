import { useEffect, useRef, useState } from 'react';
import { MiniMap, Panel } from '@xyflow/react';
import { Settings2, X } from 'lucide-react';
import { CanvasMiniMapNode } from './CanvasMiniMapNode';
import {
  defaultMiniMapPreferences,
  type MiniMapPreferences,
} from './minimap-preferences';

export function CanvasMiniMap({
  theme,
  preferences,
  change,
  previewOpen = false,
}: {
  theme: 'light' | 'dark';
  preferences: MiniMapPreferences;
  change: (p: MiniMapPreferences) => void;
  previewOpen?: boolean;
}) {
  const [open, setOpen] = useState(previewOpen),
    trigger = useRef<HTMLButtonElement>(null),
    settings = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open)
      settings.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [open]);
  return (
    <Panel
      position="bottom-right"
      className="canvas-minimap-panel nodrag nowheel"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <header>
        <span>미니맵</span>
        <button
          ref={trigger}
          className="icon-button"
          aria-label="미니맵 설정"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Settings2 size={14} />
        </button>
      </header>
      <MiniMap
        ariaLabel="캔버스 미니맵"
        position="bottom-right"
        pannable
        zoomable
        nodeComponent={CanvasMiniMapNode}
        style={{
          position: 'relative',
          opacity: 1 - preferences.transparency / 100,
        }}
        bgColor={theme === 'dark' ? '#1c2430' : '#f5f7fb'}
        maskColor={
          theme === 'dark'
            ? `rgba(0,0,0,${preferences.shade / 100})`
            : `rgba(85,102,127,${preferences.shade / 100})`
        }
        maskStrokeColor={theme === 'dark' ? '#b4c6ec' : '#4f62a5'}
        maskStrokeWidth={1.5}
      />
      {open && (
        <div
          ref={settings}
          className="minimap-settings floating-surface"
          role="dialog"
          aria-label="미니맵 보기 설정"
        >
          <div>
            <strong>미니맵 보기</strong>
            <button
              className="icon-button"
              aria-label="미니맵 설정 닫기"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          </div>
          <label>
            미니맵 투명도 <output>{preferences.transparency}%</output>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              aria-label="미니맵 투명도"
              value={preferences.transparency}
              onChange={(e) =>
                change({ ...preferences, transparency: Number(e.target.value) })
              }
            />
          </label>
          <label>
            화면 밖 음영 <output>{preferences.shade}%</output>
            <input
              type="range"
              min={0}
              max={60}
              step={2}
              aria-label="미니맵 화면 밖 음영"
              value={preferences.shade}
              onChange={(e) =>
                change({ ...preferences, shade: Number(e.target.value) })
              }
            />
          </label>
          <small>0% 투명도는 선명하게 표시합니다.</small>
          <button onClick={() => change(defaultMiniMapPreferences)}>
            기본값으로 복원
          </button>
        </div>
      )}
    </Panel>
  );
}
