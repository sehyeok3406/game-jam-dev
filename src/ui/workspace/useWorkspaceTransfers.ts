import { useRef } from 'react';
import type { AppApi } from '../../contracts/app-api.ts';
import type { MoveResultInput } from '../../contracts/results.ts';
import type {
  CanvasSheetCommand,
  CanvasSheets,
  PreviewResult,
} from '../../shared.ts';
import {
  selectionScopeKey,
  type SelectionScope,
} from '../canvas/selection-actions.ts';
import {
  canvasTransferPlan,
  type CanvasTransfer,
} from '../canvas/transfer-plan.ts';
import { useScopedPrompt } from '../canvas/useSelectionActions.ts';
import { useViewLifetime } from './useViewLifetime.ts';

interface Ports {
  api: AppApi;
  canvasSheets: CanvasSheets;
  flushEditors: () => Promise<void>;
  loadProject: (fit?: boolean) => Promise<void>;
  changeSheets: (command: CanvasSheetCommand) => Promise<void>;
  canvasBatch: (
    commands: { channel: string; input: unknown }[],
  ) => Promise<unknown[]>;
  setSelectedIds: (ids: string[]) => void;
  setSelectedSectionIds: (ids: string[]) => void;
  setNotice: (notice: string) => void;
  showError: (error: unknown) => void;
}

export function useWorkspaceTransfers(
  scope: SelectionScope,
  ports: () => Ports,
) {
  const key = selectionScopeKey(scope),
    isCurrent = useViewLifetime(scope);
  const [movingCanvasItems, setMovingCanvasItems] =
    useScopedPrompt<CanvasTransfer | null>(key, null);
  const [moveCanvasTarget, setMoveCanvasTarget] = useScopedPrompt(key, '');
  const [canvasOperationBusy, setCanvasOperationBusy] = useScopedPrompt(
    key,
    false,
  );
  const [resultFolderPrompt, setResultFolderPrompt] = useScopedPrompt<
    PreviewResult | 'legacy' | null
  >(key, null);
  const [movingResults, setMovingResults] = useScopedPrompt(key, false);
  const pending = useRef(false);

  const moveCanvasItems = async () => {
    if (
      !movingCanvasItems ||
      !moveCanvasTarget ||
      pending.current ||
      !isCurrent()
    )
      return;
    const p = ports(),
      plan = canvasTransferPlan(
        movingCanvasItems,
        moveCanvasTarget,
        p.canvasSheets.raw ?? null,
      );
    pending.current = true;
    setCanvasOperationBusy(true);
    try {
      // Includes drawings and game UI flush before either transaction path.
      await p.flushEditors();
      if (!isCurrent()) return;
      if (plan.mixed) {
        await p.canvasBatch(plan.commands);
        if (isCurrent()) await p.loadProject(false);
      } else await p.changeSheets(plan.command);
      if (!isCurrent()) return;
      setMovingCanvasItems(null);
      p.setSelectedIds([]);
      p.setSelectedSectionIds([]);
    } catch (error) {
      if (isCurrent()) p.showError(error);
    } finally {
      pending.current = false;
      setCanvasOperationBusy(false);
    }
  };
  const saveResultFolder = async (input?: MoveResultInput) => {
    if (pending.current || !isCurrent()) return;
    pending.current = true;
    setMovingResults(true);
    const p = ports();
    try {
      await p.flushEditors();
      if (!isCurrent()) return;
      let count = 0;
      if (input) {
        const latest = (await p.api.preview.listPreviews()).find(
          (item) => item.relativePath === input.relativePath,
        );
        if (!isCurrent()) return;
        if (!latest) throw new Error('이동할 HTML 결과를 찾을 수 없습니다.');
        await p.api.editor.moveResult({ ...input, revision: latest.revision });
      } else count = (await p.api.editor.organizeResults()).length;
      if (!isCurrent()) return;
      await p.loadProject(false);
      if (!isCurrent()) return;
      setResultFolderPrompt(null);
      p.setNotice(
        input
          ? '결과물과 관련 파일을 새 폴더로 이동했습니다.'
          : `${count}개 결과물을 미분류·기능·버전 폴더로 정리했습니다.`,
      );
    } finally {
      pending.current = false;
      setMovingResults(false);
    }
  };
  return {
    movingCanvasItems,
    setMovingCanvasItems,
    moveCanvasTarget,
    setMoveCanvasTarget,
    canvasOperationBusy,
    setCanvasOperationBusy,
    resultFolderPrompt,
    setResultFolderPrompt,
    movingResults,
    setMovingResults,
    moveCanvasItems,
    saveResultFolder,
  };
}
