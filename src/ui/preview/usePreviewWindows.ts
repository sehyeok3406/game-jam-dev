import type { ReactFlowInstance } from '@xyflow/react';
import { useCallback, useRef } from 'react';
import {
  normalizePreviewWindow,
  selectPreviewPreset,
} from '../../preview-window.ts';
import type { PreviewWindowState } from '../../shared.ts';
import type { SelectionScope } from '../canvas/selection-actions.ts';
import { useViewLifetime } from '../workspace/useViewLifetime.ts';
import {
  previewNodeId,
  type CanvasNode,
} from '../workspace/workspace-types.ts';
interface Ports {
  setPreviewWindows: import('react').Dispatch<
    import('react').SetStateAction<Record<string, PreviewWindowState>>
  >;
  api: import('../../contracts/app-api.ts').AppApi;
  showError: (error: unknown) => void;
  previewWindows: Record<string, PreviewWindowState>;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
}
export function usePreviewWindows(scope: SelectionScope, ports: () => Ports) {
  const isCurrent = useViewLifetime(scope);
  const sequence = useRef(0);
  const pending = useRef(new Map<string, number>());
  const live = useRef(ports);
  live.current = ports;
  const updatePreviewWindows = useCallback(
    async (windows: { relative: string; state: PreviewWindowState }[]) => {
      if (!windows.length) return;
      const { api, setPreviewWindows } = live.current();
      if (!isCurrent()) return;
      const ticket = ++sequence.current;
      for (const { relative } of windows) pending.current.set(relative, ticket);
      const normalized = windows.map(({ relative, state }) => ({
        relative,
        state: normalizePreviewWindow(state),
      }));
      const results = await Promise.allSettled(
        normalized.map(({ relative, state }) =>
          api.preview.savePreviewWindow(state, relative),
        ),
      );
      if (!isCurrent()) return;
      setPreviewWindows((current) => ({
        ...current,
        ...Object.fromEntries(
          normalized.flatMap(({ relative, state }, index) =>
            results[index].status === 'fulfilled' &&
            pending.current.get(relative) === ticket
              ? [[relative, state]]
              : [],
          ),
        ),
      }));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
    [isCurrent],
  );
  const updatePreviewWindow = useCallback(
    async (relative: string, state: PreviewWindowState) => {
      const { setPreviewWindows, api, showError } = live.current();

      if (!isCurrent()) return;
      pending.current.set(relative, ++sequence.current);
      const normalized = normalizePreviewWindow(state);
      setPreviewWindows((current) => ({ ...current, [relative]: normalized }));
      try {
        await api.preview.savePreviewWindow(normalized, relative);
      } catch (error) {
        if (isCurrent()) showError(error);
      }
    },
    [isCurrent],
  );

  const compareWindows = async (a: string, b: string, presetId: string) => {
    const { setPreviewWindows, api, previewWindows, flowRef, setNotice } =
      ports();

    if (a === b) throw new Error('서로 다른 버전을 선택해주세요.');
    let first = previewWindows[a],
      second = previewWindows[b];
    if (!first || !second) throw new Error('결과 창을 찾을 수 없습니다.');
    if (presetId) {
      first = selectPreviewPreset(first, presetId);
      second = selectPreviewPreset(second, presetId);
    }
    first = { ...first, collapsed: false };
    second = {
      ...second,
      collapsed: false,
      x: first.x + first.width + 48,
      y: first.y,
    };
    await Promise.all([
      api.preview.savePreviewWindow(first, a),
      api.preview.savePreviewWindow(second, b),
    ]);
    if (!isCurrent()) return;
    setPreviewWindows((current) => ({ ...current, [a]: first, [b]: second }));
    setTimeout(
      () =>
        isCurrent() &&
        void flowRef.current?.fitView({
          nodes: [{ id: previewNodeId(a) }, { id: previewNodeId(b) }],
          padding: 0.16,
          duration: 300,
        }),
      80,
    );
    setNotice('두 결과를 나란히 배치했습니다.');
  };

  return { updatePreviewWindow, updatePreviewWindows, compareWindows };
}
