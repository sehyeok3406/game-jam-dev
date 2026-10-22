import { useCallback, useRef } from 'react';
import type { HistoryEntry } from '../../shared.ts';
import {
  selectionScopeKey,
  type SelectionScope,
} from '../canvas/selection-actions.ts';
import { useScopedPrompt } from '../canvas/useSelectionActions.ts';
import { useViewLifetime } from '../workspace/useViewLifetime.ts';
interface Ports {
  setHistoryOpen: (value: import('react').SetStateAction<boolean>) => void;
  setNavigatorOpen: (value: import('react').SetStateAction<boolean>) => void;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setSettingsOpen: (value: import('react').SetStateAction<boolean>) => void;
  setCodexRunCollapsed: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  api: import('../../contracts/app-api.ts').AppApi;
  showError: (error: unknown) => void;
  locked: boolean;
  onBlocked: () => void;
  blockAiFiles: (paths: string[]) => boolean;
  editorsRef: import('react').RefObject<
    Map<string, (finish?: boolean) => Promise<void>>
  >;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
}
export function useWorkspaceHistory(scope: SelectionScope, ports: () => Ports) {
  const key = selectionScopeKey(scope);
  const isCurrent = useViewLifetime(scope);
  const live = useRef(ports);
  live.current = ports;
  const restorePending = useRef(false);
  const [historyFilter, setHistoryFilter] = useScopedPrompt<string | null>(
    key,
    null,
  );
  const [historyEntries, setHistoryEntries] = useScopedPrompt<HistoryEntry[]>(
    key,
    [],
  );
  const [historyAiOnly, setHistoryAiOnly] = useScopedPrompt(key, false);
  const [aiHistorySelection, setAiHistorySelection] =
    useScopedPrompt<HistoryEntry | null>(key, null);

  const [historySelection, setHistorySelection] = useScopedPrompt<{
    entry: HistoryEntry;
    path: string;
    version: 'before' | 'after';
    content: string | null;
  } | null>(key, null);
  const [historyConfirm, setHistoryConfirm] = useScopedPrompt<{
    entry: HistoryEntry;
    path?: string;
    version?: 'before' | 'after';
  } | null>(key, null);
  const [restoring, setRestoring] = useScopedPrompt(key, false);
  const historyRequest = useRef(0);

  const openHistory = useCallback(
    (relative: string | null = null, aiOnly = false, entry?: HistoryEntry) => {
      const {
        setHistoryOpen,
        setNavigatorOpen,
        setInspectorId,
        setSettingsOpen,
        setCodexRunCollapsed,
        api,
        showError,
      } = live.current();

      historyRequest.current += 1;
      setHistoryFilter(relative);
      setHistorySelection(null);
      setHistoryAiOnly(aiOnly);
      setAiHistorySelection(entry ?? null);
      setHistoryOpen(true);
      setNavigatorOpen(false);
      setInspectorId(null);
      setSettingsOpen(false);
      setCodexRunCollapsed(true);
      const request = historyRequest.current;
      void api.history
        .listHistory()
        .then((entries) => {
          if (isCurrent() && request === historyRequest.current)
            setHistoryEntries(entries);
        })
        .catch((error) => {
          if (isCurrent() && request === historyRequest.current)
            showError(error);
        });
    },
    [isCurrent],
  );
  const inspectHistory = async (
    entry: HistoryEntry,
    relative: string,
    version: 'before' | 'after',
  ) => {
    const { api, showError } = live.current();

    const request = ++historyRequest.current;
    setAiHistorySelection(null);
    try {
      const content = await api.history.readHistoryFile(
        entry.id,
        relative,
        version,
      );
      if (isCurrent() && request === historyRequest.current)
        setHistorySelection({ entry, path: relative, version, content });
    } catch (error) {
      if (isCurrent()) showError(error);
    }
  };
  const restoreSelectedHistory = async () => {
    const {
      api,
      showError,
      locked,
      onBlocked,
      blockAiFiles,
      editorsRef,
      loadProject,
      setNotice,
    } = live.current();

    if (!historyConfirm || restoring) return;
    if (locked) {
      onBlocked();
      return;
    }
    if (
      blockAiFiles(
        historyConfirm.entry.files
          .filter(
            (file) =>
              !historyConfirm.path || file.relativePath === historyConfirm.path,
          )
          .map((file) => file.relativePath),
      )
    )
      return;
    if (restorePending.current) return;
    restorePending.current = true;
    setRestoring(true);
    try {
      await Promise.all(
        [...editorsRef.current.values()].map((flush) => flush()),
      );
      if (!isCurrent()) return;
      await api.history.restoreHistory(
        historyConfirm.entry.id,
        historyConfirm.path,
        historyConfirm.version,
      );
      if (!isCurrent()) return;
      setHistoryConfirm(null);
      await loadProject(false);
      const entries = await api.history.listHistory();
      if (!isCurrent()) return;
      setHistoryEntries(entries);
      setNotice(
        '선택한 버전을 복원했습니다. 복원 직전 내용도 히스토리에 보관됩니다.',
      );
    } catch (error) {
      if (isCurrent()) showError(error);
    } finally {
      restorePending.current = false;
      setRestoring(false);
    }
  };

  return {
    setHistoryEntries,
    setHistorySelection,
    setAiHistorySelection,
    openHistory,
    historyConfirm,
    restoring,
    historyEntries,
    historyAiOnly,
    historyFilter,
    setHistoryConfirm,
    setRestoring,
    aiHistorySelection,
    historySelection,
    historyRequest,
    setHistoryAiOnly,
    inspectHistory,
    restoreSelectedHistory,
  };
}
