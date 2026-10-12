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
  const [state, setState] = useState<T>(read);
  useEffect(() => {
    setState(read());
  }, [key]);
  const update = (value: T) => {
    setState(value);
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
