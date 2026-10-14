import type {
  GameUiItem,
  GameUiStyle,
  GameUiDetails,
  GameUiState,
} from './game-ui-types.ts';

export const GAME_UI_DETAIL_KEYS = [
  'backgroundColor',
  'backgroundOpacity',
  'borderColor',
  'borderOpacity',
  'borderWidth',
  'borderStyle',
  'borderPosition',
  'cornerRadius',
  'cornerRadii',
  'fillColor',
  'fillOpacity',
  'textColor',
  'textOpacity',
  'fontSize',
  'textAlign',
  'textVisible',
  'opacity',
  'rotation',
  'minimum',
  'step',
  'decimals',
  'valueFormat',
  'fillDirection',
  'radialStart',
  'radialSweep',
  'clockwise',
  'ringWidth',
  'segments',
  'segmentGap',
  'segmentSnap',
  'thresholds',
  'state',
  'stateStyles',
  'cooldownDirection',
  'cooldownColor',
  'cooldownOpacity',
  'cooldownText',
  'transitionDuration',
  'deltaColor',
  'deltaDuration',
] as const satisfies readonly (keyof GameUiDetails)[];
export const GAME_UI_STYLE_KEYS = GAME_UI_DETAIL_KEYS.slice(
  0,
  17,
) as (keyof GameUiStyle)[];
export const GAME_UI_STATES = {
  normal: '기본',
  hover: '호버',
  pressed: '누름',
  disabled: '비활성',
  selected: '선택',
} as const;
export const isGauge = (i: GameUiItem) =>
  ['health', 'mana', 'stamina', 'experience'].includes(i.kind);
