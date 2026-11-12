import { useEffect, useMemo, useRef, useState } from 'react';
import {
  compactSize,
  fileNodeStyle,
  type CompactSize,
  type FileNodeStyle,
} from '../../core/canvas/file-node-style';
import type { CanvasDocument } from '../../contracts/documents';
import type { PreviewResult } from '../../contracts/preview';
import { useRuntime } from '../runtime/RuntimeProvider';
import { htmlNodeKey, markdownNodeKey } from './file-node-identity';

type View = CompactSize & { expanded?: boolean };
type Views = Record<string, View>;
const styleKey = 'gamejam:file-node-style:v1';

function parseObject(raw: string | null) {
  try {
    const value = JSON.parse(raw ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

export function useFileNodePreferences(
  scope: string,
  documents: CanvasDocument[],
  previews: PreviewResult[],
  report: (error: unknown) => void,
) {
  const { preferences } = useRuntime();
  const key = `gamejam:file-node-views:v1:${scope}`;
  const [style, setStyle] = useState(() =>
    fileNodeStyle(parseObject(preferences.getItem(styleKey))),
  );
  const initial = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(parseObject(preferences.getItem(key))).flatMap(
          ([id, value]) => {
            if (!value || typeof value !== 'object') return [];
            const view = value as Partial<View>;
            return [[id, { ...compactSize(view), expanded: view.expanded }]];
          },
        ),
      ) as Views,
    [preferences, key],
  );
  const [stored, setStored] = useState<{ key: string; views: Views }>();
  const views = stored?.key === key ? stored.views : initial;
  const live = useRef({ key, views, report });
  live.current = { key, views, report };
  const ids = useMemo(
    () => [
      ...documents
        .filter((document) => !document.asset && document.type !== 'ai-task')
        .map(markdownNodeKey),
      ...previews.map(htmlNodeKey),
    ],
    [documents, previews],
  );

  function write(next: Views) {
    if (live.current.key !== key) return;
    preferences.setItem(key, JSON.stringify(next));
    live.current.views = next;
    setStored({ key, views: next });
  }

  function update(id: string, patch: Partial<View>) {
    if (live.current.key !== key) return;
    const current = live.current.views;
    const value = {
      ...compactSize(current[id] ?? style),
      expanded: current[id]?.expanded,
      ...patch,
    };
    write({
      ...current,
      [id]: { ...compactSize(value), expanded: value.expanded },
    });
  }

  useEffect(() => {
    const missing = ids.filter((id) => !Object.hasOwn(views, id));
    if (!missing.length) return;
    try {
      write({
        ...views,
        ...Object.fromEntries(missing.map((id) => [id, compactSize(style)])),
      });
    } catch (error) {
      live.current.report(error);
    }
  }, [key, ids, views, style]);

  return {
    style,
    views,
    view: (id: string) => ({
      ...compactSize(views[id] ?? style),
      expanded: views[id]?.expanded === true,
    }),
    update,
    interact(id: string, patch: Partial<View>) {
      try {
        update(id, patch);
      } catch (error) {
        setStored({ key, views: { ...live.current.views } });
        live.current.report(error);
      }
    },
    save(value: FileNodeStyle) {
      const normalized = fileNodeStyle(value);
      preferences.setItem(styleKey, JSON.stringify(normalized));
      setStyle(normalized);
    },
    applyAll() {
      const current = live.current.views;
      write({
        ...current,
        ...Object.fromEntries(
          ids.map((id) => [
            id,
            { ...compactSize(style), expanded: current[id]?.expanded },
          ]),
        ),
      });
    },
  };
}

export type FileNodePreferences = ReturnType<typeof useFileNodePreferences>;
