import type { ReactFlowInstance } from '@xyflow/react';
import { useRef } from 'react';
import type { WorkspaceState } from '../../shared.ts';
import {
  selectionScopeKey,
  type SelectionScope,
} from '../canvas/selection-actions.ts';
import { useScopedPrompt } from '../canvas/useSelectionActions.ts';
import { requireDesktopApi } from '../runtime/desktop-api.ts';
import { useViewLifetime } from './useViewLifetime.ts';
import { previewNodeId, type CanvasNode } from './workspace-types.ts';
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
  locked: boolean;
  onBlocked: () => void;
  workspace: WorkspaceState;
  openWorkspace: () => Promise<void>;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  api: import('../../contracts/app-api.ts').AppApi;
  activeCanvasRef: import('react').RefObject<string>;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  showError: (error: unknown) => void;
  selectCreated: (ids: string[], ready?: () => void) => void;
}
export function useWorkspaceImport(scope: SelectionScope, ports: () => Ports) {
  const key = selectionScopeKey(scope);
  const isCurrent = useViewLifetime(scope);
  const pending = useRef(false);
  const [importTarget, setImportTarget] = useScopedPrompt<{
    x: number;
    y: number;
  } | null>(key, null);
  const [imagePurpose, setImagePurpose] = useScopedPrompt<'asset' | 'diagram'>(
    key,
    'asset',
  );
  const [importingFiles, setImportingFiles] = useScopedPrompt(key, false);
  const [importError, setImportError] = useScopedPrompt(key, '');

  const openImport = (position?: { x: number; y: number }) => {
    const {
      capabilities,
      setNotice,
      locked,
      onBlocked,
      workspace,
      openWorkspace,
      flowRef,
    } = ports();

    if (!capabilities.localFiles)
      return setNotice('파일 가져오기는 PC 앱에서 사용할 수 있습니다.');
    if (locked) return onBlocked();
    if (!workspace.root) {
      void openWorkspace();
      return;
    }
    const center = position ??
      flowRef.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 160, y: 140 };
    setImportTarget(center);
    setImportError('');
  };
  const importFiles = async () => {
    const {
      setNotice,
      locked,
      flowRef,
      api,
      activeCanvasRef,
      loadProject,
      showError,
      selectCreated,
    } = ports();

    if (!importTarget || importingFiles || locked) return;
    if (pending.current) return;
    pending.current = true;
    setImportingFiles(true);
    setImportError('');
    try {
      const imported = await requireDesktopApi(api).importFiles({
        ...importTarget,
        canvasId: activeCanvasRef.current,
        imagePurpose,
      });
      if (!isCurrent()) return;
      if (!imported.length) {
        setNotice('파일 선택을 취소했습니다.');
        return;
      }
      await loadProject(false);
      if (!isCurrent()) return;
      setImportTarget(null);
      const ids = imported.map((doc) =>
        doc.htmlSource ? previewNodeId(doc.htmlSource) : doc.id,
      );
      selectCreated(ids, () => {
        if (isCurrent())
          void flowRef.current?.fitView({
            nodes: ids.map((id) => ({ id })),
            padding: 0.2,
            duration: 300,
          });
      });

      setNotice(
        `${imported.length}개 파일을 프로젝트에 복사했습니다. 원본 파일은 변경하지 않았습니다.`,
      );
    } catch (error) {
      if (!isCurrent()) return;
      showError(error);
      setImportError(
        (error instanceof Error ? error.message : String(error)).replace(
          /^Error invoking remote method '[^']+': /,
          '',
        ),
      );
    } finally {
      pending.current = false;
      setImportingFiles(false);
    }
  };

  return {
    openImport,
    importTarget,
    importingFiles,
    setImportTarget,
    setImportingFiles,
    setImportError,
    imagePurpose,
    setImagePurpose,
    importError,
    importFiles,
  };
}