const color = (v: unknown) => typeof v === 'string' && /^#[a-f\d]{6}$/i.test(v);
const num = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const values: Partial<Record<keyof GameUiDetails, readonly string[]>> = {
  borderStyle: ['solid', 'dashed', 'dotted'],
  borderPosition: ['inside', 'center', 'outside'],
  textAlign: ['left', 'center', 'right'],
  valueFormat: ['fraction', 'value', 'percent', 'none'],
  fillDirection: [
    'right',
    'left',
    'up',
    'down',
    'center-x',
    'center-y',
    'radial',
  ],
  state: Object.keys(GAME_UI_STATES),
  cooldownDirection: ['down', 'radial'],
};
export function validGameUiDetails(i: GameUiDetails): boolean {
  for (const key of GAME_UI_DETAIL_KEYS) {
    const v = i[key];
    if (v === undefined) continue;
    if (values[key]) {
      if (!values[key]!.includes(v as string)) return false;
      continue;
    }
    if (key.endsWith('Color')) {
      if (!color(v)) return false;
      continue;
    }
    if (key.endsWith('Opacity') || key === 'opacity') {
      if (!num(v, 0, 1)) return false;
      continue;
    }
    if (
      ['textVisible', 'clockwise', 'segmentSnap', 'cooldownText'].includes(key)
    ) {
      if (typeof v !== 'boolean') return false;
      continue;
    }
    if (key === 'cornerRadii') {
      if (
        v !== null &&
        (!Array.isArray(v) ||
          v.length !== 4 ||
          !v.every((n) => num(n, 0, 4096)))
      )
        return false;
      continue;
    }
    if (key === 'thresholds') {
      const rules = v as NonNullable<GameUiDetails['thresholds']>;
      if (
        !Array.isArray(v) ||
        v.length > 8 ||
        rules.some(
          (t, n) =>
            !t ||
            !num(t.below, 0, 100) ||
            !color(t.color) ||
            (n > 0 && t.below <= rules[n - 1].below),
        )
      )
        return false;
      continue;
    }
    if (key === 'stateStyles') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      for (const [state, style] of Object.entries(v)) {
        if (
          !Object.hasOwn(GAME_UI_STATES, state) ||
          !style ||
          typeof style !== 'object' ||
          Array.isArray(style) ||
          Object.keys(style).some(
            (k) => !GAME_UI_STYLE_KEYS.includes(k as keyof GameUiStyle),
          ) ||
          !validGameUiDetails(style)
        )
          return false;
      }
      continue;
    }
    const [min, max] =
      key === 'rotation' || key === 'radialStart'
        ? [-360, 360]
        : key === 'minimum'
          ? [-1e9, 1e9]
          : key === 'step'
            ? [0.000001, 1e9]
            : key === 'decimals'
              ? [0, 6]
              : key === 'segments'
                ? [1, 100]
                : key === 'radialSweep'
                  ? [1, 360]
                  : key === 'fontSize'
                    ? [1, 512]
                    : key.endsWith('Duration')
                      ? [0, 5000]
                      : [0, 4096];
    if (
      !num(v, min, max) ||
      (['segments', 'decimals'].includes(key) && !Number.isInteger(v))
    )
      return false;
  }
  return true;
}
function mix(a: string, b: string, t: number) {
  return (
    '#' +
    [1, 3, 5]
      .map((n) =>
        Math.round(
          parseInt(a.slice(n, n + 2), 16) * (1 - t) +
            parseInt(b.slice(n, n + 2), 16) * t,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function gameUiStyle(
  i: GameUiItem,
  state: GameUiState = i.state ?? 'normal',
): GameUiStyle {
  const base: GameUiStyle = {
    backgroundColor: ['button', 'panel'].includes(i.kind)
      ? mix('#f1f5f9', i.color, 0.25)
      : '#f1f5f9',
    backgroundOpacity: 1,
    borderColor:
      i.kind === 'skills' || i.kind === 'items' ? '#64748b' : i.color,
    borderOpacity: 1,
    borderWidth: 2,
    borderStyle: 'solid',
    borderPosition: 'center',
    cornerRadius: Math.min(12, i.height / 4),
    cornerRadii: null,
    fillColor: i.color,
    fillOpacity: 0.65,
    textColor: i.kind === 'text' ? i.color : '#0f172a',
    textOpacity: 1,
    fontSize: Math.max(12, Math.min(24, i.height / 3)),
    textAlign: 'center',
    textVisible: true,
    opacity: 1,
  };
  for (const k of GAME_UI_STYLE_KEYS)
    if (i[k] !== undefined) Object.assign(base, { [k]: i[k] });
  if (state === 'disabled' && !i.stateStyles?.disabled) base.opacity *= 0.45;
  if (state === 'hover' && !i.stateStyles?.hover)
    base.backgroundColor = mix(base.backgroundColor, '#ffffff', 0.15);
  if (state === 'pressed' && !i.stateStyles?.pressed)
    base.backgroundColor = mix(base.backgroundColor, '#000000', 0.15);
  return { ...base, ...i.stateStyles?.[state] };
}
export function gameUiRatio(i: GameUiItem, value = i.value) {
  return Math.max(
    0,
    Math.min(1, (value - (i.minimum ?? 0)) / (i.maximum - (i.minimum ?? 0))),
  );
}
export function gameUiValueText(i: GameUiItem, value = i.value) {
  const n = (v: number) => v.toFixed(i.decimals ?? 0);
  const format = i.valueFormat ?? 'fraction';
  return format === 'none'
    ? i.text
    : format === 'value'
      ? `${i.text} ${n(value)}`
      : format === 'percent'
        ? `${i.text} ${n(gameUiRatio(i, value) * 100)}%`
        : `${i.text} ${n(value)}/${n(i.maximum)}`;
}
export function gameUiFillColor(i: GameUiItem, ratio = gameUiRatio(i)) {
  return (
    i.thresholds?.find((t) => ratio * 100 <= t.below)?.color ??
    gameUiStyle(i).fillColor
  );
}
export function gameUiTransform(i: GameUiItem) {
  return `translate(${i.x} ${i.y}) rotate(${i.rotation ?? 0} ${i.width / 2} ${i.height / 2})`;
}
export function gameUiBounds(i: GameUiItem) {
  const r = ((i.rotation ?? 0) * Math.PI) / 180,
    c = Math.abs(Math.cos(r)),
    s = Math.abs(Math.sin(r));
  const width = i.width * c + i.height * s,
    height = i.width * s + i.height * c;
  return {
    x: i.x + (i.width - width) / 2,
    y: i.y + (i.height - height) / 2,
    width,
    height,
  };
}
export function gameUiResize(i: GameUiItem, dx: number, dy: number) {
  const r = ((i.rotation ?? 0) * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  const width = Math.max(8, Math.min(8192, i.width + dx * c + dy * s)),
    height = Math.max(8, Math.min(8192, i.height - dx * s + dy * c));
  const dw = width - i.width,
    dh = height - i.height;
  return {
    width,
    height,
    x: i.x + (dw * c - dh * s - dw) / 2,
    y: i.y + (dw * s + dh * c - dh) / 2,
  };
}
export function gameUiRangePatch(
  i: GameUiItem,
  change: Partial<Pick<GameUiItem, 'minimum' | 'maximum' | 'value'>>,
) {
  const minimum = change.minimum ?? i.minimum ?? 0,
    maximum = change.maximum ?? i.maximum;
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum <= minimum
  )
    throw Error('최대 값은 최소 값보다 커야 합니다.');
  return {
    minimum,
    maximum,
    value: Math.min(maximum, Math.max(minimum, change.value ?? i.value)),
  };
}
