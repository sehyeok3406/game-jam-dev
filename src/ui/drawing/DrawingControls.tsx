import {
  Shapes,
  Pencil,
  Highlighter,
  Eraser,
  Copy,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  drawingName,
  SHAPE_NAMES,
  type DrawingCommand,
  type DrawingItem,
  type DrawingStyle,
  type DrawingTool,
  type EraserMode,
} from '../../drawing-types';
import {
  DEFAULT_HIGHLIGHT_STYLE,
  DEFAULT_PEN_STYLE,
  DEFAULT_SHAPE_STYLE,
} from '../../drawing-geometry';
export function DrawingToolButtons({
  grouped = false,
  active,
  tool,
  onTool,
  disabled,
  eraserMode = 'stroke',
  eraserSize = 24,
  onEraser,
  partialSupported = true,
}: {
  grouped?: boolean;
  active: boolean;
  tool: DrawingTool;
  onTool: (t: DrawingTool) => void;
  disabled: boolean;
  eraserMode?: EraserMode;
  eraserSize?: number;
  onEraser?: (mode: EraserMode, size: number) => void;
  partialSupported?: boolean;
}) {
  const drawingButtons = (
    <>
      <button
        type="button"
        disabled={disabled}
        className={active && tool === 'pen' ? 'active' : ''}
        aria-pressed={active && tool === 'pen'}
        onClick={() => onTool('pen')}
        title="펜 (Shift+P)"
      >
        <Pencil size={19} />
        <span>펜</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={active && tool === 'highlighter' ? 'active' : ''}
        aria-pressed={active && tool === 'highlighter'}
        onClick={() => onTool('highlighter')}
        title="형광펜 (B)"
      >
        <Highlighter size={19} />
        <span>형광펜</span>
      </button>
      <EraserMenu
        active={active && tool === 'eraser'}
        disabled={disabled}
        mode={eraserMode}
        size={eraserSize}
        partialSupported={partialSupported}
        onActivate={() => onTool('eraser')}
        onChange={onEraser}
      />
    </>
  );
  return (
    <>
      <details className="drawing-tool-menu" data-ui-id="drawing-tools">
        <summary
          className={active && Object.hasOwn(SHAPE_NAMES, tool) ? 'active' : ''}
          aria-label="도형 삽입"
        >
          <Shapes size={19} />
          <span>도형</span>
          <kbd>D</kbd>
        </summary>
        <div className="drawing-tool-menu__items">
          {Object.entries(SHAPE_NAMES).map(([k, label]) => (
            <button
              type="button"
              key={k}
              disabled={disabled}
              onClick={(e) => {
                onTool(k as DrawingTool);
                e.currentTarget.closest('details')?.removeAttribute('open');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
      {grouped ? (
        <details className="canvas-drawing-group">
          <summary
            className={
              active && ['pen', 'highlighter', 'eraser'].includes(tool)
                ? 'active'
                : ''
            }
            aria-label="그리기 도구"
          >
            <Pencil size={19} />
            <span>
              {active && tool === 'highlighter'
                ? '형광펜'
                : active && tool === 'eraser'
                  ? '지우개'
                  : '그리기'}
            </span>
          </summary>
          <div>{drawingButtons}</div>
        </details>
      ) : (
        drawingButtons
      )}
    </>
  );
}
function EraserMenu({
  active,
  disabled,
  mode,
  size,
  partialSupported,
  onActivate,
  onChange,
}: {
  active: boolean;
  disabled: boolean;
  mode: EraserMode;
  size: number;
  partialSupported: boolean;
  onActivate: () => void;
  onChange?: (mode: EraserMode, size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active || disabled) setOpen(false);
  }, [active, disabled]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    const outside = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      setOpen(false);
      if ((e.target as Element)?.closest?.('.react-flow')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const blur = () => setOpen(false);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', blur);
    };
  }, [open]);
  return (
    <div ref={root} className="drawing-eraser-menu" data-ui-id="drawing-eraser">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        className={active ? 'active' : ''}
        aria-pressed={active}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${mode === 'partial' ? '부분' : '획'} 지우개 (E)`}
        onClick={() => {
          onActivate();
          setOpen(!open);
        }}
      >
        <Eraser size={19} />
        <span>지우개</span>
        <small aria-hidden="true">▴</small>
      </button>
      {open && (
        <div
          className="drawing-eraser-menu__popup"
          role="dialog"
          aria-label="지우개 선택"
        >
          <strong>지우개</strong>
          <div role="radiogroup" aria-label="지우개 종류">
            {(['stroke', 'partial'] as const).map((m) => (
              <label key={m}>
                <input
                  type="radio"
                  name="drawing-eraser-mode"
                  value={m}
                  checked={mode === m}
                  disabled={m === 'partial' && !partialSupported}
                  onChange={() => onChange?.(m, size)}
                />
                <span>
                  <b>{m === 'stroke' ? '획 지우개' : '부분 지우개'}</b>
                  <small>
                    {m === 'stroke'
                      ? '닿은 획 전체를 지웁니다'
                      : '지나간 부분만 지웁니다'}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {!partialSupported && (
            <small>
              부분 지우개를 사용하려면 협업 서버를 업데이트해주세요.
            </small>
          )}
          {mode === 'partial' && (
            <label className="drawing-eraser-menu__size">
              크기 <output>{size} px</output>
              <input
                aria-label="부분 지우개 크기"
                type="range"
                min="4"
                max="80"
                step="1"
                value={size}
                onChange={(e) => onChange?.(mode, Number(e.target.value))}
              />
              <span className="drawing-eraser-menu__sample">
                <i style={{ width: size, height: size }} />
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
export function DrawingInspector({
  objects,
  tool,
  style,
  onStyle,
  submit,
  disabled,
  onDuplicate,
  onDelete,
  pressure,
  onPressure,
  touch,
  onTouch,
  continuous,
  onContinuous,
  canvases,
  canvasId,
  allObjects,
  eraserMode = 'stroke',
}: {
  objects: DrawingItem[];
  tool: DrawingTool;
  style: DrawingStyle;
  onStyle: (s: DrawingStyle) => void;
  submit: (c: Omit<DrawingCommand, 'canvasId' | 'scope'>) => void;
  disabled: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  pressure: boolean;
  onPressure: (v: boolean) => void;
  touch: boolean;
  onTouch: (v: boolean) => void;
  continuous: boolean;
  onContinuous: (v: boolean) => void;
  canvases: { id: string; name: string }[];
  canvasId: string;
  allObjects: DrawingItem[];
  eraserMode?: EraserMode;
}) {
  const first = objects[0],
    s = first?.style ?? style,
    one = objects.length === 1,
    fillable = objects.length
      ? objects.every(
          (o) =>
            o.kind === 'shape' && !['line', 'arrow'].includes(o.geometry.shape),
        )
      : !['pen', 'highlighter', 'eraser', 'line', 'arrow'].includes(tool),
    stroke =
      objects.some((o) => o.kind === 'stroke') ||
      (!first &&
        (tool === 'pen' || tool === 'highlighter' || tool === 'eraser'));
  const mixed = (key: keyof DrawingStyle) =>
    objects.some((o) => o.style[key] !== s[key]);
  const mixedLayer = objects.some((o) => o.layer !== first?.layer);
  const apply = (part: Partial<DrawingStyle>) => {
    if (first)
      submit({
        action: 'patch',
        patches: objects.map((o) => ({
          id: o.id,
          generation: o.generation,
          style: part,
        })),
      });
    else onStyle({ ...style, ...part });
  };
  const numeric = (
    label: string,
    value: number,
    fn: (v: number) => void,
    min: number,
    max: number,
    step = 1,
    mixedValue = false,
  ) => (
    <label key={label}>
      {label}
      <input
        type="number"
        aria-label={label}
        key={`${first?.id ?? 'tool'}-${label}-${value}-${mixedValue}`}
        defaultValue={mixedValue ? '' : value}
        placeholder={mixedValue ? '혼합' : undefined}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value);
          if (
            e.currentTarget.value !== '' &&
            Number.isFinite(v) &&
            v >= min &&
            v <= max &&
            (v !== value || mixedValue)
          )
            fn(v);
          else e.currentTarget.value = mixedValue ? '' : String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
  const transform = (p: Partial<DrawingItem['transform']>) =>
    first &&
    submit({
      action: 'patch',
      patches: [{ id: first.id, generation: first.generation, transform: p }],
    });
  return (
    <aside
      className="drawing-inspector floating-surface"
      data-ui-id="drawing-inspector"
      aria-label="도형 · 그림 속성"
    >
      <h3>
        {first
          ? objects.length > 1
            ? `${objects.length}개 그림 선택`
            : drawingName(first)
          : tool === 'eraser'
            ? eraserMode === 'partial'
              ? '부분 지우개'
              : '획 지우개'
            : '그리기 설정'}
      </h3>
      {tool === 'eraser' && !first ? (
        <p>
          {eraserMode === 'partial'
            ? '펜·형광펜의 지나간 부분만 지웁니다. 하단 지우개 버튼에서 종류와 크기를 고르세요.'
            : '닿은 획은 흐려지고 포인터를 놓으면 전체가 지워집니다. Esc로 취소할 수 있습니다.'}
        </p>
      ) : (
        <>
          {objects.length > 1 && (
            <small>
              값이 다른 속성은 혼합으로 표시합니다. 변경한 속성만 전체 선택에
              적용합니다.
            </small>
          )}
          {!objects.some((o) => o.kind === 'text') && (
            <>
              {fillable && (
                <label>
                  채우기{mixed('fill') ? ' · 혼합' : ''}
                  <input
                    aria-label="채우기 색"
                    type="color"
                    value={s.fill ?? '#dbeafe'}
                    disabled={disabled}
                    onChange={(e) => apply({ fill: e.target.value })}
                  />
                  <input
                    type="checkbox"
                    aria-label="채우기 없음"
                    checked={s.fill === null}
                    ref={(e) => {
                      if (e) e.indeterminate = mixed('fill');
                    }}
                    disabled={disabled}
                    onChange={(e) =>
                      apply({ fill: e.target.checked ? null : '#dbeafe' })
                    }
                  />
                  없음
                </label>
              )}
              <label>
                {stroke ? '펜 색' : '테두리'}
                {mixed('stroke') ? ' · 혼합' : ''}
                <input
                  aria-label="선 색"
                  type="color"
                  value={s.stroke ?? '#2563eb'}
                  disabled={disabled}
                  onChange={(e) => apply({ stroke: e.target.value })}
                />
                {!stroke && (
                  <>
                    <input
                      type="checkbox"
                      aria-label="테두리 없음"
                      checked={s.stroke === null}
                      ref={(e) => {
                        if (e) e.indeterminate = mixed('stroke');
                      }}
                      disabled={disabled}
                      onChange={(e) =>
                        apply({ stroke: e.target.checked ? null : '#2563eb' })
                      }
                    />
                    없음
                  </>
                )}
              </label>
              {numeric(
                '선 굵기',
                s.strokeWidth,
                (v) => apply({ strokeWidth: v }),
                0.5,
                128,
                0.5,
                mixed('strokeWidth'),
              )}
              {numeric(
                '불투명도 (%)',
                Math.round(s.opacity * 100),
                (v) => apply({ opacity: v / 100 }),
                0,
                100,
                1,
                mixed('opacity'),
              )}
              {!stroke && (
                <label>
                  선 모양
                  <select
                    aria-label="선 모양"
                    disabled={disabled}
                    value={mixed('strokePattern') ? 'mixed' : s.strokePattern}
                    onChange={(e) =>
                      apply({
                        strokePattern: e.target
                          .value as DrawingStyle['strokePattern'],
                      })
                    }
                  >
                    <option value="mixed" disabled>
                      혼합
                    </option>
                    <option value="solid">실선</option>
                    <option value="dashed">점선</option>
                  </select>
                </label>
              )}
            </>
          )}
          {one && (
            <>
              <hr />
              {(['x', 'y', 'width', 'height', 'rotation'] as const)
                .filter((k) => first.kind !== 'text' || k !== 'rotation')
                .map((k) =>
                  numeric(
                    {
                      x: 'X 위치',
                      y: 'Y 위치',
                      width: '너비',
                      height: '높이',
                      rotation: '회전 (°)',
                    }[k],
                    Math.round(first.transform[k] * 100) / 100,
                    (v) => transform({ [k]: v }),
                    k === 'rotation'
                      ? 0
                      : k === 'width' || k === 'height'
                        ? 1
                        : -1e6,
                    k === 'rotation'
                      ? 359.99
                      : k === 'width' || k === 'height'
                        ? 1e5
                        : 1e6,
                    0.01,
                  ),
                )}
            </>
          )}
          {one &&
            first.kind === 'shape' &&
            first.geometry.shape === 'rounded-rectangle' &&
            numeric(
              '모서리 반경',
              first.geometry.cornerRadius ?? 16,
              (v) =>
                submit({
                  action: 'patch',
                  patches: [
                    {
                      id: first.id,
                      generation: first.generation,
                      geometry: { ...first.geometry, cornerRadius: v },
                      expectedGeometry: first.geometry,
                    },
                  ],
                }),
              0,
              1e5,
            )}
          {first && (
            <>
              <label>
                표시 위치
                <select
                  aria-label="그림 표시 위치"
                  disabled={disabled}
                  value={mixedLayer ? 'mixed' : first.layer}
                  onChange={(e) =>
                    submit({
                      action: 'patch',
                      patches: objects.map((o) => ({
                        id: o.id,
                        generation: o.generation,
                        layer: e.target.value as DrawingItem['layer'],
                      })),
                    })
                  }
                >
                  <option value="mixed" disabled>
                    혼합
                  </option>
                  <option value="background">카드 뒤</option>
                  <option value="annotation">주석 앞</option>
                </select>
              </label>
              <div className="drawing-actions">
                <button
                  disabled={disabled}
                  onClick={() =>
                    submit({
                      action: 'patch',
                      patches: objects.map((o) => ({
                        id: o.id,
                        generation: o.generation,
                        order: Math.min(
                          1e9,
                          Math.max(
                            0,
                            ...allObjects
                              .filter(
                                (v) =>
                                  v.canvasId === canvasId &&
                                  v.layer === o.layer,
                              )
                              .map((v) => v.order),
                          ) + 1,
                        ),
                      })),
                    })
                  }
                >
                  맨 앞으로
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    submit({
                      action: 'patch',
                      patches: allObjects
                        .filter((o) => o.canvasId === canvasId)
                        .map((o) => ({
                          id: o.id,
                          generation: o.generation,
                          order: objects.some((v) => v.id === o.id)
                            ? 0
                            : Math.min(1e9, o.order + 1),
                        })),
                    })
                  }
                >
                  맨 뒤로
                </button>
                <button disabled={disabled} onClick={onDuplicate}>
                  <Copy size={14} />
                  복제
                </button>
                <button disabled={disabled} onClick={onDelete}>
                  <Trash2 size={14} />
                  삭제
                </button>
              </div>
              <label>
                캔버스 이동
                <select
                  aria-label="그림을 다른 캔버스로 이동"
                  disabled={disabled}
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      submit({
                        action: 'move',
                        targetCanvasId: e.target.value,
                        targets: objects.map((o) => ({
                          id: o.id,
                          generation: o.generation,
                        })),
                      });
                  }}
                >
                  <option value="">대상 선택</option>
                  {canvases
                    .filter((c) => c.id !== canvasId)
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {!first && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={continuous}
                  onChange={(e) => onContinuous(e.target.checked)}
                />
                도형 연속 삽입
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pressure}
                  onChange={(e) => onPressure(e.target.checked)}
                />
                펜 필압 사용
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={touch}
                  onChange={(e) => onTouch(e.target.checked)}
                />
                터치로 그리기
              </label>
              <div className="drawing-actions">
                <button onClick={() => onStyle({ ...DEFAULT_SHAPE_STYLE })}>
                  도형 기본
                </button>
                <button onClick={() => onStyle({ ...DEFAULT_PEN_STYLE })}>
                  펜 기본
                </button>
                <button onClick={() => onStyle({ ...DEFAULT_HIGHLIGHT_STYLE })}>
                  형광펜 기본
                </button>
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}
