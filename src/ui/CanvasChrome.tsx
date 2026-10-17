import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { X } from 'lucide-react';
import type { ReactFlowInstance } from '@xyflow/react';

export type CanvasPanelId =
  | 'properties'
  | 'ai'
  | 'collaboration'
  | 'activity'
  | 'plugins'
  | 'navigation'
  | 'settings';
const tabs = [
  ['properties', '속성'],
  ['ai', 'AI 작업'],
  ['collaboration', '협업'],
  ['activity', '활동'],
] as const;

export function useCanvasRegions(
  home: boolean,
  flow: RefObject<Pick<
    ReactFlowInstance,
    'getViewport' | 'setViewport'
  > | null>,
) {
  useEffect(() => {
    if (home) return;
    const canvas = document.querySelector('.canvas-shell');
    if (!canvas) return;
    let previous = canvas.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = canvas.getBoundingClientRect();
      if (
        flow.current &&
        previous.width &&
        previous.height &&
        (next.width !== previous.width || next.height !== previous.height)
      ) {
        const view = flow.current.getViewport();
        void flow.current.setViewport({
          ...view,
          x: view.x + (next.width - previous.width) / 2,
          y: view.y + (next.height - previous.height) / 2,
        });
      }
      previous = next;
    });
    observer.observe(canvas);
    const menus =
      '.canvas-main-menu, .canvas-zoom-menu, .canvas-tool-more, .canvas-drawing-group, .drawing-tool-menu';
    const outside = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>(menus).forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.open = false;
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const open = [
        ...document.querySelectorAll<HTMLDetailsElement>(menus),
      ].filter((m) => m.open);
      if (!open.length) return;
      event.preventDefault();
      event.stopPropagation();
      open.forEach((menu) => {
        menu.open = false;
      });
      open.at(-1)?.querySelector('summary')?.focus();
    };
    const choose = (event: MouseEvent) => {
      const target = event.target as Element;
      if (
        target.closest(
          '.canvas-main-menu button, .canvas-tool-more button, .canvas-zoom-menu button',
        ) ||
        (target.closest('.canvas-drawing-group button') &&
          !target.closest('.drawing-eraser-menu'))
      ) {
        target.closest('details')?.removeAttribute('open');
      }
    };
    document.addEventListener('click', choose);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', choose);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [home, flow]);
}

// Closing one legacy view must not close a different view opened by the same action.
export function useCanvasPanel() {
  const [panel, setPanel] = useState<CanvasPanelId | null>(null);
  const scope = useRef<string | null>(null);
  const restoreScope = useCallback((next: string | null) => {
    if (scope.current === next) return;
    scope.current = next;
    let saved: CanvasPanelId | null = null;
    try {
      const value = next ? localStorage.getItem('gamejam:panel:' + next) : null;
      if (
        [
          'properties',
          'ai',
          'collaboration',
          'activity',
          'plugins',
          'settings',
        ].includes(value ?? '')
      )
        saved = value as CanvasPanelId;
    } catch {
      /* Personal layout storage is optional. */
    }
    setPanel(saved);
  }, []);
  useEffect(() => {
    if (!scope.current) return;
    try {
      localStorage.setItem('gamejam:panel:' + scope.current, panel ?? '');
    } catch {
      /* Keep the current layout usable. */
    }
  }, [panel]);
  const setHistoryOpen = useCallback(
    (open: boolean) =>
      setPanel((p) => (open ? 'activity' : p === 'activity' ? null : p)),
    [],
  );
  const setSettingsOpen = useCallback(
    (open: boolean) =>
      setPanel((p) => (open ? 'settings' : p === 'settings' ? null : p)),
    [],
  );
  const setPluginPanelOpen = useCallback(
    (open: boolean) =>
      setPanel((p) => (open ? 'plugins' : p === 'plugins' ? null : p)),
    [],
  );
  return {
    panel,
    setPanel,
    setHistoryOpen,
    setSettingsOpen,
    setPluginPanelOpen,
    restoreScope,
  };
}

export function CanvasPanel({
  active,
  change,
  close,
  children,
}: {
  active: CanvasPanelId;
  change: (id: CanvasPanelId) => void;
  close: () => void;
  children: ReactNode;
}) {
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    origin.current = document.activeElement as HTMLElement | null;
    return () => {
      if (origin.current?.isConnected) origin.current.focus();
    };
  }, []);
  return (
    <aside
      className="canvas-dock"
      aria-label="작업 패널"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !(event.target as HTMLElement).closest(
            'input, textarea, [contenteditable="true"], [role="menu"]',
          )
        ) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="canvas-dock__header">
        <nav aria-label="작업 패널 보기">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={active === id}
              onClick={() => change(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className="icon-button"
          aria-label="작업 패널 닫기"
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <div className="canvas-dock__body">{children}</div>
    </aside>
  );
}
