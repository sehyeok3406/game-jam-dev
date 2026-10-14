import type {
  GameUiFrame,
  GameUiItem,
  GameUiSlot,
  GameUiState,
  GameUiStyle,
} from '../../game-ui-types';
import {
  GAME_UI_DETAIL_KEYS,
  gameUiStyle,
  gameUiRatio,
  gameUiValueText,
  gameUiTransform,
  isGauge,
} from '../../game-ui-details';
import { LegacyGameUiItemGraphic } from './LegacyGameUiGraphic';
export type GameUiPreview = {
  value?: number;
  state?: GameUiState;
  cooldown?: number;
  delta?: number;
};
function shapePath(i: GameUiItem, w: number, h: number, s: GameUiStyle) {
  if (i.shape === 'circle' || i.shape === 'ring') {
    const r = Math.max(1, Math.min(w, h) / 2 - 2),
      x = w / 2,
      y = h / 2;
    return `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
  }
  if (i.shape === 'triangle')
    return `M${w / 2} 2L${w - 2} ${h - 2}L2 ${h - 2}Z`;
  const r =
    i.shape === 'rounded'
      ? (s.cornerRadii ?? [
          s.cornerRadius,
          s.cornerRadius,
          s.cornerRadius,
          s.cornerRadius,
        ])
      : [0, 0, 0, 0];
  const width = Math.max(1, w - 2),
    height = Math.max(1, h - 2),
    factor = Math.min(
      1,
      width / (r[0] + r[1] || 1),
      width / (r[2] + r[3] || 1),
      height / (r[0] + r[3] || 1),
      height / (r[1] + r[2] || 1),
    );
  const [a, b, c, d] = r.map((v) => v * factor),
    x = w - 1,
    y = h - 1;
  return `M${1 + a} 1H${x - b}Q${x} 1 ${x} ${1 + b}V${y - c}Q${x} ${y} ${x - c} ${y}H${1 + d}Q1 ${y} 1 ${y - d}V${1 + a}Q1 1 ${1 + a} 1Z`;
}
function sector(w: number, h: number, start: number, sweep: number) {
  if (sweep === 0) return '';
  const r = Math.max(1, Math.min(w, h) / 2),
    cx = w / 2,
    cy = h / 2;
  const point = (a: number) => [
    cx + r * Math.cos((a * Math.PI) / 180),
    cy + r * Math.sin((a * Math.PI) / 180),
  ];
  if (Math.abs(sweep) >= 359.999)
    return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const [x, y] = point(start),
    [a, b] = point(start + sweep);
  return `M${cx} ${cy}L${x} ${y}A${r} ${r} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${a} ${b}Z`;
}
function fillRect(w: number, h: number, ratio: number, direction: string) {
  if (direction === 'up')
    return { x: 0, y: h * (1 - ratio), width: w, height: h * ratio };
  if (direction === 'down') return { x: 0, y: 0, width: w, height: h * ratio };
  if (direction === 'left')
    return { x: w * (1 - ratio), y: 0, width: w * ratio, height: h };
  if (direction === 'center-x')
    return { x: (w * (1 - ratio)) / 2, y: 0, width: w * ratio, height: h };
  if (direction === 'center-y')
    return { x: 0, y: (h * (1 - ratio)) / 2, width: w, height: h * ratio };
  return { x: 0, y: 0, width: w * ratio, height: h };
}
export function GameUiItemGraphic({
  item: i,
  prefix,
  preview,
}: {
  item: GameUiItem;
  prefix: string;
  preview?: GameUiPreview;
}) {
  const detailed =
    GAME_UI_DETAIL_KEYS.some((k) => k !== 'rotation' && i[k] !== undefined) ||
    i.slots.some(
      (s) => s.cooldownTotal !== undefined || s.disabled !== undefined,
    );
  if (!detailed && !preview)
    return <LegacyGameUiItemGraphic item={i} prefix={prefix} />;
  const state = preview?.state ?? i.state ?? 'normal',
    value = preview?.value ?? i.value;
  const strip = i.kind === 'skills' || i.kind === 'items',
    gauge = isGauge(i),
    id = `${prefix}-${i.id}`;
  const content = (
    w: number,
    h: number,
    key: string,
    slot?: GameUiSlot,
    n = 0,
  ) => {
    const selected = slot ? slot.id === i.selectedSlot : false;
    const actualState = slot?.disabled
      ? 'disabled'
      : selected
        ? 'selected'
        : state;
    const s = gameUiStyle(i, actualState),
      d = shapePath(i, w, h, s),
      clip = `${key}-clip`,
      mask = `${key}-outside`;
    const cooldown =
      preview?.cooldown ??
      (slot?.cooldownTotal
        ? (100 * (slot.cooldownRemaining ?? 0)) / slot.cooldownTotal
        : (slot?.cooldown ?? 0));
    const ratio = gameUiRatio(i, value),
      segments = i.segments ?? 1,
      displayRatio = i.segmentSnap
        ? Math.floor(ratio * segments + 1e-8) / segments
        : ratio;
    const direction =
      i.fillDirection ??
      (i.shape === 'circle' || i.shape === 'triangle' ? 'up' : 'right');
    const radial = i.shape === 'ring' || direction === 'radial',
      start = i.radialStart ?? -90,
      sweep = (i.radialSweep ?? 360) * (i.clockwise === false ? -1 : 1);
    const ring = Math.max(0.5, i.ringWidth ?? 10),
      radius = Math.max(1, Math.min(w, h) / 2 - ring / 2 - 3);
    const strokeColor =
      selected && !i.stateStyles?.selected?.borderColor
        ? '#0f172a'
        : s.borderColor;
    const text = slot ? slot.label : gauge ? gameUiValueText(i, value) : i.text;
    const label = (
      text: string,
      x: number,
      y: number,
      size = s.fontSize,
      anchor: 'start' | 'end' | 'middle' = s.textAlign === 'left'
        ? 'start'
        : s.textAlign === 'right'
          ? 'end'
          : 'middle',
    ) => (
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={size}
        fill={s.textColor}
        opacity={s.textOpacity}
        fontFamily="Malgun Gothic, sans-serif"
      >
        {text}
      </text>
    );
    const fill = (r: number, color: string, opacity: number) =>
      radial ? (
        i.shape === 'ring' ? (
          Array.from({ length: segments }, (_, j) => {
            const progress = Math.max(0, Math.min(1, r * segments - j));
            const gap = Math.min(
                (Math.abs(sweep) / segments) * 0.8,
                (((i.segmentGap ?? 0) / radius) * 180) / Math.PI,
              ),
              angle = sweep / segments - (sweep > 0 ? gap : -gap),
              a = start + (j * sweep) / segments;
            if (progress === 0) return null;
            const end = a + angle * progress,
              x = w / 2 + radius * Math.cos((a * Math.PI) / 180),
              y = h / 2 + radius * Math.sin((a * Math.PI) / 180);
            if (Math.abs(angle * progress) >= 359.999)
              return (
                <circle
                  key={j}
                  cx={w / 2}
                  cy={h / 2}
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeWidth={ring}
                  opacity={opacity}
                />
              );
            return (
              <path
                key={j}
                d={`M${x} ${y}A${radius} ${radius} 0 ${Math.abs(angle * progress) > 180 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${w / 2 + radius * Math.cos((end * Math.PI) / 180)} ${h / 2 + radius * Math.sin((end * Math.PI) / 180)}`}
                fill="none"
                stroke={color}
                strokeWidth={ring}
                opacity={opacity}
              />
            );
          })
        ) : (
          <path
            d={sector(w, h, start, sweep * r)}
            fill={color}
            opacity={opacity}
            clipPath={`url(#${clip})`}
          />
        )
      ) : (
        <g clipPath={`url(#${clip})`}>
          <rect
            {...fillRect(w, h, r, direction)}
            fill={color}
            opacity={opacity}
          />
        </g>
      );
    return (
      <g
        opacity={s.opacity}
        data-ui-part={slot ? 'slot' : 'body'}
        data-slot-index={slot ? n : undefined}
      >
        <defs>
          <clipPath id={clip}>
            <path d={d} />
          </clipPath>
          <mask
            id={mask}
            maskUnits="userSpaceOnUse"
            x={-s.borderWidth * 3}
            y={-s.borderWidth * 3}
            width={w + s.borderWidth * 6}
            height={h + s.borderWidth * 6}
          >
            <rect
              x={-s.borderWidth * 3}
              y={-s.borderWidth * 3}
              width={w + s.borderWidth * 6}
              height={h + s.borderWidth * 6}
              fill="white"
            />
            <path d={d} fill="black" />
          </mask>
          {segments > 1 && !radial && (
            <mask
              id={`${key}-segments`}
              maskUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={w}
              height={h}
            >
              <rect width={w} height={h} fill="white" />
              {Array.from({ length: segments - 1 }, (_, j) =>
                ['up', 'down', 'center-y'].includes(direction) ? (
                  <rect
                    key={j}
                    x={0}
                    y={((j + 1) * h) / segments - (i.segmentGap ?? 2) / 2}
                    width={w}
                    height={i.segmentGap ?? 2}
                    fill="black"
                  />
                ) : (
                  <rect
                    key={j}
                    x={((j + 1) * w) / segments - (i.segmentGap ?? 2) / 2}
                    y={0}
                    width={i.segmentGap ?? 2}
                    height={h}
                    fill="black"
                  />
                ),
              )}
            </mask>
          )}
        </defs>
        {i.kind !== 'text' && (
          <path
            d={d}
            fill={
              selected && i.backgroundColor === undefined
                ? '#cbd5e1'
                : s.backgroundColor
            }
            fillOpacity={s.backgroundOpacity}
          />
        )}
        {gauge && (
          <g
            mask={segments > 1 && !radial ? `url(#${key}-segments)` : undefined}
            data-ui-part="progress"
            data-ratio={displayRatio}
          >
            {preview?.delta !== undefined &&
              fill(
                gameUiRatio(i, preview.delta),
                i.deltaColor ?? '#facc15',
                s.fillOpacity * 0.8,
              )}
            {fill(
              displayRatio,
              i.thresholds?.find((t) => ratio * 100 <= t.below)?.color ??
                s.fillColor,
              s.fillOpacity,
            )}
          </g>
        )}
        {slot && cooldown > 0 && (
          <g data-ui-part="cooldown">
            {i.cooldownDirection === 'radial' ? (
              <path
                d={sector(w, h, -90, (360 * cooldown) / 100)}
                fill={i.cooldownColor ?? '#475569'}
                opacity={i.cooldownOpacity ?? 0.55}
                clipPath={`url(#${clip})`}
              />
            ) : (
              <rect
                x={0}
                y={0}
                width={w}
                height={(h * cooldown) / 100}
                fill={i.cooldownColor ?? '#475569'}
                opacity={i.cooldownOpacity ?? 0.55}
                clipPath={`url(#${clip})`}
              />
            )}
          </g>
        )}
        {i.kind !== 'text' && s.borderWidth > 0 && (
          <path
            d={d}
            fill="none"
            stroke={strokeColor}
            strokeOpacity={s.borderOpacity}
            strokeWidth={
              s.borderPosition === 'center' ? s.borderWidth : s.borderWidth * 2
            }
            strokeDasharray={
              s.borderStyle === 'dashed'
                ? `${s.borderWidth * 3} ${s.borderWidth * 2}`
                : s.borderStyle === 'dotted'
                  ? `0 ${s.borderWidth * 2}`
                  : undefined
            }
            strokeLinecap={s.borderStyle === 'dotted' ? 'round' : undefined}
            clipPath={
              s.borderPosition === 'inside' ? `url(#${clip})` : undefined
            }
            mask={s.borderPosition === 'outside' ? `url(#${mask})` : undefined}
          />
        )}
        {i.kind === 'image' && (
          <path
            d={`M4 4L${w - 4} ${h - 4}M${w - 4} 4L4 ${h - 4}`}
            stroke="#94a3b8"
          />
        )}
        {s.textVisible &&
          label(
            text,
            s.textAlign === 'left'
              ? 8
              : s.textAlign === 'right'
                ? w - 8
                : w / 2,
            h / 2,
            slot && i.fontSize === undefined
              ? Math.max(10, Math.min(22, w / 3, h / 3))
              : s.fontSize,
          )}
        {slot &&
          i.kind === 'items' &&
          s.textVisible &&
          label(String(slot.quantity), w - 8, h - 12, 12, 'end')}
        {slot &&
          i.kind === 'skills' &&
          i.cooldownText &&
          cooldown > 0 &&
          label(
            slot.cooldownTotal
              ? `${Math.ceil((slot.cooldownTotal * cooldown) / 100)}s`
              : `${Math.round(cooldown)}%`,
            w / 2,
            h - 12,
            12,
          )}
      </g>
    );
  };
  if (strip) {
    const cols = Math.min(i.count, i.columns),
      rows = Math.ceil(i.count / cols),
      w = Math.max(8, (i.width - (cols - 1) * i.gap) / cols),
      h = Math.max(8, (i.height - (rows - 1) * i.gap) / rows);
    return (
      <g>
        {i.slots.slice(0, i.count).map((s, n) => (
          <g
            key={s.id}
            transform={`translate(${(n % cols) * (w + i.gap)} ${Math.floor(n / cols) * (h + i.gap)})`}
          >
            {content(w, h, `${id}-${s.id}`, s, n)}
          </g>
        ))}
      </g>
    );
  }
  return content(i.width, i.height, id);
}
export function GameUiGraphic({
  frame,
  prefix = 'export',
  previews,
}: {
  frame: GameUiFrame;
  prefix?: string;
  previews?: Record<string, GameUiPreview>;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={frame.viewportWidth}
      height={frame.viewportHeight}
      viewBox={`0 0 ${frame.viewportWidth} ${frame.viewportHeight}`}
    >
      <rect width="100%" height="100%" fill="#ffffff" />
      {frame.items.map((i) => (
        <g key={i.id} transform={gameUiTransform(i)}>
          <GameUiItemGraphic
            item={i}
            prefix={prefix}
            preview={previews?.[i.id]}
          />
        </g>
      ))}
    </svg>
  );
}
