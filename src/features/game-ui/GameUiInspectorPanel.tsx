import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { usePersonalValue } from '../kanban/preferences';
import { GameUiTextField } from './GameUiFields';

type Dock = {
  embedded?: boolean;
  active: string | null;
  root: HTMLDivElement | null;
  open: (id: string) => void;
  close: (id: string) => void;
  preferences: { width: number; floating: boolean; x: number; y: number };
  savePreferences: (value: Dock['preferences']) => void;
};
const defaultPreferences = { width: 360, floating: false, x: 0, y: 0 };
const Context = createContext<Dock | null>(null);
export function GameUiInspectorProvider({
  scope,
  children,
  onOpen,
  suspended,
  embedded = false,
  externalHost,
  onActiveChange,
}: {
  scope: string;
  embedded?: boolean;
  externalHost?: HTMLDivElement | null;
  onActiveChange?: (active: boolean) => void;
  children: ReactNode;
  onOpen: () => void;
  suspended: boolean;
}) {
  const [active, setActive] = useState<string | null>(null),
    [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [preferences, savePreferences] = usePersonalValue(
    `game-ui-inspector:${scope}`,
    defaultPreferences,
  );
  const opened = useRef(onOpen);
  opened.current = onOpen;
  useEffect(() => {
    onActiveChange?.(!!active);
    if (active) opened.current();
  }, [active]);
  useEffect(() => {
    if (suspended) setActive(null);
  }, [suspended]);
  return (
    <Context
      value={{
        embedded,
        active,
        root: embedded ? (externalHost ?? null) : root,
        open: setActive,
        close: (id) => setActive((v) => (v === id ? null : v)),
        preferences,
        savePreferences,
      }}
    >
      {children}
      {!embedded && (
        <div
          ref={setRoot}
          className="game-ui-inspector-host"
          data-game-ui-dock={active ? 'open' : undefined}
          data-scope={scope}
        />
      )}
    </Context>
  );
}
export function useGameUiInspector(id: string) {
  const dock = useContext(Context);
  return { dock, activate: () => dock?.open(id) };
}

export function GameUiInspectorPanel({
  owner,
  scope,
  title,
  subtitle,
  close,
  children,
  toolbar,
  status,
  rename,
  locked,
  layers,
}: {
  owner: string;
  scope: string;
  title: string;
  subtitle: string;
  close: () => void;
  children: ReactNode;
  toolbar?: ReactNode;
  status?: ReactNode;
  rename?: (value: string) => void | Promise<unknown>;
  locked?: boolean;
  layers?: ReactNode;
}) {
  const { dock } = useGameUiInspector(owner);
  const [fallback, saveFallback] = usePersonalValue(
    `game-ui-inspector:${scope}`,
    defaultPreferences,
  );
  const stored = dock?.preferences ?? fallback,
    save = dock?.savePreferences ?? saveFallback;
  const width = Math.min(480, Math.max(320, Number(stored.width) || 360));
  const panel = useRef<HTMLElement>(null);
  const gesture = useRef<{
    mode: 'resize' | 'move';
    x: number;
    y: number;
    width: number;
    left: number;
    top: number;
  } | null>(null);
  const [geometry, setGeometry] = useState<{
    width: number;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    dock?.open(owner);
    return () => dock?.close(owner);
    // Opening a panel claims the shared dock once; updates must not reclaim it.
  }, [owner]);
  const active = !dock || dock.active === owner;
  const w = geometry?.width ?? width;
  const x = geometry?.x ?? stored.x,
    y = geometry?.y ?? stored.y;
  const host = dock?.root;
  useEffect(() => {
    if (!active || !host || dock?.embedded) return;
    const layout = () => {
      host.style.width = `${w}px`;
      host.dataset.layout = stored.floating ? 'floating' : 'docked';
      host.style.left = stored.floating
        ? `${Math.max(8, Math.min(x || window.innerWidth - w - 24, window.innerWidth - w - 8))}px`
        : '';
      host.style.top = stored.floating
        ? `${Math.max(88, Math.min(y || 100, window.innerHeight - 240))}px`
        : '';
      const canvas = host.closest<HTMLElement>('.canvas-shell');
      if (canvas) canvas.style.setProperty('--game-ui-panel-width', `${w}px`);
      host
        .closest<HTMLElement>('.app-shell')
        ?.style.setProperty('--game-ui-panel-width', `${w}px`);
    };
    layout();
    window.addEventListener('resize', layout);
    return () => window.removeEventListener('resize', layout);
  }, [active, host, w, x, y, stored.floating]);
  if (!active || (dock && !host)) return null;
  const content = (
    <aside
      ref={panel}
      className="game-ui-inspector nodrag nowheel"
      data-ui-id="game-ui-inspector"
      aria-label="게임 UI 속성"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="game-ui-panel-resize"
        role="separator"
        aria-label="속성 패널 너비"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={320}
        aria-valuemax={480}
        aria-valuetext={`${width}px`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            save({
              ...stored,
              width: Math.min(
                480,
                Math.max(320, width + (e.key === 'ArrowLeft' ? 16 : -16)),
              ),
            });
          }
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          gesture.current = {
            mode: 'resize',
            x: e.clientX,
            y: e.clientY,
            width,
            left: x,
            top: y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (g?.mode === 'resize')
            setGeometry({
              width: Math.min(480, Math.max(320, g.width + g.x - e.clientX)),
              x: g.left,
              y: g.top,
            });
        }}
        onPointerUp={() => {
          if (geometry) save({ ...stored, ...geometry });
          gesture.current = null;
          setGeometry(null);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setGeometry(null);
        }}
      />
      <header
        className="game-ui-inspector-header"
        onPointerDown={(e) => {
          if (
            !stored.floating ||
            e.button !== 0 ||
            (e.target as Element).closest('button, input, select')
          )
            return;
          const r = panel.current!.getBoundingClientRect();
          gesture.current = {
            mode: 'move',
            x: e.clientX,
            y: e.clientY,
            width,
            left: r.left,
            top: r.top,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (g?.mode === 'move')
            setGeometry({
              width,
              x: Math.max(
                8,
                Math.min(
                  window.innerWidth - width - 8,
                  g.left + e.clientX - g.x,
                ),
              ),
              y: Math.max(
                88,
                Math.min(window.innerHeight - 240, g.top + e.clientY - g.y),
              ),
            });
        }}
        onPointerUp={() => {
          if (geometry) save({ ...stored, ...geometry });
          gesture.current = null;
          setGeometry(null);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setGeometry(null);
        }}
      >
        <div>
          <small>{subtitle}</small>
          {rename ? (
            <fieldset disabled={locked} className="game-ui-inspector-name">
              <GameUiTextField
                label="UI 이름"
                value={title}
                apply={rename}
                required
                maxLength={100}
              />
            </fieldset>
          ) : (
            <strong>{title}</strong>
          )}
        </div>
        <button
          type="button"
          title={
            stored.floating ? '화면 우측에 고정' : '이동 가능한 패널로 전환'
          }
          aria-label="속성 패널 배치 전환"
          aria-pressed={stored.floating}
          onClick={() => save({ ...stored, floating: !stored.floating })}
        >
          {stored.floating ? (
            <PanelRightOpen size={16} />
          ) : (
            <PanelRightClose size={16} />
          )}
        </button>
        <button type="button" onClick={close} aria-label="UI 속성 닫기">
          <X size={16} />
        </button>
      </header>
      {toolbar && <div className="game-ui-inspector-toolbar">{toolbar}</div>}
      {layers && <div className="game-ui-inspector-layers">{layers}</div>}
      {status}
      <div className="game-ui-inspector-scroll">{children}</div>
    </aside>
  );
  return host ? createPortal(content, host) : content;
}
