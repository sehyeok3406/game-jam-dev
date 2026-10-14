import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { PREVIEW_PRESETS, viewportRatio } from '../../preview-window';
import {
  GAME_UI_KINDS,
  GAME_UI_SHAPES,
  gameUiHeight,
  type GameUiFrame,
  type GameUiItem,
  type GameUiCommand,
  type GameUiKind,
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
import { snapPosition } from '../../canvas-ux';
export type GameUiNodeData = {
  kind: 'game-ui';
  frame: GameUiFrame;
  locked: boolean;
  scope: string;
  zoom: number;
  libraryEnabled: boolean;
  inspectorMode?: 'single' | 'multiple';
  submit: (c: GameUiCommand) => Promise<void>;
  openDescription: () => Promise<void>;
  exportPng: (data: string, name: string) => Promise<boolean>;
};
export type GameUiCanvasNode = Node<GameUiNodeData, 'game-ui'>;
export function GameUiNode({ data, selected }: NodeProps<GameUiCanvasNode>) {
  const f = data.frame,
    [ids, setIds] = useState<string[]>(
      data.inspectorMode
        ? f.items
            .slice(0, data.inspectorMode === 'multiple' ? 2 : 1)
            .map((i) => i.id)
        : [],
    ),
    [draft, setDraft] = useState<GameUiItem[] | null>(null),
    [inspector, setInspector] = useState(!!data.inspectorMode),
    [preview, setPreview] = useState(false),
    [previews, setPreviews] = useState<Record<string, GameUiPreview>>({}),
    [exportPreview, setExportPreview] = useState(false),
    [error, setError] = useState('');
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
  const handleSize =
    (12 * f.viewportWidth) / (f.width * Math.max(0.05, data.zoom));
  const command = (c: Omit<GameUiCommand, 'id' | 'generation'>) =>
    data.submit({ ...c, id: f.id, generation: f.generation }).catch((e) => {
      setError(String(e));
      throw e;
    });
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
    run(patches(chosen.map((item) => ({ item, changes }))));
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
    apply: (v: number) => void,
    min = 0,
    max = 8192,
  ) => (
    <label>
      {name}
      <input
        aria-label={name}
        type="number"
        key={`${one?.id}-${name}-${value}`}
        defaultValue={value}
        min={min}
        max={max}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (
            e.target.value.trim() &&
            Number.isFinite(v) &&
            v >= min &&
            v <= max &&
            v !== value
          )
            apply(v);
          else e.target.value = String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
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
            onClick={() => setInspector((v) => !v)}
            aria-label="게임 UI 편집"
            aria-expanded={inspector}
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
            미리보기
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
          fill="#fff"
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
              {!preview && ids.includes(i.id) && (
                <rect
                  width={i.width}
                  height={i.height}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={handleSize / 6}
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
      {inspector && (!preview || ids.length > 0) && (
        <aside
          className="game-ui-inspector nodrag nowheel"
          data-ui-id="game-ui-inspector"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <header>
            <strong>게임 UI</strong>
            <button
              onClick={() => setInspector(false)}
              aria-label="UI 속성 닫기"
            >
              ×
            </button>
          </header>
          <fieldset disabled={data.locked}>
            <label>
              UI 추가
              <select
                disabled={!data.libraryEnabled}
                aria-label="UI 추가"
                value=""
                onChange={(e) => {
                  if (e.target.value) add(e.target.value as GameUiKind);
                }}
              >
                <option value="">기능 선택…</option>
                {Object.entries(GAME_UI_KINDS).map(([key, [label]]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              HUD 조합
              <select
                disabled={!data.libraryEnabled}
                aria-label="HUD 조합"
                value=""
                onChange={(e) => {
                  if (e.target.value) preset(e.target.value);
                }}
              >
                <option value="">조합 선택…</option>
                <option value="resources">체력·마나·스태미나</option>
                <option value="portrait">초상화와 자원 게이지</option>
                <option value="skills">하단 스킬 HUD</option>
                <option value="inventory">5×4 인벤토리</option>
              </select>
            </label>
            {!data.libraryEnabled && (
              <small>
                플러그인을 켜면 새 UI를 추가할 수 있습니다. 기존 UI는 계속
                편집할 수 있습니다.
              </small>
            )}
            <details>
              <summary>화면 설정</summary>
              <label>
                화면 이름
                <input
                  aria-label="게임 화면 이름"
                  key={f.title}
                  defaultValue={f.title}
                  maxLength={100}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== f.title)
                      run(changeFrame({ title: e.target.value.trim() }));
                  }}
                />
              </label>
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
            </details>
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
            {one && (
              <fieldset disabled={one.locked}>
                <label>
                  이름
                  <input
                    aria-label="UI 이름"
                    key={one.id + one.name}
                    defaultValue={one.name}
                    maxLength={100}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== one.name)
                        run(
                          patches([
                            {
                              item: one,
                              changes: { name: e.target.value.trim() },
                            },
                          ]),
                        );
                    }}
                  />
                </label>
                <label>
                  문구
                  <input
                    aria-label="UI 문구"
                    key={one.id + one.text}
                    defaultValue={one.text}
                    onBlur={(e) => {
                      if (e.target.value !== one.text)
                        run(
                          patches([
                            { item: one, changes: { text: e.target.value } },
                          ]),
                        );
                    }}
                  />
                </label>
                <label>
                  외형
                  <select
                    aria-label="UI 외형"
                    value={one.shape}
                    onChange={(e) =>
                      run(
                        patches([
                          {
                            item: one,
                            changes: {
                              shape: e.target.value as GameUiItem['shape'],
                            },
                          },
                        ]),
                      )
                    }
                  >
                    {Object.entries(GAME_UI_SHAPES)
                      .filter(
                        ([key]) =>
                          key !== 'ring' ||
                          ['health', 'mana', 'stamina', 'experience'].includes(
                            one.kind,
                          ),
                      )
                      .map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
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
                      (v) => run(patches([{ item: one, changes: { [k]: v } }])),
                      k === 'x' || k === 'y' ? -1e6 : 8,
                      k === 'x' || k === 'y' ? 1e6 : 8192,
                    )}
                  </div>
                ))}
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
                        run(patches([{ item: one, changes: { columns: v } }])),
                      1,
                      32,
                    )}
                    {num(
                      '슬롯 간격',
                      one.gap,
                      (v) => run(patches([{ item: one, changes: { gap: v } }])),
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
                          one.kind === 'items' ? slot.quantity : slot.cooldown,
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
                                          ? { ...s, disabled: e.target.checked }
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
            <details open>
              <summary>레이어 · {f.items.length}개</summary>
              {f.items.map((i) => (
                <button
                  type="button"
                  key={i.id}
                  className={ids.includes(i.id) ? 'active' : ''}
                  onClick={() => setIds([i.id])}
                >
                  {i.locked ? '🔒 ' : ''}
                  {i.name}
                </button>
              ))}
            </details>
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
          {chosen.length > 0 && (
            <GameUiDetailInspector
              items={chosen}
              disabled={data.locked || chosen.some((i) => i.locked)}
              apply={detailApply}
              draft={detailDraft}
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
          <label>
            PNG 출력 상태
            <select
              aria-label="PNG 출력 상태"
              value={exportPreview ? 'preview' : 'saved'}
              onChange={(e) => setExportPreview(e.target.value === 'preview')}
            >
              <option value="saved">저장된 값</option>
              <option value="preview">미리보기 상태</option>
            </select>
          </label>
          {error && (
            <p role="alert">
              {error}
              <button onClick={() => setError('')}>닫기</button>
            </p>
          )}
        </aside>
      )}
      {error && !inspector && (
        <p className="game-ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
