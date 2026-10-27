import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NodeResizer,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { PREVIEW_PRESETS, viewportRatio } from '../../preview-window';
import {
  GAME_UI_KINDS,
  gameUiHeight,
  type GameUiFrame,
  type GameUiItem,
  type GameUiCommand,
  type GameUiKind,
  type GameUiState,
} from '../../game-ui-types';
import { newGameUiItem } from '../../game-ui-model';
import {
  GameUiGraphic,
  GameUiItemGraphic,
  type GameUiPreview,
} from './GameUiGraphic';
import { GameUiDetailInspector } from './GameUiDetailInspector';
import {
  gameUiBounds,
  gameUiResize,
  gameUiTransform,
} from '../../game-ui-details';
import {
  GameUiNumberField as NumberField,
  GameUiColorField,
  GameUiTextField,
} from './GameUiFields';
import { GameUiLibrary } from './GameUiLibrary';
import {
  GameUiInspectorPanel,
  useGameUiInspector,
} from './GameUiInspectorPanel';
import { GAME_UI_STATES } from '../../game-ui-details';
import { snapPosition } from '../../canvas-ux';
export type GameUiNodeData = {
  kind: 'game-ui';
  frame: GameUiFrame;
  locked: boolean;
  scope: string;
  zoom: number;
  libraryEnabled: boolean;
  saving?: boolean;
  saveError?: string;
  retry?: () => void;
  inspectorMode?: 'single' | 'multiple';
  submit: (c: GameUiCommand) => Promise<void>;
  openDescription: () => Promise<void>;
  exportPng: (data: string, name: string) => Promise<boolean>;
};
export type GameUiCanvasNode = Node<GameUiNodeData, 'game-ui'>;
export function GameUiNode({ data, selected }: NodeProps<GameUiCanvasNode>) {
  const flow = useReactFlow();
  const f = data.frame,
    [ids, setSelectedIds] = useState<string[]>(
      data.inspectorMode
        ? f.items
            .slice(0, data.inspectorMode === 'multiple' ? 2 : 1)
            .map((i) => i.id)
        : [],
    ),
    [draft, setDraft] = useState<GameUiItem[] | null>(null),
    [inspector, setInspectorState] = useState(!!data.inspectorMode),
    [preview, setPreview] = useState(false),
    [previews, setPreviews] = useState<Record<string, GameUiPreview>>({}),
    [exportPreview, setExportPreview] = useState(false),
    [error, setError] = useState(''),
    [inspectorPage, setInspectorPage] = useState<
      'properties' | 'library' | 'screen'
    >(data.frame.items.length ? 'properties' : 'library'),
    [editingState, setEditingState] = useState<GameUiState>('normal'),
    [hoveredId, setHoveredId] = useState<string | null>(null);
  const inspectorOwner =
    data.scope + ':' + f.canvasId + ':' + f.id + ':' + f.generation;
  const { dock, activate } = useGameUiInspector(inspectorOwner);
  const setInspector = (next: boolean | ((previous: boolean) => boolean)) => {
    const open = typeof next === 'function' ? next(inspector) : next;
    setInspectorState(open);
    if (open) activate();
    else {
      dock?.close(inspectorOwner);
      cancel();
    }
  };
  const setIds = (next: string[]) => {
    if (next.join(',') !== ids.join(',')) {
      cancel();
      stopAnimation();
      setEditingState('normal');
      if (next.length === 1)
        setPreviews((current) => {
          const previous = current[next[0]];
          if (!previous?.state) return current;
          const { state: _state, ...test } = previous;
          const updated = { ...current };
          if (Object.keys(test).length) updated[next[0]] = test;
          else delete updated[next[0]];
          return updated;
        });
    }
    setSelectedIds(next);
    setInspectorPage('properties');
    if (inspector) activate();
  };
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<{
      pointer: number;
      start: { x: number; y: number };
      items: GameUiItem[];
      mode: 'move' | 'resize' | 'rotate';
    } | null>(null);
  const animation = useRef<number | null>(null);
  const stopAnimation = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };
  useEffect(
    () => () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
    },
    [],
  );
  const chosen = f.items.filter((i) => ids.includes(i.id)),
    one = chosen.length === 1 ? chosen[0] : null;
  useEffect(() => {
    if (!inspector || dock?.active !== inspectorOwner) return;
    const frame = requestAnimationFrame(() => {
      const rect = svg.current?.getBoundingClientRect(),
        viewport = svg.current?.closest('.react-flow')?.getBoundingClientRect();
      if (
        rect &&
        viewport &&
        (rect.right > viewport.right - 20 ||
          rect.left < viewport.left + 20 ||
          rect.top < viewport.top + 90 ||
          rect.bottom > viewport.bottom - 100)
      )
        void flow.fitView({
          nodes: [{ id: `game-ui:${f.id}` }],
          padding: 0.15,
          maxZoom: Math.min(1, flow.getViewport().zoom),
          duration: 180,
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [dock?.active, inspectorOwner, inspector]);
  useEffect(() => {
    if (dock && dock.active !== inspectorOwner) {
      cancel();
      stopAnimation();
      setHoveredId(null);
    }
  }, [dock?.active, inspectorOwner]);
  const handleSize =
    (12 * f.viewportWidth) / (f.width * Math.max(0.05, data.zoom));
  const command = (c: Omit<GameUiCommand, 'id' | 'generation'>) =>
    data
      .submit({ ...c, id: f.id, generation: f.generation })
      .then(() => {
        setError('');
      })
      .catch((e) => {
        setError(String(e));
        throw e;
      });
  const previousItems = useRef(new Set(f.items.map((i) => i.id)));
  useEffect(() => {
    const exists = new Set(f.items.map((i) => i.id));
    const removed = new Set(
      [...previousItems.current].filter((id) => !exists.has(id)),
    );
    previousItems.current = exists;
    setSelectedIds((current) =>
      current.every((id) => !removed.has(id))
        ? current
        : current.filter((id) => !removed.has(id)),
    );
    setPreviews((current) =>
      Object.keys(current).every((id) => exists.has(id))
        ? current
        : Object.fromEntries(
            Object.entries(current).filter(([id]) => exists.has(id)),
          ),
    );
  }, [f.items]);
  const run = (p: Promise<unknown>) => void p.catch(() => undefined);
  const patches = (
    changes: { item: GameUiItem; changes: Partial<GameUiItem> }[],
  ) =>
    command({
      action: 'patch',
      patches: changes.map(({ item, changes: change }) => ({
        id: item.id,
        generation: item.generation,
        changes: change,
        expected: Object.fromEntries(
          Object.keys(change).map((k) => [k, item[k as keyof GameUiItem]]),
        ),
      })),
    });
  const changeFrame = (changes: GameUiCommand['changes']) =>
    command({
      action: 'frame',
      changes,
      expected: Object.fromEntries(
        Object.keys(changes!).map((k) => [k, f[k as keyof GameUiFrame]]),
      ),
    });
  const detailDraft = (changes: Partial<GameUiItem>) => {
    if (!Object.keys(changes).length) cancel();
    else setDraft(chosen.map((i) => ({ ...i, ...changes })));
  };
  const detailApply = (changes: Partial<GameUiItem>) => {
    cancel();
    return patches(chosen.map((item) => ({ item, changes })));
  };
  const animateValue = (value: number) => {
    if (!one) return;
    stopAnimation();
    const id = one.id,
      from = previews[id]?.value ?? one.value,
      duration = one.transitionDuration ?? 0,
      deltaDuration = one.deltaDuration ?? 0,
      start = performance.now();
    const update = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1,
        deltaT = deltaDuration ? Math.min(1, (now - start) / deltaDuration) : 1;
      setPreviews((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          value: from + (value - from) * t,
          delta: deltaT < 1 ? from + (value - from) * deltaT : undefined,
        },
      }));
      if (t < 1 || deltaT < 1)
        animation.current = requestAnimationFrame(update);
      else animation.current = null;
    };
    animation.current = requestAnimationFrame(update);
  };
  const add = (kind: GameUiKind) => {
    const i = newGameUiItem(
      kind,
      () => crypto.randomUUID(),
      f.items.map((i) => i.name),
    );
    i.x = Math.max(0, (f.viewportWidth - i.width) / 2);
    i.y = Math.max(0, (f.viewportHeight - i.height) / 2);
    setIds([i.id]);
    setInspector(true);
    run(command({ action: 'add', items: [i] }));
  };
  const preset = (name: string) => {
    const names = f.items.map((i) => i.name),
      items: GameUiItem[] = [],
      groupId = crypto.randomUUID();
    const make = (kind: GameUiKind, x: number, y: number) => {
      const i = newGameUiItem(kind, () => crypto.randomUUID(), names);
      names.push(i.name);
      i.x = x;
      i.y = y;
      i.groupId = groupId;
      items.push(i);
      return i;
    };
    if (name === 'resources')
      ['health', 'mana', 'stamina'].forEach((kind, n) =>
        make(kind as GameUiKind, 40, 40 + n * 56),
      );
    if (name === 'portrait') {
      const image = make('image', 40, 40);
      image.width = 120;
      image.height = 120;
      make('health', 180, 40);
      make('mana', 180, 96);
    }
    if (name === 'skills') {
      const i = make(
        'skills',
        Math.max(0, (f.viewportWidth - 280) / 2),
        Math.max(0, f.viewportHeight - 100),
      );
      i.width = 280;
      make('mana', i.x, i.y - 52);
    }
    if (name === 'inventory') {
      const i = make('items', 40, 40);
      while (i.slots.length < 20)
        i.slots.push({
          id: crypto.randomUUID(),
          label: String(i.slots.length + 1),
          quantity: 1,
          cooldown: 0,
        });
      i.count = 20;
      i.columns = 5;
      i.width = 352;
      i.height = 280;
    }
    setIds(items.map((i) => i.id));
    run(command({ action: 'add', items }));
  };
  const duplicate = () => {
    const groups = new Map<string, string>(),
      names = f.items.map((i) => i.name);
    const copies = chosen.map((i) => {
      let name = i.name + ' 복사',
        n = 2;
      while (names.includes(name)) name = i.name + ' 복사 ' + n++;
      names.push(name);
      const slots = i.slots.map((s) => ({ ...s, id: crypto.randomUUID() }));
      if (i.groupId && !groups.has(i.groupId))
        groups.set(i.groupId, crypto.randomUUID());
      return {
        ...i,
        id: crypto.randomUUID(),
        generation: crypto.randomUUID(),
        name,
        x: i.x + 24,
        y: i.y + 24,
        groupId: i.groupId ? groups.get(i.groupId)! : null,
        slots,
        selectedSlot: i.selectedSlot
          ? (slots[i.slots.findIndex((s) => s.id === i.selectedSlot)]?.id ??
            null)
          : null,
      };
    });
    setIds(copies.map((i) => i.id));
    run(command({ action: 'add', items: copies }));
  };
  const remove = () =>
    run(
      command({
        action: 'remove',
        targets: chosen.map((i) => ({ id: i.id, generation: i.generation })),
      }),
    );
  const point = (e: { clientX: number; clientY: number }) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    );
    return { x: p.x, y: p.y };
  };
  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };
  const motion = (
    g: NonNullable<typeof gesture.current>,
    e: { clientX: number; clientY: number; altKey: boolean },
  ) => {
    const p = point(e);
    let dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (g.mode === 'move' && !e.altKey) {
      const bounds = g.items.map(gameUiBounds);
      const left = Math.min(...bounds.map((i) => i.x)),
        top = Math.min(...bounds.map((i) => i.y)),
        right = Math.max(...bounds.map((i) => i.x + i.width)),
        bottom = Math.max(...bounds.map((i) => i.y + i.height));
      const others = f.items.filter((i) => !g.items.some((o) => o.id === i.id));
      const result = snapPosition(
        {
          x: left + dx,
          y: top + dy,
          width: right - left,
          height: bottom - top,
        },
        [
          { x: 0, y: 0, width: f.viewportWidth, height: f.viewportHeight },
          ...others.map(gameUiBounds),
        ],
        (6 * f.viewportWidth) /
          (svg.current?.getBoundingClientRect().width ?? f.viewportWidth),
      );
      dx = result.x - left;
      dy = result.y - top;
    }
    return { dx, dy };
  };
  const gestureChange = (
    g: NonNullable<typeof gesture.current>,
    i: GameUiItem,
    e: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean },
  ) => {
    if (g.mode === 'rotate') {
      const p = point(e),
        cx = i.x + i.width / 2,
        cy = i.y + i.height / 2;
      const start = Math.atan2(g.start.y - cy, g.start.x - cx),
        end = Math.atan2(p.y - cy, p.x - cx);
      let rotation = (i.rotation ?? 0) + ((end - start) * 180) / Math.PI;
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
      return { rotation: Math.round(((rotation + 540) % 360) - 180) };
    }
    const { dx, dy } = motion(g, e);
    if (g.mode === 'resize') return gameUiResize(i, dx, dy);
    return { x: Math.round(i.x + dx), y: Math.round(i.y + dy) };
  };
  useEffect(() => {
    const abort = () => cancel();
    window.addEventListener('blur', abort);
    return () => window.removeEventListener('blur', abort);
  }, []);
  const arrange = (mode: string) => {
    if (chosen.length < 2) return;
    const bounds = chosen.map(gameUiBounds);
    const left = Math.min(...bounds.map((i) => i.x)),
      top = Math.min(...bounds.map((i) => i.y)),
      right = Math.max(...bounds.map((i) => i.x + i.width)),
      bottom = Math.max(...bounds.map((i) => i.y + i.height));
    const sorted = [...chosen].sort((a, b) =>
      mode === 'gap-x'
        ? gameUiBounds(a).x - gameUiBounds(b).x
        : gameUiBounds(a).y - gameUiBounds(b).y,
    );
    let cursor = mode === 'gap-x' ? left : top;
    const gap =
      mode === 'gap-x'
        ? (right - left - bounds.reduce((n, i) => n + i.width, 0)) /
          (chosen.length - 1)
        : (bottom - top - bounds.reduce((n, i) => n + i.height, 0)) /
          (chosen.length - 1);
    const changes = (mode.startsWith('gap') ? sorted : chosen).map((item) => {
      const b = gameUiBounds(item);
      let x = item.x,
        y = item.y,
        width = item.width,
        height = item.height;
      if (mode === 'left') x += left - b.x;
      if (mode === 'center') x += (left + right - b.width) / 2 - b.x;
      if (mode === 'right') x += right - b.width - b.x;
      if (mode === 'top') y += top - b.y;
      if (mode === 'middle') y += (top + bottom - b.height) / 2 - b.y;
      if (mode === 'bottom') y += bottom - b.height - b.y;
      if (mode === 'width') width = chosen[0].width;
      if (mode === 'height') height = chosen[0].height;
      if (mode === 'gap-x') {
        x += cursor - b.x;
        cursor += b.width + gap;
      }
      if (mode === 'gap-y') {
        y += cursor - b.y;
        cursor += b.height + gap;
      }
      return {
        item,
        changes:
          mode === 'width' || mode === 'height' ? { width, height } : { x, y },
      };
    });
    run(patches(changes));
  };
  const group = () => {
    const groupId = crypto.randomUUID();
    run(patches(chosen.map((item) => ({ item, changes: { groupId } }))));
  };
  const exportImage = async () => {
    const snapshot = structuredClone(f);
    await document.fonts.ready;
    const url = URL.createObjectURL(
      new Blob(
        [
          renderToStaticMarkup(
            <GameUiGraphic
              frame={snapshot}
              previews={exportPreview ? previews : undefined}
            />,
          ),
        ],
        {
          type: 'image/svg+xml',
        },
      ),
    );
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = snapshot.viewportWidth;
      canvas.height = snapshot.viewportHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      await data.exportPng(canvas.toDataURL('image/png'), snapshot.title);
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const num = (
    name: string,
    value: number,
    apply: (value: number) => void | Promise<unknown>,
    min = 0,
    max = 8192,
  ) => (
    <NumberField
      key={name + ':' + (one?.id ?? f.id)}
      label={name}
      displayLabel={
        (
          {
            'X 위치': 'X',
            'Y 위치': 'Y',
            'UI 너비': '너비',
            'UI 높이': '높이',
          } as Record<string, string>
        )[name]
      }
      value={value}
      apply={apply}
      min={min}
      max={max}
      integer={
        name === '슬롯 개수' ||
        name === '열 개수' ||
        name.includes('수량') ||
        name === '화면 너비' ||
        name === '화면 높이'
      }
      preview={
        one && ['X 위치', 'Y 위치', 'UI 너비', 'UI 높이'].includes(name)
          ? (value) => {
              const key = (
                {
                  'X 위치': 'x',
                  'Y 위치': 'y',
                  'UI 너비': 'width',
                  'UI 높이': 'height',
                } as const
              )[name as 'X 위치' | 'Y 위치' | 'UI 너비' | 'UI 높이'];
              setDraft([{ ...one, [key]: value }]);
            }
          : undefined
      }
      cancel={cancel}
      unit={
        name.includes('위치') ||
        name.includes('너비') ||
        name.includes('높이') ||
        name.includes('간격')
          ? 'px'
          : undefined
      }
    />
  );
  return (
    <div
      className="game-ui-frame"
      data-ui-id="game-ui-frame"
      data-game-ui-frame={f.id}
    >
      <NodeResizer
        isVisible={selected && !data.locked}
        minWidth={320}
        minHeight={180}
        keepAspectRatio
        onResizeEnd={(_, p) =>
          run(
            changeFrame({
              x: p.x,
              y: p.y,
              width: Math.max(320, Math.min(4000, p.width)),
            }),
          )
        }
      />
      <header className="game-ui-drag-handle">
        <strong>{f.title}</strong>
        <small>{viewportRatio(f.viewportWidth, f.viewportHeight)}</small>
        <div className="nodrag nowheel">
          <button
            type="button"
            onClick={() => {
              const open =
                !inspector || !!(dock && dock.active !== inspectorOwner);
              if (open)
                setInspectorPage(f.items.length ? 'properties' : 'library');
              setInspector(open);
            }}
            aria-label="게임 UI 편집"
            aria-expanded={
              inspector && (!dock || dock.active === inspectorOwner)
            }
          >
            UI 편집
          </button>
          <button
            type="button"
            disabled={data.locked}
            onClick={() =>
              run(
                (async () => {
                  await command({ action: 'describe' });
                  await data.openDescription();
                })(),
              )
            }
          >
            {f.descriptionPath ? 'UI 설명 문서 열기' : 'UI 설명 문서 만들기'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPreview((v) => !v);
              cancel();
            }}
            aria-pressed={preview}
          >
            화면 미리보기
          </button>
          <button
            type="button"
            onClick={() =>
              run(
                exportImage().catch((e) => {
                  setError(String(e));
                }),
              )
            }
          >
            PNG
          </button>
        </div>
      </header>
      <svg
        ref={svg}
        className="game-ui-stage nodrag nowheel"
        tabIndex={0}
        style={{ height: gameUiHeight(f) - 42 }}
        viewBox={`0 0 ${f.viewportWidth} ${f.viewportHeight}`}
        data-ui-id="game-ui-stage"
        onKeyDown={(e) => {
          if (
            (e.ctrlKey || e.metaKey) &&
            ['z', 'y', 's'].includes(e.key.toLowerCase())
          )
            return;
          e.stopPropagation();
          if (e.key === 'Escape') {
            cancel();
            setIds([]);
            return;
          }
          if (data.locked || preview || e.nativeEvent.isComposing) return;
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            duplicate();
          }
          if (e.key === 'Delete') {
            e.preventDefault();
            remove();
          }
          const delta: { [k: string]: [number, number] } = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          if (delta[e.key] && chosen.length) {
            e.preventDefault();
            const [x, y] = delta[e.key],
              factor = e.shiftKey ? 10 : 1;
            run(
              patches(
                chosen.map((item) => ({
                  item,
                  changes: { x: item.x + x * factor, y: item.y + y * factor },
                })),
              ),
            );
          }
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget) {
            setIds([]);
            cancel();
          }
          e.currentTarget.focus();
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.pointer !== e.pointerId) return;
          e.stopPropagation();
          setDraft(g.items.map((i) => ({ ...i, ...gestureChange(g, i, e) })));
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          if (!g || g.pointer !== e.pointerId) return;
          e.stopPropagation();
          const changes = g.items.map((item) => ({
            item,
            changes: gestureChange(g, item, e),
          }));
          cancel();
          if (
            changes.every(({ item, changes: c }) =>
              Object.entries(c).every(
                ([k, v]) =>
                  Math.abs(Number(item[k as keyof GameUiItem] ?? 0) - v) < 0.1,
              ),
            )
          )
            return;
          run(patches(changes));
        }}
        onPointerCancel={cancel}
      >
        <rect
          width="100%"
          height="100%"
          fill={f.backgroundColor ?? '#ffffff'}
          onPointerDown={() => setIds([])}
        />
        {f.items.map((original) => {
          const i = draft?.find((d) => d.id === original.id) ?? original;
          return (
            <g
              key={i.id}
              transform={gameUiTransform(i)}
              data-game-ui-item={i.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                svg.current?.focus();
                if (preview) return;
                let selectedIds = e.shiftKey
                  ? ids.includes(i.id)
                    ? ids.filter((id) => id !== i.id)
                    : [...ids, i.id]
                  : ids.includes(i.id)
                    ? ids
                    : [i.id];
                if (i.groupId && !e.shiftKey)
                  selectedIds = f.items
                    .filter((o) => o.groupId === i.groupId)
                    .map((o) => o.id);
                setIds(selectedIds);
                setInspector(true);
                if (
                  data.locked ||
                  selectedIds.some(
                    (id) => f.items.find((o) => o.id === id)?.locked,
                  )
                )
                  return;
                gesture.current = {
                  pointer: e.pointerId,
                  start: point(e),
                  items: f.items.filter((o) => selectedIds.includes(o.id)),
                  mode: 'move',
                };
                svg.current!.setPointerCapture(e.pointerId);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIds([i.id]);
                setInspector(true);
                cancel();
              }}
            >
              <GameUiItemGraphic
                item={i}
                prefix={f.id}
                preview={previews[i.id]}
              />
              <rect width={i.width} height={i.height} fill="transparent" />
              {((!preview && ids.includes(i.id)) || hoveredId === i.id) && (
                <rect
                  width={i.width}
                  height={i.height}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={handleSize / 6}
                  strokeDasharray={
                    !ids.includes(i.id)
                      ? `${handleSize / 2} ${handleSize / 3}`
                      : undefined
                  }
                />
              )}
              {!preview &&
                !data.locked &&
                !i.locked &&
                ids.length === 1 &&
                ids[0] === i.id && (
                  <rect
                    x={i.width - handleSize / 2}
                    y={i.height - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    fill="#2563eb"
                    style={{ cursor: 'nwse-resize' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      gesture.current = {
                        pointer: e.pointerId,
                        start: point(e),
                        items: [original],
                        mode: 'resize',
                      };
                      svg.current!.setPointerCapture(e.pointerId);
                    }}
                  />
                )}
              {!preview &&
                !data.locked &&
                !i.locked &&
                ids.length === 1 &&
                ids[0] === i.id && (
                  <circle
                    cx={i.width / 2}
                    cy={-handleSize * 2}
                    r={handleSize / 2}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={handleSize / 6}
                    data-game-ui-rotate={i.id}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      gesture.current = {
                        pointer: e.pointerId,
                        start: point(e),
                        items: [original],
                        mode: 'rotate',
                      };
                      svg.current!.setPointerCapture(e.pointerId);
                    }}
                  />
                )}
            </g>
          );
        })}
      </svg>
      {inspector && (
        <GameUiInspectorPanel
          pageKey={inspectorPage}
          owner={inspectorOwner}
          scope={data.scope}
          title={
            inspectorPage !== 'properties'
              ? f.title
              : (one?.name ??
                (chosen.length > 1 ? chosen.length + '개 UI 선택' : f.title))
          }
          subtitle={
            inspectorPage === 'library'
              ? 'UI 라이브러리'
              : inspectorPage === 'screen'
                ? '화면 설정'
                : one
                  ? f.title + ' / ' + GAME_UI_KINDS[one.kind][0]
                  : '게임 화면 · ' +
                    viewportRatio(f.viewportWidth, f.viewportHeight)
          }
          locked={data.locked || !!one?.locked}
          rename={
            one && inspectorPage === 'properties'
              ? (name) => {
                  if (f.items.some((i) => i.id !== one.id && i.name === name))
                    throw new Error(
                      '이미 사용 중인 UI 이름입니다. 다른 이름을 입력해주세요.',
                    );
                  return patches([{ item: one, changes: { name } }]);
                }
              : undefined
          }
          close={() => {
            setInspector(false);
            svg.current?.focus();
          }}
          toolbar={
            <>
              <button
                type="button"
                aria-label="UI 추가 열기"
                aria-expanded={inspectorPage === 'library'}
                aria-pressed={inspectorPage === 'library'}
                onClick={() => setInspectorPage('library')}
              >
                + UI 추가
              </button>
              <button
                type="button"
                aria-pressed={inspectorPage === 'properties'}
                onClick={() => setInspectorPage('properties')}
              >
                속성
              </button>
              <button
                type="button"
                aria-pressed={inspectorPage === 'screen'}
                onClick={() => setInspectorPage('screen')}
              >
                화면 설정
              </button>
            </>
          }
          layers={
            inspectorPage === 'properties' &&
            f.items.length > 0 && (
              <details className="game-ui-layers">
                <summary>레이어 · {f.items.length}개</summary>
                <div className="game-ui-layer-list">
                  {f.items.map((i) => (
                    <button
                      type="button"
                      key={i.id}
                      className={ids.includes(i.id) ? 'active' : ''}
                      aria-pressed={ids.includes(i.id)}
                      onMouseEnter={() => setHoveredId(i.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onFocus={() => setHoveredId(i.id)}
                      onBlur={() => setHoveredId(null)}
                      onClick={(e) => {
                        setPreview(false);
                        setIds(
                          e.shiftKey
                            ? ids.includes(i.id)
                              ? ids.filter((id) => id !== i.id)
                              : [...ids, i.id]
                            : [i.id],
                        );
                      }}
                    >
                      <span className="game-ui-layer-kind">
                        {GAME_UI_KINDS[i.kind][0]}
                      </span>
                      <span>{i.name}</span>
                      {i.locked && <small>잠김</small>}
                    </button>
                  ))}
                </div>
                {!f.items.length && <p>+ UI 추가에서 첫 요소를 넣어보세요.</p>}
              </details>
            )
          }
          status={
            <>
              {(data.locked || chosen.some((i) => i.locked)) && (
                <p className="game-ui-panel-note">
                  {data.locked
                    ? '보기 권한 · 속성을 확인하거나 값을 테스트할 수 있습니다.'
                    : '잠긴 UI · 잠금을 해제하면 편집할 수 있습니다.'}
                </p>
              )}
              {data.saving && (
                <p className="game-ui-panel-note" role="status">
                  변경 사항 저장 중…
                </p>
              )}
              {(error || data.saveError) && (
                <div className="game-ui-error" role="alert">
                  {error || data.saveError}
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      if (data.saveError) data.retry?.();
                    }}
                  >
                    {data.saveError ? '저장 재시도' : '알림 닫기'}
                  </button>
                </div>
              )}
              {Object.keys(previews).length > 0 && (
                <div className="game-ui-test-banner">
                  <span>
                    테스트 표시 중 · {Object.keys(previews).length}개<br />
                    <small>프로젝트에 저장되지 않습니다.</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      stopAnimation();
                      setPreviews({});
                      setEditingState('normal');
                    }}
                  >
                    전체 테스트 초기화
                  </button>
                </div>
              )}
              {editingState !== 'normal' && (
                <p className="game-ui-state-banner">
                  편집 중: {GAME_UI_STATES[editingState]} 외형
                </p>
              )}
            </>
          }
        >
          {inspectorPage === 'library' && (
            <GameUiLibrary
              disabled={data.locked}
              enabled={data.libraryEnabled}
              add={add}
              preset={preset}
            />
          )}
          {inspectorPage === 'screen' ? (
            <fieldset
              disabled={data.locked}
              className="game-ui-screen-settings"
            >
              <section>
                <h3>화면 설정</h3>
                <GameUiTextField
                  label="게임 화면 이름"
                  value={f.title}
                  apply={(title) => changeFrame({ title })}
                  required
                  maxLength={100}
                />
                <GameUiColorField
                  key={f.id}
                  label="게임 화면 배경색"
                  value={f.backgroundColor ?? '#ffffff'}
                  apply={(backgroundColor) => changeFrame({ backgroundColor })}
                />
                <label>
                  화면 비율
                  <select
                    aria-label="게임 화면 비율"
                    value={
                      PREVIEW_PRESETS.find(
                        (p) =>
                          p.width === f.viewportWidth &&
                          p.height === f.viewportHeight,
                      )?.id ?? 'custom'
                    }
                    onChange={(e) => {
                      const p = PREVIEW_PRESETS.find(
                        (p) => p.id === e.target.value,
                      );
                      if (p)
                        run(
                          changeFrame({
                            viewportWidth: p.width,
                            viewportHeight: p.height,
                          }),
                        );
                    }}
                  >
                    <option value="custom">사용자 지정</option>
                    {PREVIEW_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.device} {p.width}×{p.height} · {p.ratio}
                      </option>
                    ))}
                  </select>
                </label>
                {num(
                  '화면 너비',
                  f.viewportWidth,
                  (v) =>
                    run(
                      changeFrame({
                        viewportWidth: v,
                        viewportHeight: f.viewportHeight,
                      }),
                    ),
                  64,
                )}
                {num(
                  '화면 높이',
                  f.viewportHeight,
                  (v) =>
                    run(
                      changeFrame({
                        viewportWidth: f.viewportWidth,
                        viewportHeight: v,
                      }),
                    ),
                  64,
                )}
              </section>

              <button
                className="game-ui-delete"
                onClick={() => {
                  if (
                    window.confirm(
                      `‘${f.title}’ 게임 화면을 삭제할까요? 설명 문서는 유지하며 실행 취소로 화면을 복원할 수 있습니다.`,
                    )
                  )
                    run(command({ action: 'delete' }));
                }}
              >
                게임 화면 삭제
              </button>
            </fieldset>
          ) : inspectorPage === 'properties' ? (
            <>
              <fieldset
                disabled={data.locked}
                className="game-ui-selection-actions"
              >
                {chosen.length > 0 && (
                  <div className="game-ui-actions">
                    <button onClick={duplicate}>복제</button>
                    <button
                      onClick={remove}
                      disabled={chosen.some((i) => i.locked)}
                    >
                      삭제
                    </button>
                    <button
                      onClick={() =>
                        run(
                          patches(
                            chosen.map((item) => ({
                              item,
                              changes: { locked: !item.locked },
                            })),
                          ),
                        )
                      }
                    >
                      잠금 전환
                    </button>
                  </div>
                )}
                {chosen.length > 1 && (
                  <>
                    <div className="game-ui-actions">
                      {[
                        ['left', '왼쪽 맞춤'],
                        ['center', '가운데 맞춤'],
                        ['right', '오른쪽 맞춤'],
                        ['top', '위 맞춤'],
                        ['middle', '세로 가운데'],
                        ['bottom', '아래 맞춤'],
                        ['width', '동일 너비'],
                        ['height', '동일 높이'],
                        ['gap-x', '가로 간격'],
                        ['gap-y', '세로 간격'],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          disabled={
                            chosen.some((i) => i.locked) ||
                            (key.startsWith('gap') && chosen.length < 3)
                          }
                          onClick={() => arrange(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button onClick={group}>그룹으로 묶기</button>
                  </>
                )}
                {chosen.some((i) => i.groupId) && (
                  <button
                    onClick={() =>
                      run(
                        patches(
                          chosen.map((item) => ({
                            item,
                            changes: { groupId: null },
                          })),
                        ),
                      )
                    }
                  >
                    그룹 해제
                  </button>
                )}
              </fieldset>
              {one && (
                <fieldset
                  key={one.id + one.generation}
                  disabled={data.locked || one.locked}
                  className="game-ui-section game-ui-placement"
                >
                  <h3>배치</h3>
                  <p className="game-ui-help">게임 화면 내부 좌표 (px)</p>
                  <div className="game-ui-field-grid">
                    {(['x', 'y', 'width', 'height'] as const).map((k) => (
                      <div key={k}>
                        {num(
                          {
                            x: 'X 위치',
                            y: 'Y 위치',
                            width: 'UI 너비',
                            height: 'UI 높이',
                          }[k],
                          one[k],
                          (v) => patches([{ item: one, changes: { [k]: v } }]),
                          k === 'x' || k === 'y' ? -1e6 : 8,
                          k === 'x' || k === 'y' ? 1e6 : 8192,
                        )}
                      </div>
                    ))}
                  </div>
                </fieldset>
              )}
              {chosen.length > 0 && (
                <GameUiDetailInspector
                  key={chosen.map((i) => i.id + ':' + i.generation).join(',')}
                  items={chosen}
                  disabled={data.locked || chosen.some((i) => i.locked)}
                  apply={detailApply}
                  draft={detailDraft}
                  editingState={editingState}
                  setEditingState={setEditingState}
                  preview={one ? previews[one.id] : undefined}
                  setPreview={(p) => {
                    if (!one) return;
                    cancel();
                    setPreviews((v) => {
                      const next = { ...v };
                      if (p) next[one.id] = p;
                      else delete next[one.id];
                      return next;
                    });
                  }}
                  animate={animateValue}
                  stop={stopAnimation}
                />
              )}
              {one && (
                <fieldset
                  key={'slots:' + one.id}
                  disabled={data.locked || one.locked}
                  className="game-ui-section"
                >
                  {(one.kind === 'skills' || one.kind === 'items') && (
                    <details>
                      <summary>슬롯 설정</summary>
                      {num(
                        '슬롯 개수',
                        one.count,
                        (v) => {
                          const slots = [...one.slots];
                          while (slots.length < v)
                            slots.push({
                              id: crypto.randomUUID(),
                              label: String(slots.length + 1),
                              quantity: 1,
                              cooldown: 0,
                            });
                          run(
                            patches([
                              { item: one, changes: { count: v, slots } },
                            ]),
                          );
                        },
                        1,
                        32,
                      )}
                      {num(
                        '열 개수',
                        one.columns,
                        (v) =>
                          run(
                            patches([{ item: one, changes: { columns: v } }]),
                          ),
                        1,
                        32,
                      )}
                      {num(
                        '슬롯 간격',
                        one.gap,
                        (v) =>
                          run(patches([{ item: one, changes: { gap: v } }])),
                        0,
                        200,
                      )}
                      <small>개수를 줄여도 슬롯 설정은 보관합니다.</small>
                      {one.slots.slice(0, one.count).map((slot, n) => (
                        <details key={slot.id}>
                          <summary>
                            슬롯 {n + 1} · {slot.label}
                          </summary>
                          <label>
                            표시 문구
                            <input
                              aria-label={`슬롯 ${n + 1} 문구`}
                              key={slot.label}
                              defaultValue={slot.label}
                              onBlur={(e) =>
                                run(
                                  patches([
                                    {
                                      item: one,
                                      changes: {
                                        slots: one.slots.map((s) =>
                                          s.id === slot.id
                                            ? { ...s, label: e.target.value }
                                            : s,
                                        ),
                                      },
                                    },
                                  ]),
                                )
                              }
                            />
                          </label>
                          {num(
                            one.kind === 'items'
                              ? `슬롯 ${n + 1} 수량`
                              : `슬롯 ${n + 1} 쿨다운 (%)`,
                            one.kind === 'items'
                              ? slot.quantity
                              : slot.cooldown,
                            (v) =>
                              run(
                                patches([
                                  {
                                    item: one,
                                    changes: {
                                      slots: one.slots.map((s) =>
                                        s.id === slot.id
                                          ? {
                                              ...s,
                                              ...(one.kind === 'items'
                                                ? { quantity: v }
                                                : {
                                                    cooldown: v,
                                                    ...(s.cooldownTotal
                                                      ? {
                                                          cooldownRemaining:
                                                            (s.cooldownTotal *
                                                              v) /
                                                            100,
                                                        }
                                                      : {}),
                                                  }),
                                            }
                                          : s,
                                      ),
                                    },
                                  },
                                ]),
                              ),
                            0,
                            one.kind === 'items' ? 1e9 : 100,
                          )}
                          {one.kind === 'skills' && (
                            <>
                              {num(
                                `슬롯 ${n + 1} 전체 쿨다운 (초)`,
                                slot.cooldownTotal ?? 10,
                                (v) =>
                                  run(
                                    patches([
                                      {
                                        item: one,
                                        changes: {
                                          slots: one.slots.map((s) =>
                                            s.id === slot.id
                                              ? {
                                                  ...s,
                                                  cooldownTotal: v,
                                                  cooldownRemaining: Math.min(
                                                    v,
                                                    s.cooldownRemaining ??
                                                      (v * s.cooldown) / 100,
                                                  ),
                                                }
                                              : s,
                                          ),
                                        },
                                      },
                                    ]),
                                  ),
                                0.000001,
                                1e9,
                              )}
                              {num(
                                `슬롯 ${n + 1} 남은 쿨다운 (초)`,
                                slot.cooldownRemaining ??
                                  ((slot.cooldownTotal ?? 10) * slot.cooldown) /
                                    100,
                                (v) =>
                                  run(
                                    patches([
                                      {
                                        item: one,
                                        changes: {
                                          slots: one.slots.map((s) =>
                                            s.id === slot.id
                                              ? {
                                                  ...s,
                                                  cooldownTotal:
                                                    s.cooldownTotal ?? 10,
                                                  cooldownRemaining: v,
                                                  cooldown:
                                                    (100 * v) /
                                                    (s.cooldownTotal ?? 10),
                                                }
                                              : s,
                                          ),
                                        },
                                      },
                                    ]),
                                  ),
                                0,
                                slot.cooldownTotal ?? 10,
                              )}
                            </>
                          )}
                          <label>
                            사용 불가
                            <input
                              type="checkbox"
                              aria-label={`슬롯 ${n + 1} 사용 불가`}
                              checked={!!slot.disabled}
                              onChange={(e) =>
                                run(
                                  patches([
                                    {
                                      item: one,
                                      changes: {
                                        slots: one.slots.map((s) =>
                                          s.id === slot.id
                                            ? {
                                                ...s,
                                                disabled: e.target.checked,
                                              }
                                            : s,
                                        ),
                                      },
                                    },
                                  ]),
                                )
                              }
                            />
                          </label>
                          {one.kind === 'items' && (
                            <button
                              onClick={() =>
                                run(
                                  patches([
                                    {
                                      item: one,
                                      changes: { selectedSlot: slot.id },
                                    },
                                  ]),
                                )
                              }
                            >
                              이 슬롯 선택 표시
                            </button>
                          )}
                        </details>
                      ))}
                    </details>
                  )}
                </fieldset>
              )}
              {!chosen.length && (
                <p className="game-ui-empty">
                  캔버스나 레이어에서 UI를 선택하면 속성을 편집할 수 있습니다.
                </p>
              )}
            </>
          ) : null}
          {inspectorPage === 'screen' && (
            <details className="game-ui-export-options">
              <summary>PNG 출력 기준</summary>
              <label>
                출력 상태
                <select
                  aria-label="PNG 출력 상태"
                  value={exportPreview ? 'preview' : 'saved'}
                  onChange={(e) =>
                    setExportPreview(e.target.value === 'preview')
                  }
                >
                  <option value="saved">저장된 값</option>
                  <option value="preview">테스트 화면</option>
                </select>
              </label>
              <p>
                {exportPreview
                  ? '화면 전체의 임시 테스트 값·상태를 포함합니다.'
                  : '임시 테스트를 제외하고 저장된 UI를 출력합니다.'}
              </p>
              <button
                type="button"
                onClick={() =>
                  run(exportImage().catch((e) => setError(String(e))))
                }
              >
                PNG 내보내기
              </button>
            </details>
          )}
        </GameUiInspectorPanel>
      )}
      {error && !inspector && (
        <p className="game-ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
