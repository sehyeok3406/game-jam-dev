import { useRuntime } from '../../ui/runtime/runtime-context.ts';
import { useEffect, useState } from 'react';
import { nearDocumentPosition } from '../../canvas-placement.ts';
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
  const { preferences } = useRuntime();

  const read = () => {
    try {
      const parsed = JSON.parse(preferences.getItem(key) ?? 'null');
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
      preferences.setItem(key, JSON.stringify(value));
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
  visibility?: {
    enabled: boolean;
    mode: 'all' | 'selected';
    canvasIds: string[];
  };
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
export const kanbanSizeLimits = {
  minWidth: 520,
  minHeight: 260,
  maxWidth: 4000,
  maxHeight: 3000,
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
    width: Math.max(
      kanbanSizeLimits.minWidth,
      Math.min(kanbanSizeLimits.maxWidth, finite(v.width, 960)),
    ),
    height: Math.max(
      kanbanSizeLimits.minHeight,
      Math.min(kanbanSizeLimits.maxHeight, finite(v.height, 520)),
    ),
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
  return nearDocumentPosition({ width, height }, bounds, origin);
}

export function kanbanVisibility(layouts: KanbanLayouts) {
  const saved = layouts.visibility;
  if (saved)
    return {
      enabled: saved.enabled === true,
      mode: saved.mode === 'all' ? ('all' as const) : ('selected' as const),
      canvasIds: Array.isArray(saved.canvasIds)
        ? saved.canvasIds.filter((id): id is string => typeof id === 'string')
        : [],
    };
  const canvasIds = Object.entries(layouts.canvases ?? {})
    .filter(([, p]) => p.enabled)
    .map(([id]) => id);
  return {
    enabled: canvasIds.length > 0,
    mode: 'selected' as const,
    canvasIds,
  };
}
export function boardVisible(layouts: KanbanLayouts, id: string) {
  const v = kanbanVisibility(layouts);
  return v.enabled && (v.mode === 'all' || v.canvasIds.includes(id));
}
