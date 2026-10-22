import type { ReactFlowInstance } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { DrawingCommand, DrawingObject } from '../../drawing-types.ts';
import type { CanvasDocument, WorkspaceState } from '../../shared.ts';
import type { SelectionScope } from './selection-actions.ts';
import { copiedSelection } from './selection-plan.ts';
import type { DrawingCanvasNode } from '../drawing/DrawingNode';
import { requireDesktopApi } from '../runtime/desktop-api.ts';
import { useViewLifetime } from '../workspace/useViewLifetime.ts';
import type { CanvasNode } from '../workspace/workspace-types.ts';
interface Ports {
  capabilities: Readonly<{
    localFiles: boolean;
    localAiExecution: boolean;
    selfHostManagement: boolean;
    appUpdates: boolean;
    nativeClipboard: boolean;
    multiplayer: boolean;
  }>;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  documents: CanvasDocument[];
  selectedIds: string[];
  nodes: CanvasNode[];
  clipboardWorkspaceRef: import('react').RefObject<WorkspaceState>;
  api: import('../../contracts/app-api.ts').AppApi;
  showError: (error: unknown) => void;
  locked: boolean;
  onBlocked: () => void;
  activeCanvasRef: import('react').RefObject<string>;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  cancelNoteDrawing: () => void;
  cancelSelectionDrag: () => void;
  drawingGesture: boolean;
  drawingCopies: (objects: DrawingObject[], offset?: number) => DrawingObject[];
  drawing: {
    items: import('../../drawing-types').DrawingItem[];
    submit: (
      command: Omit<DrawingCommand, 'canvasId' | 'scope'> & {
        canvasId?: string;
      },
    ) => Promise<void>;
    flush: () => Promise<void>;
    reload: () => Promise<void>;
    partial: (object: DrawingObject | null) => void;
    error: string;
    recovery: DrawingCommand[] | null;
    recover: () => Promise<void>;
    discardRecovery: () => Promise<void>;
    retry: () => void;
    hold: () => Promise<void>;
    saving: boolean;
  };
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  setSelectedIds: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  setSelectedSectionIds: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  imagePurpose: 'asset' | 'diagram';
  selectCreated: (ids: string[], ready?: () => void) => void;
}
export function useCanvasClipboard(
  scope: SelectionScope,
  contextId: string | undefined,
  ports: () => Ports,
) {
  const isCurrent = useViewLifetime(scope);
  const drawingClipboard = useRef<DrawingObject[] | null>(null);
  const drawingPasteCount = useRef(0);

  const canvasClipboardRef = useRef<{
    documents: { id: string; path: string }[];
    pasteCount: number;
    copyId: string;
    contextId: string;
  } | null>(null);
  const clipboardActions = useRef<Promise<unknown>>(Promise.resolve());
  const queueClipboardAction = (action: () => Promise<void>) => {
    const next = clipboardActions.current.then(action);
    clipboardActions.current = next.catch(() => undefined);
    return next;
  };
  useEffect(() => {
    canvasClipboardRef.current = null;
    drawingClipboard.current = null;
    drawingPasteCount.current = 0;
  }, [contextId]);

  const copyCanvasSelection = () => {
    const {
      capabilities,
      setNotice,
      documents,
      selectedIds,
      nodes,
      clipboardWorkspaceRef,
      api,
      showError,
    } = ports();

    if (!capabilities.nativeClipboard)
      return setNotice('이 실행 환경에서는 클립보드를 사용할 수 없습니다.');
    const copied = copiedSelection(
      documents,
      selectedIds,
      nodes
        .filter(
          (node): node is DrawingCanvasNode =>
            !!node.selected && node.data.kind === 'drawing',
        )
        .map((node) => node.data.object),
    );
    const copiedDrawings = copied.drawings,
      copiedDocuments = copied.documents;
    if (!copiedDocuments.length && !copiedDrawings.length) {
      setNotice('복사할 메모 또는 파일을 선택하세요.');
      return;
    }
    const current = clipboardWorkspaceRef.current;
    const input = {
      scope: current.saveScope ?? '',
      contextId: current.clipboardContextId ?? '',
      copyId: crypto.randomUUID(),
    };
    void queueClipboardAction(async () => {
      await requireDesktopApi(api).markCanvasClipboard(input);
      if (clipboardWorkspaceRef.current.clipboardContextId !== input.contextId)
        return;
      drawingClipboard.current = copiedDrawings;
      drawingPasteCount.current = 0;
      canvasClipboardRef.current = {
        documents: copiedDocuments,
        pasteCount: 0,
        copyId: input.copyId,
        contextId: input.contextId,
      };
      setNotice(
        `${copiedDocuments.length}개 파일 · ${copiedDrawings.length}개 그림을 복사했습니다.`,
      );
    }).catch((error) => {
      if (clipboardWorkspaceRef.current.clipboardContextId === input.contextId)
        showError(error);
    });
  };

  const pasteCanvasSelection = () => {
    const { imagePurpose } = ports();
    const {
      capabilities,
      setNotice,
      clipboardWorkspaceRef,
      api,
      showError,
      locked,
      onBlocked,
      activeCanvasRef,
      flowRef,
      cancelNoteDrawing,
      cancelSelectionDrag,
      drawingGesture,
      drawingCopies,
      drawing,
      loadProject,
      setSelectedIds,
      setSelectedSectionIds,
      selectCreated,
    } = ports();

    if (!capabilities.nativeClipboard)
      return setNotice('이 실행 환경에서는 클립보드를 사용할 수 없습니다.');
    if (locked) return onBlocked();
    const current = clipboardWorkspaceRef.current;
    const target = {
      scope: current.saveScope ?? '',
      contextId: current.clipboardContextId ?? '',
      requestId: crypto.randomUUID(),
      canvasId: activeCanvasRef.current,
      imagePurpose,
      ...(flowRef.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 160, y: 140 }),
    };
    const sameProject = () =>
      clipboardWorkspaceRef.current.clipboardContextId === target.contextId;
    const sameView = () => sameProject() && isCurrent();
    cancelNoteDrawing();
    cancelSelectionDrag();
    if (drawingGesture)
      window.dispatchEvent(new Event('canvas-clipboard-paste'));
    void queueClipboardAction(async () => {
      if (!sameProject()) return;
      if (sameView()) setNotice('클립보드 이미지를 붙여넣는 중…');
      const copied = canvasClipboardRef.current;
      const result = await requireDesktopApi(api).pasteCanvasClipboard({
        ...target,
        internalCopyId: copied?.copyId,
      });
      if (!sameProject()) return;
      if (
        result.kind === 'empty' ||
        result.kind === 'unsupported' ||
        result.kind === 'stale-internal'
      ) {
        if (sameView())
          setNotice(
            {
              empty:
                '붙여넣을 이미지나 복사한 카드가 없습니다. 이미지를 복사한 뒤 다시 시도해주세요.',
              unsupported:
                'PNG, JPG, WebP, GIF 이미지 데이터를 붙여넣을 수 있습니다.',
              'stale-internal':
                '이전에 복사한 자료를 사용할 수 없습니다. 현재 프로젝트에서 다시 복사해주세요.',
            }[result.kind],
          );
        return;
      }
      let created: CanvasDocument[] = [];
      let copies: DrawingObject[] = [];
      if (result.kind === 'images') created = result.documents;
      else if (result.kind === 'internal') {
        if (
          !copied ||
          copied.copyId !== result.copyId ||
          copied.contextId !== target.contextId
        )
          return;
        const offset = (copied.pasteCount + 1) * 32;
        copies = drawingCopies(drawingClipboard.current ?? [], offset);
        const input = {
          scope: target.scope,
          clipboardContextId: target.contextId,
          requestId: target.requestId,
          canvasId: target.canvasId,
          documents: copied.documents,
          offsetX: offset,
          offsetY: offset,
        };
        await drawing.flush();
        if (!sameProject() || !isCurrent()) return;
        if (copies.length) {
          const commands: { channel: string; input: unknown }[] = [];
          if (copied.documents.length)
            commands.push({ channel: 'documents:duplicate', input });
          commands.push({
            channel: 'drawings:apply',
            input: {
              canvasId: target.canvasId,
              action: 'create',
              objects: copies,
            },
          });
          const results = await api.editor.applyCanvasCommands({
            scope: target.scope,
            clipboardContextId: target.contextId,
            requestId: target.requestId,
            commands,
          });
          created = copied.documents.length
            ? (results[0] as CanvasDocument[])
            : [];
        } else created = await api.editor.duplicateDocuments(input);
        copied.pasteCount++;
      }
      if (!sameProject()) return;
      try {
        await loadProject(false, true);
        if (!sameView()) return;
        await drawing.reload();
      } catch {
        if (sameView())
          setNotice(
            result.kind === 'images'
              ? '이미지는 저장됐지만 화면을 갱신하지 못했습니다. 프로젝트를 다시 열어 확인해주세요.'
              : '복사본은 저장됐지만 화면을 갱신하지 못했습니다. 프로젝트를 다시 열어 확인해주세요.',
          );
        return;
      }
      if (!sameView()) return;
      const createdIds = created.map((doc) => doc.id);
      setSelectedIds(createdIds);
      setSelectedSectionIds([]);
      selectCreated(
        [...createdIds, ...copies.map((o) => 'drawing:' + o.id)],
        () => {
          if (!sameView()) return;
          if (result.kind === 'images')
            void flowRef.current?.fitView({
              nodes: createdIds.map((id) => ({ id })),
              padding: 0.2,
              maxZoom: 1,
              duration: 300,
            });
        },
      );

      setNotice(
        result.kind === 'images'
          ? `이미지 ${created.length}개를 붙여넣었습니다.`
          : `${created.length}개 파일 · ${copies.length}개 그림의 복사본을 만들었습니다.`,
      );
    }).catch((error) => {
      if (sameView()) showError(error);
    });
  };

  return { copyCanvasSelection, pasteCanvasSelection };
}
