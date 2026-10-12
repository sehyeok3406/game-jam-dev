import { useEffect, useState } from 'react';
export type KanbanPreferences = {
  enabled: boolean;
  minimized: boolean;
  scope: 'canvas' | 'project';
  x: number;
  y: number;
  width: number;
  height: number;
};
export function usePersonalValue<T>(key: string, fallback: T) {
  const read = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
      return parsed && typeof parsed === 'object'
        ? ({ ...fallback, ...parsed } as T)
        : fallback;
    } catch {
      return fallback;
    }
  };
  const [stored, setStored] = useState(() => ({ key, value: read() }));
  const state = stored.key === key ? stored.value : read();
  useEffect(() => {
    setStored({ key, value: read() });
  }, [key]);
  const update = (value: T) => {
    setStored({ key, value });
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* The current view still works when personal storage is full. */
    }
  };
  return [state, update] as const;
}
export const defaultKanban: KanbanPreferences = {
  enabled: true,
  minimized: true,
  scope: 'canvas',
  x: 24,
  y: 90,
  width: 960,
  height: 480,
};

export type KanbanCanvasPreferences = KanbanPreferences & { placed: boolean };
export type KanbanLayouts = {
  version: 2;
  legacyMigrated: boolean;
  canvases: Record<string, KanbanCanvasPreferences>;
};
export const emptyKanbanLayouts: KanbanLayouts = {
  version: 2,
  legacyMigrated: false,
  canvases: {},
};
export const defaultCanvasKanban: KanbanCanvasPreferences = {
  ...defaultKanban,
  enabled: false,
  minimized: false,
  x: 0,
  y: 0,
  height: 520,
  placed: false,
};
export function readCanvasKanban(value: unknown): KanbanCanvasPreferences {
  const v =
    value && typeof value === 'object'
      ? (value as Partial<KanbanCanvasPreferences>)
      : {};
  const finite = (n: unknown, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return {
    enabled: v.enabled === true,
    minimized: v.minimized === true,
    scope: v.scope === 'project' ? 'project' : 'canvas',
    x: finite(v.x, 0),
    y: finite(v.y, 0),
    width: Math.max(520, Math.min(4000, finite(v.width, 960))),
    height: Math.max(260, Math.min(3000, finite(v.height, 520))),
    placed: v.placed === true,
  };
}
export function migrateKanbanLayout(
  raw: string | null,
  screenToFlow: (p: { x: number; y: number }) => { x: number; y: number },
  zoom: number,
) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const old = readCanvasKanban(v),
      point = screenToFlow({ x: old.x, y: old.y });
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    return readCanvasKanban({
      ...old,
      ...point,
      width: old.width / scale,
      height: old.height / scale,
      placed: true,
    });
  } catch {
    return null;
  }
}
export function blankBoardPosition(
  origin: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number }[],
  width: number,
  height: number,
) {
  const overlaps = (p: { x: number; y: number }) =>
    bounds.some(
      (b) =>
        p.x < b.x + b.width + 40 &&
        p.x + width + 40 > b.x &&
        p.y < b.y + b.height + 40 &&
        p.y + height + 40 > b.y,
    );
  for (let ring = 0; ring < 8; ring++) {
    const candidates = [
      { x: origin.x + ring * (width + 40), y: origin.y },
      { x: origin.x, y: origin.y + ring * (height + 40) },
    ];
    for (const p of candidates) if (!overlaps(p)) return p;
  }
  return {
    x: origin.x,
    y: Math.max(origin.y, ...bounds.map((b) => b.y + b.height)) + 40,
  };
}
