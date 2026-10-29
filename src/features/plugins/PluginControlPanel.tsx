import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowLeft,
  Columns3,
  Gamepad2,
  GripHorizontal,
  Puzzle,
  X,
} from 'lucide-react';
import {
  BUILTIN_CANVAS_FEATURES,
  type PluginPanelPage,
} from './builtin-features';
export type PluginPanelGeometry = {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
};
export const defaultPluginPanelGeometry: PluginPanelGeometry = {
  x: null,
  y: null,
  width: 480,
  height: 340,
};
export function PluginControlPanel({
  page,
  navigate,
  enabled,
  toggle,
  geometry,
  updateGeometry,
  children,
  close,
  canvasName,
  embedded = false,
}: {
  page: PluginPanelPage;
  navigate: (page: PluginPanelPage) => void;
  enabled: (id: PluginPanelPage) => boolean;
  toggle: (id: PluginPanelPage, enabled: boolean) => void;
  geometry: PluginPanelGeometry;
  updateGeometry: (g: PluginPanelGeometry) => void;
  children: ReactNode;
  close: () => void;
  canvasName: string;
  embedded?: boolean;
}) {
  const panel = useRef<HTMLElement>(null),
    header = useRef<HTMLElement>(null),
    latest = useRef(geometry),
    cleanup = useRef<(() => void) | null>(null);
  latest.current = geometry;
  const position = () => {
    const g = latest.current,
      dock = document.querySelector('.bottom-toolbar')?.getBoundingClientRect();
    const finite = (n: unknown, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? n : fallback;
    const width = Math.min(
        Math.max(320, finite(g.width, 480)),
        window.innerWidth - 16,
      ),
      height = Math.min(
        Math.max(230, finite(g.height, 340)),
        window.innerHeight - 24,
      );
    return {
      width,
      height,
      x: Math.max(
        8,
        Math.min(
          finite(
            g.x,
            (dock?.x ?? 0) + (dock?.width ?? window.innerWidth) / 2 - width / 2,
          ),
          window.innerWidth - width - 8,
        ),
      ),
      y: Math.max(
        8,
        Math.min(
          finite(g.y, (dock?.top ?? window.innerHeight - 100) - height - 12),
          window.innerHeight - height - 8,
        ),
      ),
    };
  };
  const box = position();
  useEffect(() => {
    header.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [page]);
  useEffect(() => {
    header.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const resize = () => {
      const b = position();
      if (panel.current) {
        Object.assign(panel.current.style, {
          left: `${b.x}px`,
          top: `${b.y}px`,
          width: `${b.width}px`,
          height: `${b.height}px`,
        });
      }
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cleanup.current?.();
      document
        .querySelector<HTMLButtonElement>('[data-plugin-launcher]')
        ?.focus();
    };
  }, []);
  return (
    <aside
      ref={panel}
      className="plugin-control-panel floating-surface nodrag nowheel"
      role="dialog"
      aria-label={
        page === 'plugins'
          ? '플러그인 관리'
          : BUILTIN_CANVAS_FEATURES.find((f) => f.id === page)?.name
      }
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      <header
        ref={header}
        className="plugin-control-header"
        onPointerDown={(e) => {
          if (
            embedded ||
            e.button !== 0 ||
            (e.target as Element).closest('button')
          )
            return;
          e.stopPropagation();
          const target = e.currentTarget,
            start = panel.current!.getBoundingClientRect(),
            px = e.clientX,
            py = e.clientY;
          target.setPointerCapture(e.pointerId);
          cleanup.current?.();
          const move = (event: PointerEvent) => {
            const x = Math.max(
                8,
                Math.min(
                  start.x + event.clientX - px,
                  window.innerWidth - start.width - 8,
                ),
              ),
              y = Math.max(
                8,
                Math.min(
                  start.y + event.clientY - py,
                  window.innerHeight - start.height - 8,
                ),
              );
            if (panel.current)
              Object.assign(panel.current.style, {
                left: `${x}px`,
                top: `${y}px`,
              });
          };
          const end = () => {
            cleanup.current?.();
            cleanup.current = null;
            const r = panel.current?.getBoundingClientRect();
            if (r) updateGeometry({ ...latest.current, x: r.x, y: r.y });
          };
          cleanup.current = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', end);
            target.removeEventListener('pointercancel', end);
          };
          target.addEventListener('pointermove', move);
          target.addEventListener('pointerup', end);
          target.addEventListener('pointercancel', end);
        }}
      >
        {page !== 'plugins' && (
          <button
            className="icon-button"
            aria-label="플러그인 관리로 뒤로가기"
            title="뒤로가기"
            onClick={() => navigate('plugins')}
          >
            <ArrowLeft size={17} />
          </button>
        )}
        <strong>
          {page === 'plugins'
            ? '플러그인 관리'
            : BUILTIN_CANVAS_FEATURES.find((f) => f.id === page)?.name}
        </strong>
        {!embedded && (
          <GripHorizontal size={16} className="plugin-panel-grip" />
        )}
        {!embedded && (
          <button
            className="icon-button"
            aria-label="플러그인 패널 닫기"
            onClick={close}
          >
            <X size={17} />
          </button>
        )}
      </header>
      <div className="plugin-control-content">
        <small className="plugin-current-canvas">
          {canvasName} · 개인 보기
        </small>
        {page === 'plugins' ? (
          <>
            <p className="plugin-control-description">
              캔버스에서 사용할 기본 플러그인을 선택하세요.
            </p>
            {BUILTIN_CANVAS_FEATURES.map((feature) => (
              <div key={feature.id} className="builtin-feature-row">
                {feature.id === 'builtin.game-ui' ? (
                  <Gamepad2 size={23} />
                ) : (
                  <Columns3 size={23} />
                )}
                <button
                  className="builtin-feature-open"
                  onClick={() => navigate(feature.id)}
                >
                  <strong>{feature.name}</strong>
                  <span>{feature.description}</span>
                </button>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`${feature.name} 활성화`}
                  checked={enabled(feature.id)}
                  onChange={(e) => toggle(feature.id, e.target.checked)}
                />
              </div>
            ))}
            <div className="plugin-built-in-note">
              <Puzzle size={15} />
              <span>기본 제공 플러그인</span>
            </div>
          </>
        ) : (
          children
        )}
      </div>
      {!embedded && (
        <button
          className="plugin-panel-resize"
          aria-label="플러그인 패널 크기 조절"
          title="끌어서 크기 조절 · 방향키로 크기 조절"
          onKeyDown={(e) => {
            if (
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            updateGeometry({
              x: box.x,
              y: box.y,
              width: Math.max(
                320,
                Math.min(
                  window.innerWidth - box.x - 8,
                  box.width +
                    (e.key === 'ArrowRight'
                      ? 20
                      : e.key === 'ArrowLeft'
                        ? -20
                        : 0),
                ),
              ),
              height: Math.max(
                230,
                Math.min(
                  window.innerHeight - box.y - 8,
                  box.height +
                    (e.key === 'ArrowDown'
                      ? 20
                      : e.key === 'ArrowUp'
                        ? -20
                        : 0),
                ),
              ),
            });
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const target = e.currentTarget,
              start = panel.current!.getBoundingClientRect(),
              px = e.clientX,
              py = e.clientY;
            target.setPointerCapture(e.pointerId);
            cleanup.current?.();
            const move = (event: PointerEvent) => {
              if (panel.current)
                Object.assign(panel.current.style, {
                  width: `${Math.max(320, Math.min(window.innerWidth - start.x - 8, start.width + event.clientX - px))}px`,
                  height: `${Math.max(230, Math.min(window.innerHeight - start.y - 8, start.height + event.clientY - py))}px`,
                });
            };
            const end = () => {
              cleanup.current?.();
              cleanup.current = null;
              const r = panel.current?.getBoundingClientRect();
              if (r)
                updateGeometry({
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                });
            };
            cleanup.current = () => {
              target.removeEventListener('pointermove', move);
              target.removeEventListener('pointerup', end);
              target.removeEventListener('pointercancel', end);
            };
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', end);
            target.addEventListener('pointercancel', end);
          }}
        >
          <GripHorizontal size={14} />
        </button>
      )}
    </aside>
  );
}
